import * as http from 'http';
import { performOAuthFlow, refreshAccessToken } from '../oauth';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('http');

const validDcrResponse = {
  client_id: 'dcr-client-123',
  client_name: 'IDE Companion (VSCode)',
  redirect_uris: ['http://localhost:9999/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

const validTokenResponse = {
  access_token: 'phx_new_access',
  refresh_token: 'phx_new_refresh',
  expires_in: 3600,
  token_type: 'Bearer',
  scope: 'user:read project:read',
};

/**
 * Creates a mock HTTP server that immediately resolves with a
 * controllable request handler and a fake port.
 */
function createMockServer() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let requestHandler: (req: any, res: any) => void;

  const mockServer = {
    listen: jest.fn((_port: number, _host: string, cb: () => void) => {
      cb();
    }),
    address: jest.fn(() => ({ port: 9999 })),
    close: jest.fn(),
    on: jest.fn(
      (
        event: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handler: (...args: any[]) => void,
      ) => {
        if (event === 'request') {
          requestHandler = handler;
        }
      },
    ),
  };

  (http.createServer as jest.Mock).mockReturnValue(mockServer);

  /** Simulates a browser redirect hitting the callback server. */
  const simulateCallback = (
    path: string,
  ): { statusCode: number; body: string } => {
    let statusCode = 200;
    let body = '';
    const mockRes = {
      writeHead: jest.fn((code: number) => {
        statusCode = code;
      }),
      end: jest.fn((content: string) => {
        body = content;
      }),
    };
    requestHandler({ url: path }, mockRes);
    return { statusCode, body };
  };

  return { mockServer, simulateCallback };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('performOAuthFlow', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    (http.createServer as jest.Mock).mockReset();
  });

  it('should complete the full OAuth flow', async () => {
    const { simulateCallback } = createMockServer();

    // DCR registration → token exchange (two sequential fetch calls)
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => validDcrResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => validTokenResponse,
      });

    const flowPromise = performOAuthFlow('us');

    // Wait a tick for the server to start and DCR to complete
    await new Promise((r) => setTimeout(r, 10));

    // Simulate the browser redirecting back with an auth code
    simulateCallback('/callback?code=auth-code-123');

    const result = await flowPromise;

    expect(result.clientId).toBe('dcr-client-123');
    expect(result.tokenResponse.access_token).toBe('phx_new_access');
  });

  it('should call DCR with the correct URL for US region', async () => {
    const { simulateCallback } = createMockServer();

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => validDcrResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => validTokenResponse,
      });

    const flowPromise = performOAuthFlow('us');
    await new Promise((r) => setTimeout(r, 10));
    simulateCallback('/callback?code=code');
    await flowPromise;

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://us.posthog.com/oauth/register',
    );
  });

  it('should call DCR with the correct URL for EU region', async () => {
    const { simulateCallback } = createMockServer();

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => validDcrResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => validTokenResponse,
      });

    const flowPromise = performOAuthFlow('eu');
    await new Promise((r) => setTimeout(r, 10));
    simulateCallback('/callback?code=code');
    await flowPromise;

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://eu.posthog.com/oauth/register',
    );
  });

  it('should exchange the auth code with correct parameters', async () => {
    const { simulateCallback } = createMockServer();

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => validDcrResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => validTokenResponse,
      });

    const flowPromise = performOAuthFlow('us');
    await new Promise((r) => setTimeout(r, 10));
    simulateCallback('/callback?code=my-auth-code');
    await flowPromise;

    // Second fetch call is the token exchange
    const tokenBody = JSON.parse(
      mockFetch.mock.calls[1][1].body as string,
    ) as Record<string, string>;
    expect(tokenBody.grant_type).toBe('authorization_code');
    expect(tokenBody.code).toBe('my-auth-code');
    expect(tokenBody.client_id).toBe('dcr-client-123');
    expect(tokenBody.redirect_uri).toBe('http://localhost:9999/callback');
    expect(tokenBody.code_verifier).toBeDefined();
  });

  it('should reject when callback returns an error', async () => {
    const { simulateCallback } = createMockServer();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validDcrResponse,
    });

    const flowPromise = performOAuthFlow('us');
    await new Promise((r) => setTimeout(r, 10));
    simulateCallback('/callback?error=access_denied');

    await expect(flowPromise).rejects.toThrow('OAuth error: access_denied');
  });

  it('should reject when callback has no code', async () => {
    const { simulateCallback } = createMockServer();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validDcrResponse,
    });

    const flowPromise = performOAuthFlow('us');
    await new Promise((r) => setTimeout(r, 10));
    simulateCallback('/callback');

    await expect(flowPromise).rejects.toThrow('No authorization code received');
  });

  it('should return 404 for non-callback paths', async () => {
    const { simulateCallback } = createMockServer();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validDcrResponse,
    });

    // This request should get a 404 — it does NOT resolve the flow
    const flowPromise = performOAuthFlow('us');
    await new Promise((r) => setTimeout(r, 10));
    const { statusCode } = simulateCallback('/wrong-path');

    expect(statusCode).toBe(404);

    // Now send the real callback to resolve the flow
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validTokenResponse,
    });
    simulateCallback('/callback?code=code');
    await flowPromise;
  });

  it('should throw when DCR registration fails', async () => {
    createMockServer();

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(performOAuthFlow('us')).rejects.toThrow(
      'DCR registration failed: 500',
    );
  });

  it('should throw when token exchange fails', async () => {
    const { simulateCallback } = createMockServer();

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => validDcrResponse,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

    const flowPromise = performOAuthFlow('us');
    await new Promise((r) => setTimeout(r, 10));
    simulateCallback('/callback?code=code');

    await expect(flowPromise).rejects.toThrow('Token exchange failed: 400');
  });
});

describe('refreshAccessToken', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should return a parsed token response on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => validTokenResponse,
    });

    const result = await refreshAccessToken(
      'us',
      'old-refresh-token',
      'client-123',
    );

    expect(result.access_token).toBe('phx_new_access');
    expect(result.refresh_token).toBe('phx_new_refresh');
    expect(result.expires_in).toBe(3600);
  });

  it('should call the correct endpoint for US region', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => validTokenResponse,
    });

    await refreshAccessToken('us', 'refresh-token', 'client-id');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://us.posthog.com/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('should call the correct endpoint for EU region', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => validTokenResponse,
    });

    await refreshAccessToken('eu', 'refresh-token', 'client-id');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://eu.posthog.com/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('should send correct body parameters', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => validTokenResponse,
    });

    await refreshAccessToken('us', 'my-refresh-token', 'my-client-id');

    const body = JSON.parse(
      mockFetch.mock.calls[0][1].body as string,
    ) as Record<string, string>;

    expect(body).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'my-refresh-token',
      client_id: 'my-client-id',
    });
  });

  it('should throw on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });

    await expect(
      refreshAccessToken('us', 'bad-token', 'client-id'),
    ).rejects.toThrow('Token refresh failed: 401');
  });

  it('should throw on malformed response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: 'shape' }),
    });

    await expect(
      refreshAccessToken('us', 'token', 'client-id'),
    ).rejects.toThrow();
  });
});
