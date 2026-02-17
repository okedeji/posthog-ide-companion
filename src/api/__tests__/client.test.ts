import { z } from 'zod';
import { PostHogApiClient, fetchProjects } from '../client';
import type { ApiResult } from '../client';

const TestSchema = z.object({ id: z.number(), name: z.string() });
type TestData = z.infer<typeof TestSchema>;

function createClient(token = 'test-token'): PostHogApiClient {
  return new PostHogApiClient(async () => token, 'us', 42);
}

function mockFetchResponse(status: number, body: unknown): void {
  jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as Response);
}

function mockFetchError(message: string): void {
  jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error(message));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PostHogApiClient', () => {
  describe('get', () => {
    it('should return parsed data on 200', async () => {
      const client = createClient();
      mockFetchResponse(200, { id: 1, name: 'Test' });

      const result: ApiResult<TestData> = await client.get(
        '/test/',
        TestSchema,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ id: 1, name: 'Test' });
      }
    });

    it('should send correct URL and auth header', async () => {
      const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, name: 'Test' }),
      } as Response);

      const client = createClient();
      await client.get('/error_tracking/', TestSchema);

      expect(spy).toHaveBeenCalledWith(
        'https://us.posthog.com/api/projects/42/error_tracking/',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('should use EU base URL for eu region', async () => {
      const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, name: 'Test' }),
      } as Response);

      const client = new PostHogApiClient(async () => 'token', 'eu', 99);
      await client.get('/test/', TestSchema);

      expect(spy).toHaveBeenCalledWith(
        'https://eu.posthog.com/api/projects/99/test/',
        expect.anything(),
      );
    });
  });

  describe('post', () => {
    it('should send JSON body and return parsed data', async () => {
      const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, name: 'Result' }),
      } as Response);

      const client = createClient();
      const body = { kind: 'ErrorTrackingQuery', dateRange: {} };
      const result = await client.post('/query/', body, TestSchema);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.name).toBe('Result');
      }

      expect(spy).toHaveBeenCalledWith(
        'https://us.posthog.com/api/projects/42/query/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    });
  });

  describe('error handling', () => {
    it('should return unauthorized for 401', async () => {
      const client = createClient();
      mockFetchResponse(401, {});

      const result = await client.get('/test/', TestSchema);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unauthorized');
        expect(result.error.statusCode).toBe(401);
      }
    });

    it('should return unauthorized for 403', async () => {
      const client = createClient();
      mockFetchResponse(403, {});

      const result = await client.get('/test/', TestSchema);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unauthorized');
      }
    });

    it('should return not_found for 404', async () => {
      const client = createClient();
      mockFetchResponse(404, {});

      const result = await client.get('/test/', TestSchema);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not_found');
      }
    });

    it('should return rate_limited for 429 after exhausting retries', async () => {
      jest.useFakeTimers();
      const client = createClient();

      // Mock 3 responses: initial fetch + 2 retries, all 429
      const fetchSpy = jest.spyOn(globalThis, 'fetch');
      for (let i = 0; i < 3; i++) {
        fetchSpy.mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({}),
          headers: new Headers(),
        } as Response);
      }

      const resultPromise = client.get('/test/', TestSchema);
      await jest.advanceTimersByTimeAsync(15_000);
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('rate_limited');
      }
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      jest.useRealTimers();
    });

    it('should return unknown for 500', async () => {
      const client = createClient();
      mockFetchResponse(500, {});

      const result = await client.get('/test/', TestSchema);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unknown');
        expect(result.error.statusCode).toBe(500);
      }
    });

    it('should return network error on fetch rejection', async () => {
      const client = createClient();
      mockFetchError('ECONNREFUSED');

      const result = await client.get('/test/', TestSchema);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network');
        expect(result.error.message).toBe('ECONNREFUSED');
      }
    });

    it('should return unknown when response fails schema validation', async () => {
      const client = createClient();
      mockFetchResponse(200, { wrong: 'shape' });

      const result = await client.get('/test/', TestSchema);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unknown');
        expect(result.error.message).toContain('Invalid API response');
      }
    });

    it('should return unauthorized when token resolver returns undefined', async () => {
      const client = new PostHogApiClient(async () => undefined, 'us', 42);

      const result = await client.get('/test/', TestSchema);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unauthorized');
        expect(result.error.message).toBe('No valid token available');
      }
    });
  });
});

describe('fetchProjects', () => {
  it('should return parsed projects from the API', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        count: 2,
        results: [
          {
            id: 1,
            name: 'Project A',
            api_token: 'phc_a',
            organization: 'Org',
            uuid: 'uuid-a',
          },
          {
            id: 2,
            name: 'Project B',
            api_token: 'phc_b',
            organization: 'Org',
            uuid: 'uuid-b',
          },
        ],
      }),
    } as Response);

    const projects = await fetchProjects('token', 'us');

    expect(projects).toHaveLength(2);
    expect(projects[0]?.name).toBe('Project A');
    expect(projects[1]?.name).toBe('Project B');
  });

  it('calls the correct URL for US region', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 0, results: [] }),
    } as Response);

    await fetchProjects('my-token', 'us');

    expect(spy).toHaveBeenCalledWith('https://us.posthog.com/api/projects/', {
      headers: { Authorization: 'Bearer my-token' },
    });
  });

  it('should call the correct URL for EU region', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 0, results: [] }),
    } as Response);

    await fetchProjects('my-token', 'eu');

    expect(spy).toHaveBeenCalledWith('https://eu.posthog.com/api/projects/', {
      headers: { Authorization: 'Bearer my-token' },
    });
  });

  it('throws on non-ok response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
    } as Response);

    await expect(fetchProjects('bad-token', 'us')).rejects.toThrow(
      'Failed to fetch projects: 401',
    );
  });

  it('should throw on malformed response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ unexpected: 'shape' }),
    } as Response);

    await expect(fetchProjects('token', 'us')).rejects.toThrow();
  });
});
