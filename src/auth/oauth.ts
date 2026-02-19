import * as crypto from 'crypto';
import * as http from 'http';
import * as vscode from 'vscode';
import type { CloudRegion } from './constants';
import type { DcrResponse, OAuthTokenResponse } from './schemas';
import {
  CLOUD_URLS,
  OAUTH_CALLBACK_PATH,
  OAUTH_SCOPES,
  OAUTH_TIMEOUT_MS,
  DCR_CLIENT_NAME,
} from './constants';
import { DcrResponseSchema, OAuthTokenResponseSchema } from './schemas';

export type OAuthResult = {
  tokenResponse: OAuthTokenResponse;
  clientId: string;
};

type CallbackServer = {
  port: number;
  waitForCode: () => Promise<string>;
  close: () => void;
};

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function startCallbackServer(): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();

    const waitForCode = (): Promise<string> =>
      new Promise((resolveCode, rejectCode) => {
        const timeout = setTimeout(() => {
          server.close();
          rejectCode(new Error('OAuth callback timed out after 2 minutes'));
        }, OAUTH_TIMEOUT_MS);

        server.on('request', (req, res) => {
          const url = new URL(req.url ?? '/', `http://localhost`);

          if (url.pathname !== OAUTH_CALLBACK_PATH) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }

          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(200, {
              'Content-Type': 'text/html',
            });
            res.end(buildErrorPage());
            clearTimeout(timeout);
            server.close();
            rejectCode(new Error(`OAuth error: ${error}`));
            return;
          }

          if (!code) {
            res.writeHead(400, {
              'Content-Type': 'text/html',
            });
            res.end(buildErrorPage());
            clearTimeout(timeout);
            server.close();
            rejectCode(new Error('No authorization code received'));
            return;
          }

          res.writeHead(200, {
            'Content-Type': 'text/html',
          });
          res.end(buildSuccessPage());
          clearTimeout(timeout);
          server.close();
          resolveCode(code);
        });
      });

    // Port 0 = OS picks a free port
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to start callback server'));
        return;
      }
      resolve({
        port: address.port,
        waitForCode,
        close: () => {
          server.close();
        },
      });
    });
  });
}

async function registerDcrClient(
  cloudUrl: string,
  redirectUri: string,
): Promise<DcrResponse> {
  const response = await fetch(`${cloudUrl}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: DCR_CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });

  if (!response.ok) {
    throw new Error(`DCR registration failed: ${response.status}`);
  }

  const data: unknown = await response.json();
  return DcrResponseSchema.parse(data);
}

async function exchangeCodeForToken(
  cloudUrl: string,
  code: string,
  redirectUri: string,
  clientId: string,
  codeVerifier: string,
): Promise<OAuthTokenResponse> {
  const response = await fetch(`${cloudUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const data: unknown = await response.json();
  return OAuthTokenResponseSchema.parse(data);
}

// Full PKCE flow: callback server -> DCR -> browser auth -> token exchange
export async function performOAuthFlow(
  region: CloudRegion,
): Promise<OAuthResult> {
  const cloudUrl = CLOUD_URLS[region];
  const server = await startCallbackServer();
  const redirectUri = `http://localhost:${server.port}${OAUTH_CALLBACK_PATH}`;

  try {
    const dcr = await registerDcrClient(cloudUrl, redirectUri);

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const authUrl = new URL(`${cloudUrl}/oauth/authorize`);
    authUrl.searchParams.set('client_id', dcr.client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('scope', OAUTH_SCOPES.join(' '));

    await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

    const code = await server.waitForCode();

    const tokenResponse = await exchangeCodeForToken(
      cloudUrl,
      code,
      redirectUri,
      dcr.client_id,
      codeVerifier,
    );

    return { tokenResponse, clientId: dcr.client_id };
  } catch (error) {
    server.close();
    throw error;
  }
}

export async function refreshAccessToken(
  region: CloudRegion,
  refreshToken: string,
  clientId: string,
): Promise<OAuthTokenResponse> {
  const cloudUrl = CLOUD_URLS[region];

  const response = await fetch(`${cloudUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data: unknown = await response.json();
  return OAuthTokenResponseSchema.parse(data);
}

const OAUTH_PAGE_STYLES = `<style>
  * {
    font-family: monospace;
    background-color: #1b0a00;
    color: #F7A502;
    font-weight: medium;
    font-size: 24px;
    margin: .25rem;
  }
  .blink {
    animation: blink-animation 1s steps(2, start) infinite;
  }
  @keyframes blink-animation {
    to { opacity: 0; }
  }
</style>`;

function buildSuccessPage(): string {
  return `<html>
  <head>
    <meta charset="UTF-8">
    <title>PostHog IDE Companion</title>
    ${OAUTH_PAGE_STYLES}
  </head>
  <body>
    <p>PostHog login complete!</p>
    <p>Return to VS Code: the companion is ready<span class="blink">█</span></p>
    <script>window.close();</script>
  </body>
</html>`;
}

function buildErrorPage(): string {
  return `<html>
  <head>
    <meta charset="UTF-8">
    <title>PostHog IDE Companion - Authorization failed</title>
    ${OAUTH_PAGE_STYLES}
  </head>
  <body>
    <p>Authorization failed.</p>
    <p>Return to VS Code and try again. This window will close automatically.</p>
    <script>window.close();</script>
  </body>
</html>`;
}
