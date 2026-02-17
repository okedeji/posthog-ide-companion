import * as vscode from 'vscode';
import { createErrorPoller } from '../pollers/error-poller';
import { DiscoveryStore } from '../store';
import type { PostHogApiClient } from '../../api/posthog-client';
import type { ErrorTrackingIssue } from '../../api/schemas';
import type { Logger } from '../../utils/logger';

function makeIssue(
  overrides: Partial<ErrorTrackingIssue> = {},
): ErrorTrackingIssue {
  return {
    id: 'issue-1',
    first_seen: '2025-01-15T10:00:00Z',
    last_seen: '2025-02-10T14:00:00Z',
    status: 'active',
    aggregations: { occurrences: 42, sessions: 10, users: 5 },
    description: 'TypeError: Cannot read properties of undefined',
    name: 'TypeError',
    ...overrides,
  };
}

function makeMockClient(issues: ErrorTrackingIssue[] = []): PostHogApiClient {
  return {
    post: jest.fn().mockResolvedValue({
      ok: true,
      data: { results: issues },
    }),
    get: jest.fn(),
  } as unknown as PostHogApiClient;
}

function makeMockLogger(): Logger {
  return {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createErrorPoller', () => {
  it('should fetch errors and merge discoveries into the store', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeIssue()]);
    const poller = createErrorPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(1);
    expect(store.getAll()[0]?.kind).toBe('error');
    expect(store.getAll()[0]?.title).toBe(
      'TypeError: Cannot read properties of undefined',
    );

    poller.dispose();
  });

  it('should prefix discovery id with error:', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeIssue({ id: 'abc-123' })]);
    const poller = createErrorPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(store.getAll()[0]?.id).toBe('error:abc-123');

    poller.dispose();
  });

  it('should fall back to name when description is null', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([
      makeIssue({ description: null, name: 'RangeError' }),
    ]);
    const poller = createErrorPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(store.getAll()[0]?.title).toBe('RangeError');

    poller.dispose();
  });

  it('should fall back to truncated id when both description and name are null', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([
      makeIssue({ id: 'abcdefgh-1234', description: null, name: null }),
    ]);
    const poller = createErrorPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(store.getAll()[0]?.title).toBe('Error abcdefgh');

    poller.dispose();
  });

  it('should classify severity based on occurrence count', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([
      makeIssue({
        id: 'low',
        aggregations: { occurrences: 3, sessions: 1, users: 1 },
      }),
      makeIssue({
        id: 'mid',
        aggregations: { occurrences: 50, sessions: 10, users: 5 },
      }),
      makeIssue({
        id: 'high',
        aggregations: { occurrences: 200, sessions: 50, users: 20 },
      }),
    ]);
    const poller = createErrorPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    const discoveries = store.getAll();
    const bySeverity = new Map(discoveries.map((d) => [d.id, d.severity]));

    expect(bySeverity.get('error:low')).toBe('info');
    expect(bySeverity.get('error:mid')).toBe('warning');
    expect(bySeverity.get('error:high')).toBe('critical');

    poller.dispose();
  });

  it('should show notification when new errors are detected', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeIssue(), makeIssue({ id: 'issue-2' })]);
    const poller = createErrorPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'PostHog: 2 new errors detected',
    );

    poller.dispose();
  });

  it('should use singular label for a single new error', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeIssue()]);
    const poller = createErrorPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'PostHog: 1 new error detected',
    );

    poller.dispose();
  });

  it('should not notify when all errors are already known', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeIssue()]);
    const poller = createErrorPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    jest.mocked(vscode.window.showInformationMessage).mockClear();

    // Second poll with same data
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

    poller.dispose();
  });

  it('should log error when API call fails', async () => {
    const store = new DiscoveryStore();
    const logger = makeMockLogger();
    const client = {
      post: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'unauthorized', message: 'Invalid token' },
      }),
      get: jest.fn(),
    } as unknown as PostHogApiClient;

    const poller = createErrorPoller(client, store, logger, 60_000);

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      '[errors] API error (unauthorized): Invalid token',
    );

    poller.dispose();
  });

  it('should post to /query/ with ErrorTrackingQuery kind', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([]);
    const poller = createErrorPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(client.post).toHaveBeenCalledWith(
      '/query/',
      {
        query: expect.objectContaining({
          kind: 'ErrorTrackingQuery',
          orderBy: 'last_seen',
          status: 'active',
          limit: 50,
        }),
      },
      expect.anything(),
    );

    poller.dispose();
  });
});
