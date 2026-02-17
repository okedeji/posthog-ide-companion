import type { z } from 'zod';
import type { CloudRegion } from '../auth/constants';
import { CLOUD_URLS } from '../auth/constants';
import type { PostHogProject } from './schemas';
import { ProjectListSchema } from './schemas';

export async function fetchProjects(
  token: string,
  region: CloudRegion,
): Promise<PostHogProject[]> {
  const cloudUrl = CLOUD_URLS[region];

  const response = await fetch(`${cloudUrl}/api/projects/`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch projects: ${response.status}`);
  }

  const data: unknown = await response.json();
  const parsed = ProjectListSchema.parse(data);
  return parsed.results;
}

export type ApiError = {
  code: 'unauthorized' | 'not_found' | 'rate_limited' | 'network' | 'unknown';
  message: string;
  statusCode?: number;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export type TokenResolver = () => Promise<string | undefined>;

const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 10_000;

export class PostHogApiClient {
  private readonly baseUrl: string;

  constructor(
    private readonly resolveToken: TokenResolver,
    region: CloudRegion,
    projectId: number,
  ) {
    this.baseUrl = `${CLOUD_URLS[region]}/api/projects/${projectId}`;
  }

  async get<T>(path: string, schema: z.ZodType<T>): Promise<ApiResult<T>> {
    return this.request('GET', path, undefined, schema);
  }

  async post<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<ApiResult<T>> {
    return this.request('POST', path, body, schema);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown | undefined,
    schema: z.ZodType<T>,
  ): Promise<ApiResult<T>> {
    const token = await this.resolveToken();
    if (!token) {
      return {
        ok: false,
        error: { code: 'unauthorized', message: 'No valid token available' },
      };
    }

    const url = `${this.baseUrl}${path}`;
    const fetchOptions: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    let response: Response;
    try {
      response = await this.fetchWithRetry(url, fetchOptions);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'network',
          message:
            err instanceof Error ? err.message : 'Network request failed',
        },
      };
    }

    if (!response.ok) {
      return { ok: false, error: classifyHttpError(response.status) };
    }

    const raw: unknown = await response.json();
    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: `Invalid API response: ${parsed.error.message}`,
        },
      };
    }

    return { ok: true, data: parsed.data };
  }

  // Retries on 429 with exponential backoff, respects Retry-After header
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    let response = await fetch(url, options);

    for (
      let attempt = 0;
      attempt < MAX_RETRIES && response.status === 429;
      attempt++
    ) {
      const retryAfter = response.headers.get('Retry-After');
      const delayMs = retryAfter
        ? Math.min(Number(retryAfter) * 1_000, BACKOFF_MAX_MS)
        : Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);

      await sleep(delayMs);
      response = await fetch(url, options);
    }

    return response;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyHttpError(status: number): ApiError {
  switch (status) {
    case 401:
    case 403:
      return {
        code: 'unauthorized',
        message: 'Invalid or expired token',
        statusCode: status,
      };
    case 404:
      return {
        code: 'not_found',
        message: 'Resource not found',
        statusCode: status,
      };
    case 429:
      return {
        code: 'rate_limited',
        message: 'Rate limited, try again later',
        statusCode: status,
      };
    default:
      return { code: 'unknown', message: `HTTP ${status}`, statusCode: status };
  }
}
