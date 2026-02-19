import { UpdateFeatureFlagTool } from '../update-feature-flag';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'updateFeatureFlag', arguments: args };
}

const EXISTING_FLAG = {
  id: 42,
  key: 'my-flag',
  name: 'My Flag',
  active: true,
  filters: {
    groups: [
      {
        rollout_percentage: 20,
        properties: [
          {
            type: 'person',
            key: 'email',
            value: '@company.com',
            operator: 'icontains',
          },
        ],
      },
    ],
  },
};

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    get: jest.fn().mockResolvedValue({ ok: true, data: EXISTING_FLAG }),
    patch: jest.fn().mockResolvedValue({
      ok: true,
      data: { ...EXISTING_FLAG, active: false },
    }),
    getProjectUrl: jest
      .fn()
      .mockReturnValue('https://us.posthog.com/project/1/feature_flags/42'),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('UpdateFeatureFlagTool', () => {
  it('toggles flag off with active: false', async () => {
    const client = makeClient();
    const tool = new UpdateFeatureFlagTool(client);

    const result = await tool.execute(makeCall({ id: 42, active: false }));

    expect(client.patch).toHaveBeenCalledWith(
      '/feature_flags/42/',
      { active: false },
      expect.anything(),
    );
    expect(result).toContain('Feature flag updated');
  });

  it('does not send undefined fields in patch body', async () => {
    const client = makeClient();
    const tool = new UpdateFeatureFlagTool(client);

    await tool.execute(makeCall({ id: 42, active: true }));

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('rollout_percentage');
    expect(body).not.toHaveProperty('name');
    expect(body).not.toHaveProperty('description');
  });

  it('fetches current flag before updating rollout to preserve targeting rules', async () => {
    const client = makeClient();
    const tool = new UpdateFeatureFlagTool(client);

    await tool.execute(makeCall({ id: 42, rollout_percentage: 75 }));

    expect(client.get).toHaveBeenCalledWith(
      '/feature_flags/42/',
      expect.anything(),
    );

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const filters = body['filters'] as typeof EXISTING_FLAG.filters;
    expect(filters.groups[0].rollout_percentage).toBe(75);
    // Existing targeting properties should be preserved
    expect(filters.groups[0].properties).toEqual(
      EXISTING_FLAG.filters.groups[0].properties,
    );
  });

  it('does not call get when only toggling active', async () => {
    const client = makeClient();
    const tool = new UpdateFeatureFlagTool(client);

    await tool.execute(makeCall({ id: 42, active: false }));

    expect(client.get).not.toHaveBeenCalled();
  });

  it('replaces targeting rules when targeting_rules provided', async () => {
    const client = makeClient();
    const tool = new UpdateFeatureFlagTool(client);

    await tool.execute(
      makeCall({
        id: 42,
        targeting_rules: [{ key: 'country', value: 'US', operator: 'exact' }],
      }),
    );

    expect(client.get).toHaveBeenCalledWith(
      '/feature_flags/42/',
      expect.anything(),
    );

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const filters = body['filters'] as typeof EXISTING_FLAG.filters;
    expect(filters.groups[0].properties).toEqual([
      { key: 'country', value: 'US', operator: 'exact', type: 'person' },
    ]);
  });

  it('defaults type to person for targeting rules', async () => {
    const client = makeClient();
    const tool = new UpdateFeatureFlagTool(client);

    await tool.execute(
      makeCall({
        id: 42,
        targeting_rules: [{ key: 'plan', value: 'pro', operator: 'exact' }],
      }),
    );

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const filters = body['filters'] as typeof EXISTING_FLAG.filters;
    expect(filters.groups[0].properties[0]).toMatchObject({ type: 'person' });
  });

  it('clears targeting when empty targeting_rules array provided', async () => {
    const client = makeClient();
    const tool = new UpdateFeatureFlagTool(client);

    await tool.execute(makeCall({ id: 42, targeting_rules: [] }));

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const filters = body['filters'] as typeof EXISTING_FLAG.filters;
    expect(filters.groups[0].properties).toEqual([]);
  });

  it('updates rollout and targeting in a single GET+PATCH when both provided', async () => {
    const client = makeClient();
    const tool = new UpdateFeatureFlagTool(client);

    await tool.execute(
      makeCall({
        id: 42,
        rollout_percentage: 50,
        targeting_rules: [
          {
            key: 'email',
            value: '@beta.com',
            operator: 'icontains',
            type: 'person',
          },
        ],
      }),
    );

    // Only one GET call, not two
    expect((client.get as jest.Mock).mock.calls).toHaveLength(1);

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const filters = body['filters'] as typeof EXISTING_FLAG.filters;
    expect(filters.groups[0].rollout_percentage).toBe(50);
    expect(filters.groups[0].properties).toEqual([
      {
        key: 'email',
        value: '@beta.com',
        operator: 'icontains',
        type: 'person',
      },
    ]);
  });

  it('returns error for missing id', async () => {
    const tool = new UpdateFeatureFlagTool(makeClient());
    const result = await tool.execute(makeCall({ id: 0 }));
    expect(result).toMatch(/positive integer/i);
  });

  it('returns error when no fields to update are provided', async () => {
    const tool = new UpdateFeatureFlagTool(makeClient());
    const result = await tool.execute(makeCall({ id: 42 }));
    expect(result).toMatch(/at least one field/i);
  });

  it('returns error for rollout_percentage out of range', async () => {
    const tool = new UpdateFeatureFlagTool(makeClient());
    const result = await tool.execute(
      makeCall({ id: 42, rollout_percentage: -5 }),
    );
    expect(result).toMatch(/between 0 and 100/i);
  });

  it('returns error when get fails during rollout update', async () => {
    const client = makeClient({
      get: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'Flag not found' },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateFeatureFlagTool(client);

    const result = await tool.execute(
      makeCall({ id: 42, rollout_percentage: 50 }),
    );
    expect(result).toMatch(/error fetching flag/i);
  });

  it('returns error when get fails during targeting update', async () => {
    const client = makeClient({
      get: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'Flag not found' },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateFeatureFlagTool(client);

    const result = await tool.execute(
      makeCall({
        id: 42,
        targeting_rules: [{ key: 'email', value: 'x', operator: 'exact' }],
      }),
    );
    expect(result).toMatch(/error fetching flag/i);
  });

  it('returns error when patch call fails', async () => {
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'unauthorized', message: 'Permission denied' },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateFeatureFlagTool(client);

    const result = await tool.execute(makeCall({ id: 42, active: false }));
    expect(result).toMatch(/error updating feature flag/i);
    expect(result).toContain('Permission denied');
  });

  it('has requiresConsent set', () => {
    const tool = new UpdateFeatureFlagTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });
});
