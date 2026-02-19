import { CreateExperimentTool } from '../create-experiment';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'createExperiment', arguments: args };
}

const CREATED_EXPERIMENT = {
  id: 7,
  name: 'Checkout Button Color Test',
  description: null,
  feature_flag_key: 'checkout-button-color',
  start_date: null,
  end_date: null,
  parameters: {
    feature_flag_variants: [
      { key: 'control', name: 'Control Group', rollout_percentage: 50 },
      { key: 'test', name: 'Test Variant', rollout_percentage: 50 },
    ],
    rollout_percentage: 100,
  },
};

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    post: jest.fn().mockResolvedValue({ ok: true, data: CREATED_EXPERIMENT }),
    getProjectUrl: jest
      .fn()
      .mockReturnValue('https://us.posthog.com/project/1/experiments/7'),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('CreateExperimentTool', () => {
  it('sends correct payload with default variants', async () => {
    const client = makeClient();
    const tool = new CreateExperimentTool(client);

    await tool.execute(
      makeCall({
        name: 'Checkout Button Color Test',
        feature_flag_key: 'checkout-button-color',
      }),
    );

    expect(client.post).toHaveBeenCalledWith(
      '/experiments/',
      expect.objectContaining({
        name: 'Checkout Button Color Test',
        feature_flag_key: 'checkout-button-color',
        parameters: {
          feature_flag_variants: [
            { key: 'control', name: 'Control Group', rollout_percentage: 50 },
            { key: 'test', name: 'Test Variant', rollout_percentage: 50 },
          ],
          rollout_percentage: 100,
        },
      }),
      expect.anything(),
    );
  });

  it('returns success message with id, flag key, and url', async () => {
    const client = makeClient();
    const tool = new CreateExperimentTool(client);

    const result = await tool.execute(
      makeCall({
        name: 'Checkout Button Color Test',
        feature_flag_key: 'checkout-button-color',
      }),
    );

    expect(result).toContain('Experiment created');
    expect(result).toContain('7');
    expect(result).toContain('checkout-button-color');
    expect(result).toContain('https://us.posthog.com/project/1/experiments/7');
  });

  it('sends custom variants when provided', async () => {
    const client = makeClient();
    const tool = new CreateExperimentTool(client);

    await tool.execute(
      makeCall({
        name: 'Button Test',
        feature_flag_key: 'button-test',
        variants: [
          { key: 'control', name: 'Blue', rollout_percentage: 34 },
          { key: 'red', name: 'Red', rollout_percentage: 33 },
          { key: 'green', name: 'Green', rollout_percentage: 33 },
        ],
      }),
    );

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const params = body['parameters'] as { feature_flag_variants: unknown[] };
    expect(params.feature_flag_variants).toHaveLength(3);
    expect(params.feature_flag_variants[1]).toMatchObject({ key: 'red' });
  });

  it('sends custom rollout_percentage', async () => {
    const client = makeClient();
    const tool = new CreateExperimentTool(client);

    await tool.execute(
      makeCall({
        name: 'My Exp',
        feature_flag_key: 'my-exp',
        rollout_percentage: 50,
      }),
    );

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const params = body['parameters'] as { rollout_percentage: number };
    expect(params.rollout_percentage).toBe(50);
  });

  it('includes description when provided', async () => {
    const client = makeClient();
    const tool = new CreateExperimentTool(client);

    await tool.execute(
      makeCall({
        name: 'My Exp',
        feature_flag_key: 'my-exp',
        description: 'Testing the new checkout',
      }),
    );

    expect(client.post).toHaveBeenCalledWith(
      '/experiments/',
      expect.objectContaining({ description: 'Testing the new checkout' }),
      expect.anything(),
    );
  });

  it('does not include description key when not provided', async () => {
    const client = makeClient();
    const tool = new CreateExperimentTool(client);

    await tool.execute(
      makeCall({ name: 'My Exp', feature_flag_key: 'my-exp' }),
    );

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('description');
  });

  it('returns error for empty name', async () => {
    const tool = new CreateExperimentTool(makeClient());
    const result = await tool.execute(
      makeCall({ name: '', feature_flag_key: 'my-exp' }),
    );
    expect(result).toMatch(/name is required/i);
  });

  it('returns error for empty feature_flag_key', async () => {
    const tool = new CreateExperimentTool(makeClient());
    const result = await tool.execute(
      makeCall({ name: 'My Exp', feature_flag_key: '' }),
    );
    expect(result).toMatch(/feature_flag_key is required/i);
  });

  it('returns error for invalid feature_flag_key characters', async () => {
    const tool = new CreateExperimentTool(makeClient());
    const result = await tool.execute(
      makeCall({ name: 'My Exp', feature_flag_key: 'my exp!' }),
    );
    expect(result).toMatch(/letters, numbers, hyphens/i);
  });

  it('returns error for rollout_percentage out of range', async () => {
    const tool = new CreateExperimentTool(makeClient());
    const result = await tool.execute(
      makeCall({
        name: 'My Exp',
        feature_flag_key: 'my-exp',
        rollout_percentage: 110,
      }),
    );
    expect(result).toMatch(/between 0 and 100/i);
  });

  it('returns error when variants have fewer than 2 entries', async () => {
    const tool = new CreateExperimentTool(makeClient());
    const result = await tool.execute(
      makeCall({
        name: 'My Exp',
        feature_flag_key: 'my-exp',
        variants: [{ key: 'control', rollout_percentage: 100 }],
      }),
    );
    expect(result).toMatch(/at least 2/i);
  });

  it('returns error when variants missing control', async () => {
    const tool = new CreateExperimentTool(makeClient());
    const result = await tool.execute(
      makeCall({
        name: 'My Exp',
        feature_flag_key: 'my-exp',
        variants: [
          { key: 'red', rollout_percentage: 50 },
          { key: 'blue', rollout_percentage: 50 },
        ],
      }),
    );
    expect(result).toMatch(/control/i);
  });

  it('returns error when API call fails', async () => {
    const client = makeClient({
      post: jest.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'feature_flag_key already exists',
        },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new CreateExperimentTool(client);

    const result = await tool.execute(
      makeCall({ name: 'My Exp', feature_flag_key: 'my-exp' }),
    );
    expect(result).toMatch(/error creating experiment/i);
    expect(result).toContain('feature_flag_key already exists');
  });

  it('has requiresConsent set', () => {
    const tool = new CreateExperimentTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });
});
