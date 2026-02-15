import * as vscode from 'vscode';
import { PostHogAuthProvider } from '../provider';

jest.mock('../oauth', () => ({
  performOAuthFlow: jest.fn(),
  refreshAccessToken: jest.fn(),
}));

import { performOAuthFlow, refreshAccessToken } from '../oauth';

const mockShowQuickPick = vscode.window.showQuickPick as jest.Mock;

const mockPerformOAuthFlow = performOAuthFlow as jest.MockedFunction<
  typeof performOAuthFlow
>;
const mockRefreshAccessToken = refreshAccessToken as jest.MockedFunction<
  typeof refreshAccessToken
>;

const mockFetch = jest.fn();
global.fetch = mockFetch;

/** In-memory SecretStorage mock. */
function createMockSecretStorage() {
  const store = new Map<string, string>();
  const changeListeners: ((e: { key: string }) => void)[] = [];

  return {
    get: jest.fn(async (key: string) => store.get(key)),
    store: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    onDidChange: jest.fn((listener: (e: { key: string }) => void) => {
      changeListeners.push(listener);
      return { dispose: () => undefined };
    }),
    // Test helper: simulate a cross-window change
    _fireChange: (key: string) => {
      for (const listener of changeListeners) {
        listener({ key });
      }
    },
    _store: store,
  };
}

/**
 * Seeds the SecretStorage with a complete set of auth secrets
 * so that getSessions / getValidToken returns a valid session.
 */
function seedAuth(
  secrets: ReturnType<typeof createMockSecretStorage>,
  overrides?: Partial<{
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    region: string;
    clientId: string;
    account: string;
  }>,
) {
  const defaults = {
    accessToken: 'phx_test_access',
    refreshToken: 'phx_test_refresh',
    expiresAt: String(Date.now() + 3600_000), // 1 hour from now
    region: 'us',
    clientId: 'dcr-client-123',
    account: JSON.stringify({
      id: 'user-1',
      label: 'Test User',
    }),
  };

  const values = { ...defaults, ...overrides };
  secrets._store.set('posthog.accessToken', values.accessToken);
  secrets._store.set('posthog.refreshToken', values.refreshToken);
  secrets._store.set('posthog.expiresAt', values.expiresAt);
  secrets._store.set('posthog.cloudRegion', values.region);
  secrets._store.set('posthog.clientId', values.clientId);
  secrets._store.set('posthog.account', values.account);
}

