import * as vscode from 'vscode';
import { createFlagPoller } from '../flag-poller';
import { DiscoveryStore } from '../../store';
import type { PostHogApiClient } from '../../../../api/client';
import type { FeatureFlag } from '../../../../api/schemas';
import type { Logger } from '../../../../utils/logger';

const THIRTY_ONE_DAYS_AGO = new Date(
  Date.now() - 31 * 24 * 60 * 60 * 1000,
).toISOString();

const FIVE_DAYS_AGO = new Date(
  Date.now() - 5 * 24 * 60 * 60 * 1000,
).toISOString();

function makeFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    id: 1,
    key: 'new-checkout',
    name: 'New Checkout Flow',
    active: true,
    deleted: false,
    filters: { groups: [{ rollout_percentage: 100 }] },
    tags: [],
    created_at: THIRTY_ONE_DAYS_AGO,
    ...overrides,
  };
}

function makeMockClient(flags: FeatureFlag[] = []): PostHogApiClient {
  return {
    get: jest.fn().mockResolvedValue({
      ok: true,
      data: { results: flags },
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

describe('createFlagPoller', () => {
  describe('stale flags', () => {
    it('should detect flags at 100% rollout for 30+ days', async () => {
      const store = new DiscoveryStore();
      const client = makeMockClient([makeFlag()]);
      const poller = createFlagPoller(client, store, makeMockLogger(), 60_000);

      poller.start();
      await Promise.resolve();

      const stale = store.getByKind('stale_flag');
      expect(stale).toHaveLength(1);
      expect(stale[0]?.id).toBe('stale_flag:1');
      expect(stale[0]?.severity).toBe('info');
      expect(stale[0]?.title).toContain('new-checkout');

      poller.dispose();
    });

    it('should NOT flag recently created 100% flags', async () => {
      const store = new DiscoveryStore();
      const client = makeMockClient([makeFlag({ created_at: FIVE_DAYS_AGO })]);
      const poller = createFlagPoller(client, store, makeMockLogger(), 60_000);

      poller.start();
      await Promise.resolve();

      expect(store.getByKind('stale_flag')).toHaveLength(0);

      poller.dispose();
    });

    it('should NOT flag inactive flags', async () => {
      const store = new DiscoveryStore();
      const client = makeMockClient([makeFlag({ active: false })]);
      const poller = createFlagPoller(client, store, makeMockLogger(), 60_000);

      poller.start();
      await Promise.resolve();

      expect(store.getByKind('stale_flag')).toHaveLength(0);

      poller.dispose();
    });

    it('should NOT flag deleted flags', async () => {
      const store = new DiscoveryStore();
      const client = makeMockClient([makeFlag({ deleted: true })]);
      const poller = createFlagPoller(client, store, makeMockLogger(), 60_000);

      poller.start();
      await Promise.resolve();

      expect(store.getByKind('stale_flag')).toHaveLength(0);

      poller.dispose();
    });

    it('should NOT flag flags with partial rollout', async () => {
      const store = new DiscoveryStore();
      const client = makeMockClient([
        makeFlag({
          filters: { groups: [{ rollout_percentage: 50 }] },
        }),
      ]);
      const poller = createFlagPoller(client, store, makeMockLogger(), 60_000);

      poller.start();
      await Promise.resolve();

      expect(store.getByKind('stale_flag')).toHaveLength(0);

      poller.dispose();
    });

    it('should require ALL groups at 100% to count as full rollout', async () => {
      const store = new DiscoveryStore();
      const client = makeMockClient([
        makeFlag({
          filters: {
            groups: [{ rollout_percentage: 100 }, { rollout_percentage: 50 }],
          },
        }),
      ]);
      const poller = createFlagPoller(client, store, makeMockLogger(), 60_000);

      poller.start();
      await Promise.resolve();

      expect(store.getByKind('stale_flag')).toHaveLength(0);

      poller.dispose();
    });
  });

  describe('rollback flags', () => {
    it('should detect flags with performed_rollback', async () => {
      const store = new DiscoveryStore();
      const client = makeMockClient([
        makeFlag({ id: 10, performed_rollback: true }),
      ]);
      const poller = createFlagPoller(client, store, makeMockLogger(), 60_000);

      poller.start();
      await Promise.resolve();

      const rollbacks = store.getByKind('flag_rollback');
      expect(rollbacks).toHaveLength(1);
      expect(rollbacks[0]?.id).toBe('flag_rollback:10');
      expect(rollbacks[0]?.severity).toBe('critical');
      expect(rollbacks[0]?.title).toContain('rolled back');

      poller.dispose();
    });

    it('should NOT flag flags without performed_rollback', async () => {
      const store = new DiscoveryStore();
      const client = makeMockClient([
        makeFlag({ performed_rollback: false }),
        makeFlag({ id: 2 }), // undefined performed_rollback
      ]);
      const poller = createFlagPoller(client, store, makeMockLogger(), 60_000);

      poller.start();
      await Promise.resolve();

      expect(store.getByKind('flag_rollback')).toHaveLength(0);

      poller.dispose();
    });
  });

  describe('combined behavior', () => {
    it('should produce both stale and rollback discoveries from one poll', async () => {
      const store = new DiscoveryStore();
      const client = makeMockClient([
        makeFlag({ id: 1 }), // stale (100%, 31 days old)
        makeFlag({ id: 2, performed_rollback: true }), // rollback + stale
        makeFlag({ id: 3, created_at: FIVE_DAYS_AGO }), // neither
      ]);
      const poller = createFlagPoller(client, store, makeMockLogger(), 60_000);

      poller.start();
      await Promise.resolve();

      expect(store.getByKind('stale_flag')).toHaveLength(2);
      expect(store.getByKind('flag_rollback')).toHaveLength(1);

      poller.dispose();
    });

    it('should show combined notification for new flag issues', async () => {
      const store = new DiscoveryStore();
      const client = makeMockClient([
        makeFlag({ id: 1 }),
        makeFlag({ id: 2, performed_rollback: true }),
      ]);
      const poller = createFlagPoller(client, store, makeMockLogger(), 60_000);

      poller.start();
      await Promise.resolve();

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'PostHog: 3 flag issues detected',
      );

      poller.dispose();
    });
  });

  it('should call GET /feature_flags/?active=true', async () => {
    const store = new DiscoveryStore();
    const client = makeMockClient([]);
    const poller = createFlagPoller(client, store, makeMockLogger(), 60_000);

    poller.start();
    await Promise.resolve();

    expect(client.get).toHaveBeenCalledWith(
      '/feature_flags/?active=true',
      expect.anything(),
    );

    poller.dispose();
  });

  it('should log error when API call fails', async () => {
    const store = new DiscoveryStore();
    const logger = makeMockLogger();
    const client = {
      get: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'rate_limited', message: 'Too many requests' },
      }),
      post: jest.fn(),
    } as unknown as PostHogApiClient;

    const poller = createFlagPoller(client, store, logger, 60_000);

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      '[flags] API error (rate_limited): Too many requests',
    );

    poller.dispose();
  });

  it('should replace both kinds separately on each poll', async () => {
    const store = new DiscoveryStore();
    const flag1 = makeFlag({ id: 1 });
    const flag2 = makeFlag({ id: 2, performed_rollback: true });

    const client = makeMockClient([flag1, flag2]);
    const poller = createFlagPoller(client, store, makeMockLogger(), 60_000);

    await poller.pollNow();
    expect(store.getByKind('stale_flag')).toHaveLength(2);
    expect(store.getByKind('flag_rollback')).toHaveLength(1);

    // Second poll: flag2 no longer has rollback
    (client.get as jest.Mock).mockResolvedValue({
      ok: true,
      data: { results: [flag1] },
    });
    await poller.pollNow();

    expect(store.getByKind('stale_flag')).toHaveLength(1);
    expect(store.getByKind('flag_rollback')).toHaveLength(0);

    poller.dispose();
  });
});
