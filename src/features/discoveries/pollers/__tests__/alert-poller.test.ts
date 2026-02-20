import * as vscode from 'vscode';
import { createAlertPoller } from '../alert-poller';
import { DiscoveryStore } from '../../store';
import type { PostHogApiClient } from '../../../../api/client';
import type { Alert } from '../../../../api/schemas';
import type { Logger } from '../../../../utils/logger';

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    name: 'High error rate',
    state: 'firing',
    enabled: true,
    condition: { type: 'absolute_value', threshold: 100 },
    last_checked_at: '2025-02-10T14:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMockClient(alerts: Alert[] = []): PostHogApiClient {
  return {
    get: jest.fn().mockResolvedValue({
      ok: true,
      data: { results: alerts },
    }),
    post: jest.fn(),
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

describe('createAlertPoller', () => {
  it('should fetch alerts and create discoveries for firing alerts', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeAlert()]);
    const poller = createAlertPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(1);
    expect(store.getAll()[0]?.kind).toBe('firing_alert');
    expect(store.getAll()[0]?.title).toBe('High error rate');

    poller.dispose();
  });

  it('should prefix discovery id with firing_alert:', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeAlert({ id: 42 })]);
    const poller = createAlertPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(store.getAll()[0]?.id).toBe('firing_alert:42');

    poller.dispose();
  });

  it('should only surface firing and enabled alerts', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([
      makeAlert({ id: 1, state: 'firing', enabled: true }),
      makeAlert({ id: 2, state: 'not_firing', enabled: true }),
      makeAlert({ id: 3, state: 'snoozed', enabled: true }),
      makeAlert({ id: 4, state: 'firing', enabled: false }),
    ]);
    const poller = createAlertPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(1);
    expect(store.getAll()[0]?.id).toBe('firing_alert:1');

    poller.dispose();
  });

  it('should assign critical severity to all firing alerts', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeAlert()]);
    const poller = createAlertPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(store.getAll()[0]?.severity).toBe('critical');

    poller.dispose();
  });

  it('should show notification when new alerts are detected', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeAlert({ id: 1 }), makeAlert({ id: 2 })]);
    const poller = createAlertPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'PostHog: 2 alerts firing',
    );

    poller.dispose();
  });

  it('should use singular label for a single alert', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeAlert()]);
    const poller = createAlertPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'PostHog: 1 alert firing',
    );

    poller.dispose();
  });

  it('should not notify when all alerts are already known', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeAlert()]);
    const poller = createAlertPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    jest.mocked(vscode.window.showInformationMessage).mockClear();

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

    poller.dispose();
  });

  it('should log error when API call fails', async () => {
    const store = new DiscoveryStore();
    const logger = makeMockLogger();
    const client = {
      get: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'unauthorized', message: 'Invalid token' },
      }),
      post: jest.fn(),
    } as unknown as PostHogApiClient;

    const poller = createAlertPoller(client, store, logger, 60_000);

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      '[alerts] API error (unauthorized): Invalid token',
    );

    poller.dispose();
  });

  it('should call GET /alerts/', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([]);
    const poller = createAlertPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(client.get).toHaveBeenCalledWith('/alerts/', expect.anything());

    poller.dispose();
  });
});