describe('PostHogAuthProvider', () => {
  let secrets: ReturnType<typeof createMockSecretStorage>;
  let provider: PostHogAuthProvider;

  beforeEach(() => {
    secrets = createMockSecretStorage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider = new PostHogAuthProvider(secrets as any);
    mockPerformOAuthFlow.mockReset();
    mockRefreshAccessToken.mockReset();
    mockFetch.mockReset();
  });

  afterEach(() => {
    provider.dispose();
  });

  // getSessions

  describe('getSessions', () => {
    it('should return empty array when no token is stored', async () => {
      const sessions = await provider.getSessions();
      expect(sessions).toEqual([]);
    });

    it('returns a session when a valid token exists', async () => {
      seedAuth(secrets);

      const sessions = await provider.getSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.accessToken).toBe('phx_test_access');
      expect(sessions[0]?.account.label).toBe('Test User');
    });

    it('should attempt refresh when token is expired', async () => {
      seedAuth(secrets, {
        expiresAt: String(Date.now() - 1000), // expired
      });

      mockRefreshAccessToken.mockResolvedValue({
        access_token: 'phx_refreshed',
        refresh_token: 'phx_new_refresh',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'user:read',
      });

      const sessions = await provider.getSessions();

      expect(mockRefreshAccessToken).toHaveBeenCalledWith(
        'us',
        'phx_test_refresh',
        'dcr-client-123',
      );
      expect(sessions).toHaveLength(1);
    });

    it('returns empty array when refresh fails', async () => {
      seedAuth(secrets, {
        expiresAt: String(Date.now() - 1000), // expired
      });

      mockRefreshAccessToken.mockRejectedValue(new Error('refresh failed'));

      const sessions = await provider.getSessions();

      expect(sessions).toEqual([]);
    });

    it('should return fallback account when account data is missing', async () => {
      seedAuth(secrets);
      secrets._store.delete('posthog.account');

      const sessions = await provider.getSessions();

      expect(sessions[0]?.account.label).toBe('PostHog User');
    });

    it('returns fallback account when account data is invalid JSON', async () => {
      seedAuth(secrets);
      secrets._store.set('posthog.account', 'not-json');

      // safeParse will fail on invalid JSON, but JSON.parse will throw
      // The provider catches this via safeParse
      const sessions = await provider.getSessions();

      // Should still return a session with fallback account
      expect(sessions).toHaveLength(1);
    });
  });

  // createSession

  describe('createSession', () => {
    it('should store tokens after successful OAuth flow', async () => {
      mockShowQuickPick.mockResolvedValueOnce({ region: 'us' });

      // Mock OAuth flow
      mockPerformOAuthFlow.mockResolvedValue({
        tokenResponse: {
          access_token: 'phx_new_access',
          refresh_token: 'phx_new_refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'user:read',
        },
        clientId: 'dcr-new-client',
      });

      // Mock user info fetch
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          distinct_id: 'user-99',
          email: 'dev@example.com',
          first_name: 'Dev',
        }),
      });

      const session = await provider.createSession([]);

      expect(session.accessToken).toBe('phx_new_access');
      expect(session.account.label).toBe('Dev');
      expect(secrets.store).toHaveBeenCalledWith(
        'posthog.accessToken',
        'phx_new_access',
      );
      expect(secrets.store).toHaveBeenCalledWith(
        'posthog.refreshToken',
        'phx_new_refresh',
      );
      expect(secrets.store).toHaveBeenCalledWith('posthog.cloudRegion', 'us');
    });

    it('throws when cloud region selection is cancelled', async () => {
      mockShowQuickPick.mockResolvedValueOnce(undefined);

      await expect(provider.createSession([])).rejects.toThrow(
        'Cloud region selection cancelled',
      );
    });

    it('should use fallback account when user info fetch fails', async () => {
      mockShowQuickPick.mockResolvedValueOnce({ region: 'eu' });

      mockPerformOAuthFlow.mockResolvedValue({
        tokenResponse: {
          access_token: 'phx_token',
          refresh_token: 'phx_refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'user:read',
        },
        clientId: 'dcr-client',
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const session = await provider.createSession([]);

      expect(session.account.label).toBe('PostHog User');
    });
  });

  // removeSession

  describe('removeSession', () => {
    it('clears all stored secrets', async () => {
      seedAuth(secrets);
      // Prime the cached token by calling getSessions first
      await provider.getSessions();

      await provider.removeSession('posthog');

      expect(await secrets.get('posthog.accessToken')).toBeUndefined();
      expect(await secrets.get('posthog.refreshToken')).toBeUndefined();
      expect(await secrets.get('posthog.expiresAt')).toBeUndefined();
      expect(await secrets.get('posthog.cloudRegion')).toBeUndefined();
      expect(await secrets.get('posthog.clientId')).toBeUndefined();
      expect(await secrets.get('posthog.account')).toBeUndefined();
    });

    it('should return empty sessions after removal', async () => {
      seedAuth(secrets);
      await provider.getSessions();

      await provider.removeSession('posthog');

      const sessions = await provider.getSessions();
      expect(sessions).toEqual([]);
    });
  });

  // getValidToken

  describe('getValidToken', () => {
    it('returns token and region when authenticated', async () => {
      seedAuth(secrets);

      const result = await provider.getValidToken();

      expect(result).toEqual({
        token: 'phx_test_access',
        region: 'us',
      });
    });

    it('should return undefined when not authenticated', async () => {
      const result = await provider.getValidToken();
      expect(result).toBeUndefined();
    });

    it('returns undefined when region is invalid', async () => {
      seedAuth(secrets, { region: 'invalid' });

      const result = await provider.getValidToken();
      expect(result).toBeUndefined();
    });
  });

  // getCloudRegion

  describe('getCloudRegion', () => {
    it('should return the stored region', async () => {
      seedAuth(secrets, { region: 'eu' });

      const region = await provider.getCloudRegion();
      expect(region).toBe('eu');
    });

    it('returns undefined when no region is stored', async () => {
      const region = await provider.getCloudRegion();
      expect(region).toBeUndefined();
    });

    it('should return undefined for invalid region', async () => {
      secrets._store.set('posthog.cloudRegion', 'invalid');

      const region = await provider.getCloudRegion();
      expect(region).toBeUndefined();
    });
  });

  describe('token refresh', () => {
    it('refreshes and store new tokens when expired', async () => {
      seedAuth(secrets, {
        expiresAt: String(Date.now() - 1000),
      });

      mockRefreshAccessToken.mockResolvedValue({
        access_token: 'phx_refreshed',
        refresh_token: 'phx_new_refresh',
        expires_in: 7200,
        token_type: 'Bearer',
        scope: 'user:read',
      });

      await provider.getSessions();

      expect(secrets.store).toHaveBeenCalledWith(
        'posthog.accessToken',
        'phx_refreshed',
      );
      expect(secrets.store).toHaveBeenCalledWith(
        'posthog.refreshToken',
        'phx_new_refresh',
      );
    });

    it('should clear tokens when refresh token is missing', async () => {
      seedAuth(secrets, {
        expiresAt: String(Date.now() - 1000),
      });
      secrets._store.delete('posthog.refreshToken');

      const sessions = await provider.getSessions();

      expect(sessions).toEqual([]);
      expect(secrets.delete).toHaveBeenCalledWith('posthog.accessToken');
    });

    it('treats token as expired when within 60s buffer', async () => {
      seedAuth(secrets, {
        // Expires in 30s, within the 60s early-refresh buffer
        expiresAt: String(Date.now() + 30_000),
      });

      mockRefreshAccessToken.mockResolvedValue({
        access_token: 'phx_early_refresh',
        refresh_token: 'phx_new_refresh',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'user:read',
      });

      await provider.getSessions();

      expect(mockRefreshAccessToken).toHaveBeenCalled();
    });
  });
});
