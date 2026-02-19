import { CreateFeatureFlagTool } from '../create-feature-flag';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'createFeatureFlag', arguments: args };
}

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    post: jest.fn().mockResolvedValue({
      ok: true,
      data: {
        id: 42,
        key: 'new-checkout-flow',
        name: 'New Checkout Flow',
        active: true,
        filters: { groups: [{ rollout_percentage: 50, properties: [] }] },
      },
    }),
    getProjectUrl: jest
      .fn()
      .mockReturnValue('https://us.posthog.com/project/1/feature_flags/42'),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('CreateFeatureFlagTool', () => {
  it('sends correct payload and returns success message', async () => {
    const client = makeClient();
    const tool = new CreateFeatureFlagTool(client);

    const result = await tool.execute(
      makeCall({
        key: 'new-checkout-flow',
        name: 'New Checkout Flow',
        rollout_percentage: 50,
      }),
    );

    expect(client.post).toHaveBeenCalledWith(
      '/feature_flags/',
      {
        key: 'new-checkout-flow',
        name: 'New Checkout Flow',
        active: true,
        filters: { groups: [{ rollout_percentage: 50, properties: [] }] },
      },
      expect.anything(),
    );
    expect(result).toContain('Feature flag created');
    expect(result).toContain('new-checkout-flow');
    expect(result).toContain('42');
    expect(result).toContain(
      'https://us.posthog.com/project/1/feature_flags/42',
    );
  });

  it('defaults rollout_percentage to 0 when no targeting and no percentage given', async () => {
    const client = makeClient();
    const tool = new CreateFeatureFlagTool(client);

    await tool.execute(makeCall({ key: 'my-flag', name: 'My Flag' }));

    expect(client.post).toHaveBeenCalledWith(
      '/feature_flags/',
      expect.objectContaining({
        filters: { groups: [{ rollout_percentage: 0, properties: [] }] },
      }),
      expect.anything(),
    );
  });

  it('defaults rollout_percentage to 100 when targeting_rules are provided', async () => {
    const client = makeClient();
    const tool = new CreateFeatureFlagTool(client);

    await tool.execute(
      makeCall({
        key: 'beta-flag',
        name: 'Beta Flag',
        targeting_rules: [
          { key: 'email', value: '@beta.com', operator: 'icontains' },
        ],
      }),
    );

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const filters = body['filters'] as {
      groups: Array<{ rollout_percentage: number }>;
    };
    expect(filters.groups[0].rollout_percentage).toBe(100);
  });

  it('sends targeting rules as properties in the group', async () => {
    const client = makeClient();
    const tool = new CreateFeatureFlagTool(client);

    await tool.execute(
      makeCall({
        key: 'beta-flag',
        name: 'Beta Flag',
        targeting_rules: [
          {
            key: 'email',
            value: '@company.com',
            operator: 'icontains',
            type: 'person',
          },
          { key: 'country', value: 'US', operator: 'exact' },
        ],
      }),
    );

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const filters = body['filters'] as {
      groups: Array<{ properties: unknown[] }>;
    };
    expect(filters.groups[0].properties).toEqual([
      {
        key: 'email',
        value: '@company.com',
        operator: 'icontains',
        type: 'person',
      },
      { key: 'country', value: 'US', operator: 'exact', type: 'person' },
    ]);
  });

  it('includes targeting summary in success message', async () => {
    const client = makeClient();
    const tool = new CreateFeatureFlagTool(client);

    const result = await tool.execute(
      makeCall({
        key: 'beta-flag',
        name: 'Beta Flag',
        targeting_rules: [
          { key: 'email', value: '@beta.com', operator: 'icontains' },
        ],
      }),
    );

    expect(result).toContain('email icontains @beta.com');
  });

  it('includes description in payload when provided', async () => {
    const client = makeClient();
    const tool = new CreateFeatureFlagTool(client);

    await tool.execute(
      makeCall({
        key: 'my-flag',
        name: 'My Flag',
        description: 'For beta users',
      }),
    );

    expect(client.post).toHaveBeenCalledWith(
      '/feature_flags/',
      expect.objectContaining({ description: 'For beta users' }),
      expect.anything(),
    );
  });

  it('does not include description key when not provided', async () => {
    const client = makeClient();
    const tool = new CreateFeatureFlagTool(client);

    await tool.execute(makeCall({ key: 'my-flag', name: 'My Flag' }));

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('description');
  });

  it('returns error for empty key', async () => {
    const tool = new CreateFeatureFlagTool(makeClient());
    const result = await tool.execute(makeCall({ key: '', name: 'My Flag' }));
    expect(result).toMatch(/key is required/i);
  });

  it('returns error for invalid key characters', async () => {
    const tool = new CreateFeatureFlagTool(makeClient());
    const result = await tool.execute(
      makeCall({ key: 'my flag!', name: 'My Flag' }),
    );
    expect(result).toMatch(/letters, numbers, hyphens/i);
  });

  it('returns error for empty name', async () => {
    const tool = new CreateFeatureFlagTool(makeClient());
    const result = await tool.execute(makeCall({ key: 'my-flag', name: '' }));
    expect(result).toMatch(/name is required/i);
  });

  it('returns error for rollout_percentage out of range', async () => {
    const tool = new CreateFeatureFlagTool(makeClient());
    const result = await tool.execute(
      makeCall({ key: 'my-flag', name: 'My Flag', rollout_percentage: 150 }),
    );
    expect(result).toMatch(/between 0 and 100/i);
  });

  it('returns error when API call fails', async () => {
    const client = makeClient({
      post: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'unknown', message: 'key already exists' },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new CreateFeatureFlagTool(client);

    const result = await tool.execute(
      makeCall({ key: 'my-flag', name: 'My Flag' }),
    );
    expect(result).toMatch(/error creating feature flag/i);
    expect(result).toContain('key already exists');
  });

  it('has requiresConsent set', () => {
    const tool = new CreateFeatureFlagTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });
});
