import * as vscode from 'vscode';
import { createExperimentPoller } from '../experiment-poller';
import { DiscoveryStore } from '../../store';
import type { PostHogApiClient } from '../../../../api/client';
import type { Experiment } from '../../../../api/schemas';
import type { Logger } from '../../../../utils/logger';

function makeExperiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 1,
    name: 'Checkout flow redesign',
    feature_flag_key: 'checkout-v2',
    conclusion: 'Variant B increased conversion by 12%',
    start_date: '2025-01-01T00:00:00Z',
    end_date: '2025-02-01T00:00:00Z',
    archived: false,
    ...overrides,
  };
}

function makeMockClient(experiments: Experiment[] = []): PostHogApiClient {
  return {
    get: jest.fn().mockResolvedValue({
      ok: true,
      data: { results: experiments },
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

describe('createExperimentPoller', () => {
  it('should fetch experiments and create discoveries for concluded ones', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeExperiment()]);
    const poller = createExperimentPoller(
      client,
      store,
      makeMockLogger(),
      60_000,
    );

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(1);
    expect(store.getAll()[0]?.kind).toBe('experiment_result');
    expect(store.getAll()[0]?.title).toBe('Checkout flow redesign');

    poller.dispose();
  });

  it('should prefix discovery id with experiment_result:', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeExperiment({ id: 99 })]);
    const poller = createExperimentPoller(
      client,
      store,
      makeMockLogger(),
      60_000,
    );

    poller.start();
    await Promise.resolve();

    expect(store.getAll()[0]?.id).toBe('experiment_result:99');

    poller.dispose();
  });

  it('should only surface concluded non-archived experiments', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([
      makeExperiment({ id: 1, conclusion: 'Winner found', archived: false }),
      makeExperiment({ id: 2, conclusion: null, archived: false }),
      makeExperiment({ id: 3, conclusion: undefined, archived: false }),
      makeExperiment({ id: 4, conclusion: 'Archived result', archived: true }),
    ]);
    const poller = createExperimentPoller(
      client,
      store,
      makeMockLogger(),
      60_000,
    );

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(1);
    expect(store.getAll()[0]?.id).toBe('experiment_result:1');

    poller.dispose();
  });

  it('should assign info severity', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeExperiment()]);
    const poller = createExperimentPoller(
      client,
      store,
      makeMockLogger(),
      60_000,
    );

    poller.start();
    await Promise.resolve();

    expect(store.getAll()[0]?.severity).toBe('info');

    poller.dispose();
  });

  it('should truncate long conclusion text in description', async () => {
    const store = new DiscoveryStore();
    const longConclusion = 'A'.repeat(100);
    const client = makeMockClient([
      makeExperiment({ conclusion: longConclusion }),
    ]);
    const poller = createExperimentPoller(
      client,
      store,
      makeMockLogger(),
      60_000,
    );

    poller.start();
    await Promise.resolve();

    const description = store.getAll()[0]?.description ?? '';
    // 79 chars + ellipsis = 80 max for conclusion portion
    expect(description.length).toBeLessThanOrEqual(100);
    expect(description).toContain('…');

    poller.dispose();
  });

  it('should show notification when new experiments have results', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([makeExperiment()]);
    const poller = createExperimentPoller(
      client,
      store,
      makeMockLogger(),
      60_000,
    );

    poller.start();
    await Promise.resolve();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'PostHog: 1 experiment has results',
    );

    poller.dispose();
  });

  it('should use plural label for multiple experiments', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([
      makeExperiment({ id: 1 }),
      makeExperiment({ id: 2 }),
    ]);
    const poller = createExperimentPoller(
      client,
      store,
      makeMockLogger(),
      60_000,
    );

    poller.start();
    await Promise.resolve();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'PostHog: 2 experiments have results',
    );

    poller.dispose();
  });

  it('should log error when API call fails', async () => {
    const store = new DiscoveryStore();
    const logger = makeMockLogger();
    const client = {
      get: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'network', message: 'Connection failed' },
      }),
      post: jest.fn(),
    } as unknown as PostHogApiClient;

    const poller = createExperimentPoller(client, store, logger, 60_000);

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      '[experiments] API error (network): Connection failed',
    );

    poller.dispose();
  });

  it('should call GET /experiments/', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([]);
    const poller = createExperimentPoller(
      client,
      store,
      makeMockLogger(),
      60_000,
    );

    poller.start();
    await Promise.resolve();

    expect(client.get).toHaveBeenCalledWith('/experiments/', expect.anything());

    poller.dispose();
  });
});
