import * as vscode from 'vscode';
import type { CloudRegion } from './constants';
import type { PostHogAccount } from './schemas';
import { AUTH_PROVIDER_ID, CLOUD_URLS } from './constants';
import { AccountSchema, UserInfoSchema } from './schemas';
import { performOAuthFlow, refreshAccessToken } from './oauth';

/** Keys used to persist auth state in VSCode SecretStorage. */
const SECRET_KEYS = {
  accessToken: 'posthog.accessToken',
  refreshToken: 'posthog.refreshToken',
  expiresAt: 'posthog.expiresAt',
  region: 'posthog.cloudRegion',
  clientId: 'posthog.clientId',
  account: 'posthog.account',
} as const;

/**
 * PostHog authentication provider for VSCode.
 *
 * Implements the VSCode AuthenticationProvider interface to manage
 * OAuth sessions. Tokens are stored in SecretStorage (OS keychain)
 * and synchronized across VSCode windows.
 */
export class PostHogAuthProvider
  implements vscode.AuthenticationProvider, vscode.Disposable
{
  static readonly id = AUTH_PROVIDER_ID;

  private readonly _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this._onDidChangeSessions.event;

  private _cachedToken: string | undefined;
  private readonly _disposables: vscode.Disposable[] = [];

  constructor(private readonly secretStorage: vscode.SecretStorage) {
    this._disposables.push(
      secretStorage.onDidChange((e) => {
        if (e.key === SECRET_KEYS.accessToken) {
          void this.handleCrossWindowChange();
        }
      }),
    );
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._onDidChangeSessions.dispose();
  }

  // AuthenticationProvider interface

  /** Returns existing sessions. Attempts token refresh if expired. */
  async getSessions(
    _scopes?: readonly string[],
  ): Promise<vscode.AuthenticationSession[]> {
    let token = await this.secretStorage.get(SECRET_KEYS.accessToken);

    if (!token) {
      return [];
    }

    if (await this.isTokenExpired()) {
      const refreshed = await this.tryRefresh();
      if (!refreshed) {
        return [];
      }
      // Re-read after refresh — tryRefresh stores the new token
      token = await this.secretStorage.get(SECRET_KEYS.accessToken);
      if (!token) {
        return [];
      }
    }

    const account = await this.readAccount();
    this._cachedToken = token;

    return [
      {
        id: PostHogAuthProvider.id,
        accessToken: token,
        account,
        scopes: [],
      },
    ];
  }

  /** Creates a new session via OAuth PKCE + DCR. Opens browser, stores tokens. */
  async createSession(
    _scopes: readonly string[],
  ): Promise<vscode.AuthenticationSession> {
    const region = await this.askForCloudRegion();
    if (!region) {
      throw new Error('Cloud region selection cancelled');
    }

    const { tokenResponse, clientId } = await performOAuthFlow(region);

    const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

    await this.secretStorage.store(
      SECRET_KEYS.accessToken,
      tokenResponse.access_token,
    );
    await this.secretStorage.store(
      SECRET_KEYS.refreshToken,
      tokenResponse.refresh_token,
    );
    await this.secretStorage.store(SECRET_KEYS.expiresAt, String(expiresAt));
    await this.secretStorage.store(SECRET_KEYS.region, region);
    await this.secretStorage.store(SECRET_KEYS.clientId, clientId);

    // Fetch user info to populate the account label
    const account = await this.fetchAccountInfo(
      tokenResponse.access_token,
      region,
    );
    await this.secretStorage.store(
      SECRET_KEYS.account,
      JSON.stringify(account),
    );

    this._cachedToken = tokenResponse.access_token;

    const session: vscode.AuthenticationSession = {
      id: PostHogAuthProvider.id,
      accessToken: tokenResponse.access_token,
      account,
      scopes: [],
    };

    this._onDidChangeSessions.fire({
      added: [session],
      removed: [],
      changed: [],
    });

    return session;
  }

  /** Clears all stored secrets and fires the session-removed event. */
  async removeSession(_sessionId: string): Promise<void> {
    const previousToken = this._cachedToken;
    const account = await this.readAccount();

    for (const key of Object.values(SECRET_KEYS)) {
      await this.secretStorage.delete(key);
    }
    this._cachedToken = undefined;

    if (previousToken) {
      this._onDidChangeSessions.fire({
        added: [],
        removed: [
          {
            id: PostHogAuthProvider.id,
            accessToken: previousToken,
            account,
            scopes: [],
          },
        ],
        changed: [],
      });
    }
  }

  /** Returns a valid access token and region, refreshing if needed. */
  async getValidToken(): Promise<
    { token: string; region: CloudRegion } | undefined
  > {
    const sessions = await this.getSessions();
    if (sessions.length === 0) {
      return undefined;
    }

    const region = await this.secretStorage.get(SECRET_KEYS.region);
    if (region !== 'us' && region !== 'eu') {
      return undefined;
    }

    const session = sessions[0];
    if (!session) {
      return undefined;
    }

    return { token: session.accessToken, region };
  }

  async getCloudRegion(): Promise<CloudRegion | undefined> {
    const region = await this.secretStorage.get(SECRET_KEYS.region);
    if (region !== 'us' && region !== 'eu') {
      return undefined;
    }
    return region;
  }

  private async askForCloudRegion(): Promise<CloudRegion | undefined> {
    const items: (vscode.QuickPickItem & {
      region: CloudRegion;
    })[] = [
      {
        label: '$(cloud) US Cloud',
        description: 'us.posthog.com',
        region: 'us',
      },
      {
        label: '$(cloud) EU Cloud',
        description: 'eu.posthog.com',
        region: 'eu',
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select your PostHog Cloud region',
      ignoreFocusOut: true,
    });

    return picked?.region;
  }

  private async isTokenExpired(): Promise<boolean> {
    const expiresAt = await this.secretStorage.get(SECRET_KEYS.expiresAt);
    if (!expiresAt) {
      return true;
    }
    // Refresh 60s early to avoid edge-case expiry during a request
    return Date.now() > Number(expiresAt) - 60_000;
  }

  private async tryRefresh(): Promise<boolean> {
    const refreshToken = await this.secretStorage.get(SECRET_KEYS.refreshToken);
    const region = await this.secretStorage.get(SECRET_KEYS.region);
    const clientId = await this.secretStorage.get(SECRET_KEYS.clientId);

    if (!refreshToken || !clientId || (region !== 'us' && region !== 'eu')) {
      await this.clearTokens();
      return false;
    }

    try {
      const tokenResponse = await refreshAccessToken(
        region,
        refreshToken,
        clientId,
      );
      const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

      await this.secretStorage.store(
        SECRET_KEYS.accessToken,
        tokenResponse.access_token,
      );
      await this.secretStorage.store(
        SECRET_KEYS.refreshToken,
        tokenResponse.refresh_token,
      );
      await this.secretStorage.store(SECRET_KEYS.expiresAt, String(expiresAt));

      this._cachedToken = tokenResponse.access_token;
      return true;
    } catch {
      await this.clearTokens();
      return false;
    }
  }

  private async clearTokens(): Promise<void> {
    await this.secretStorage.delete(SECRET_KEYS.accessToken);
    await this.secretStorage.delete(SECRET_KEYS.refreshToken);
    await this.secretStorage.delete(SECRET_KEYS.expiresAt);
    this._cachedToken = undefined;
  }

  private async readAccount(): Promise<PostHogAccount> {
    const raw = await this.secretStorage.get(SECRET_KEYS.account);
    if (!raw) {
      return { id: 'unknown', label: 'PostHog User' };
    }
    try {
      const parsed = AccountSchema.safeParse(JSON.parse(raw));
      return parsed.success
        ? parsed.data
        : { id: 'unknown', label: 'PostHog User' };
    } catch {
      return { id: 'unknown', label: 'PostHog User' };
    }
  }

  private async fetchAccountInfo(
    token: string,
    region: CloudRegion,
  ): Promise<PostHogAccount> {
    try {
      const cloudUrl = CLOUD_URLS[region];
      const response = await fetch(`${cloudUrl}/api/users/@me/`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        return { id: 'unknown', label: 'PostHog User' };
      }

      const raw: unknown = await response.json();
      const parsed = UserInfoSchema.safeParse(raw);
      if (!parsed.success) {
        return { id: 'unknown', label: 'PostHog User' };
      }

      return {
        id: parsed.data.distinct_id ?? 'unknown',
        label: parsed.data.first_name ?? parsed.data.email ?? 'PostHog User',
      };
    } catch {
      return { id: 'unknown', label: 'PostHog User' };
    }
  }

  private async handleCrossWindowChange(): Promise<void> {
    const storedToken = await this.secretStorage.get(SECRET_KEYS.accessToken);
    const previousToken = this._cachedToken;

    if (storedToken && !previousToken) {
      const sessions = await this.getSessions();
      this._onDidChangeSessions.fire({
        added: [...sessions],
        removed: [],
        changed: [],
      });
    } else if (!storedToken && previousToken) {
      const account = await this.readAccount();
      this._cachedToken = undefined;
      this._onDidChangeSessions.fire({
        added: [],
        removed: [
          {
            id: PostHogAuthProvider.id,
            accessToken: previousToken,
            account,
            scopes: [],
          },
        ],
        changed: [],
      });
    } else if (storedToken && previousToken && storedToken !== previousToken) {
      const sessions = await this.getSessions();
      this._onDidChangeSessions.fire({
        added: [],
        removed: [],
        changed: [...sessions],
      });
    }
  }
}
