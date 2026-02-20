import { CreateAlertTool } from '../create-alert';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'createAlert', arguments: args };
}

const MOCK_INSIGHT = {
  id: 42,
  short_id: 'abc123',
  name: '$exception trend (auto-created for alert)',
};

const MOCK_ALERT = {
  id: 1,
  name: 'High error rate',
  enabled: true,
  calculation_interval: 'daily',
};

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    post: jest
      .fn()
      .mockResolvedValueOnce({ ok: true, data: MOCK_INSIGHT })
      .mockResolvedValueOnce({ ok: true, data: MOCK_ALERT }),
    get: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    getProjectUrl: jest
      .fn()
      .mockReturnValue('https://us.posthog.com/project/1/insights/abc123'),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('CreateAlertTool', () => {
  it('has requiresConsent set', () => {
    const tool = new CreateAlertTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });

  it('creates alert with existing insight_id', async () => {
    const client = {
      post: jest.fn().mockResolvedValue({ ok: true, data: MOCK_ALERT }),
      get: jest.fn(),
      getProjectUrl: jest.fn(),
    } as unknown as PostHogApiClient;

    const tool = new CreateAlertTool(client);
    const result = await tool.execute(
      makeCall({
        name: 'High error rate',
        insight_id: 42,
        condition_type: 'absolute_value',
        upper_bound: 100,
      }),
    );

    expect(result).toContain('Alert created');
    expect(result).toContain('High error rate');
    // Should only call POST /alerts/, not POST /insights/
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(client.post).toHaveBeenCalledWith(
      '/alerts/',
      expect.objectContaining({
        name: 'High error rate',
        insight: 42,
        condition: { type: 'absolute_value' },
      }),
      expect.anything(),
    );
  });

  it('auto-creates insight when event_name provided', async () => {
    const client = makeClient();
    const tool = new CreateAlertTool(client);

    const result = await tool.execute(
      makeCall({
        name: 'Exception alert',
        event_name: '$exception',
        condition_type: 'absolute_value',
        upper_bound: 50,
      }),
    );

    // First call: create insight
    expect(client.post).toHaveBeenCalledWith(
      '/insights/',
      expect.objectContaining({
        name: '$exception trend (auto-created for alert)',
        query: expect.objectContaining({
          kind: 'TrendsQuery',
          series: [{ event: '$exception', kind: 'EventsNode' }],
        }),
      }),
      expect.anything(),
    );

    // Second call: create alert with the new insight ID
    expect(client.post).toHaveBeenCalledWith(
      '/alerts/',
      expect.objectContaining({
        insight: 42,
        name: 'Exception alert',
      }),
      expect.anything(),
    );

    expect(result).toContain('Created insight');
    expect(result).toContain('Alert created');
  });

  it('returns error when name is missing', async () => {
    const tool = new CreateAlertTool(makeClient());
    const result = await tool.execute(
      makeCall({ condition_type: 'absolute_value', upper_bound: 10 }),
    );
    expect(result).toMatch(/name is required/i);
  });

  it('returns error when condition_type is invalid', async () => {
    const tool = new CreateAlertTool(makeClient());
    const result = await tool.execute(
      makeCall({
        name: 'Test',
        condition_type: 'invalid',
        upper_bound: 10,
        insight_id: 1,
      }),
    );
    expect(result).toMatch(/condition_type must be one of/i);
  });

  it('returns error when no threshold bounds provided', async () => {
    const tool = new CreateAlertTool(makeClient());
    const result = await tool.execute(
      makeCall({
        name: 'Test',
        condition_type: 'absolute_value',
        insight_id: 1,
      }),
    );
    expect(result).toMatch(/upper_bound or lower_bound/i);
  });

  it('returns error when neither insight_id nor event_name provided', async () => {
    const tool = new CreateAlertTool(makeClient());
    const result = await tool.execute(
      makeCall({
        name: 'Test',
        condition_type: 'absolute_value',
        upper_bound: 10,
      }),
    );
    expect(result).toMatch(/insight_id.*or.*event_name/i);
  });

  it('returns error when lower_bound >= upper_bound', async () => {
    const tool = new CreateAlertTool(makeClient());
    const result = await tool.execute(
      makeCall({
        name: 'Test',
        condition_type: 'absolute_value',
        upper_bound: 10,
        lower_bound: 20,
        insight_id: 1,
      }),
    );
    expect(result).toMatch(/lower_bound must be less than upper_bound/i);
  });

  it('returns error when calculation_interval is invalid', async () => {
    const tool = new CreateAlertTool(makeClient());
    const result = await tool.execute(
      makeCall({
        name: 'Test',
        condition_type: 'absolute_value',
        upper_bound: 10,
        insight_id: 1,
        calculation_interval: 'biweekly',
      }),
    );
    expect(result).toMatch(/calculation_interval must be one of/i);
  });

  it('returns error when alert API fails', async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'unknown', message: 'Server error' },
      }),
      get: jest.fn(),
      getProjectUrl: jest.fn(),
    } as unknown as PostHogApiClient;

    const tool = new CreateAlertTool(client);
    const result = await tool.execute(
      makeCall({
        name: 'Test',
        condition_type: 'absolute_value',
        upper_bound: 10,
        insight_id: 1,
      }),
    );
    expect(result).toMatch(/error creating alert/i);
  });

  it('returns error when insight creation fails', async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'unknown', message: 'Insight creation failed' },
      }),
      get: jest.fn(),
      getProjectUrl: jest.fn(),
    } as unknown as PostHogApiClient;

    const tool = new CreateAlertTool(client);
    const result = await tool.execute(
      makeCall({
        name: 'Test',
        condition_type: 'absolute_value',
        upper_bound: 10,
        event_name: '$pageview',
      }),
    );
    expect(result).toMatch(/error creating insight/i);
  });

  it('includes threshold info in response', async () => {
    const client = {
      post: jest.fn().mockResolvedValue({ ok: true, data: MOCK_ALERT }),
      get: jest.fn(),
      getProjectUrl: jest.fn(),
    } as unknown as PostHogApiClient;

    const tool = new CreateAlertTool(client);
    const result = await tool.execute(
      makeCall({
        name: 'Test',
        condition_type: 'absolute_value',
        upper_bound: 100,
        lower_bound: 10,
        insight_id: 1,
      }),
    );

    expect(result).toContain('Upper bound: 100');
    expect(result).toContain('Lower bound: 10');
    expect(result).toContain('Condition: absolute_value');
  });

  it('defaults to daily interval and absolute threshold type', async () => {
    const client = {
      post: jest.fn().mockResolvedValue({ ok: true, data: MOCK_ALERT }),
      get: jest.fn(),
      getProjectUrl: jest.fn(),
    } as unknown as PostHogApiClient;

    const tool = new CreateAlertTool(client);
    await tool.execute(
      makeCall({
        name: 'Test',
        condition_type: 'absolute_value',
        upper_bound: 100,
        insight_id: 1,
      }),
    );

    expect(client.post).toHaveBeenCalledWith(
      '/alerts/',
      expect.objectContaining({
        calculation_interval: 'daily',
        threshold: expect.objectContaining({
          configuration: expect.objectContaining({
            type: 'absolute',
          }),
        }),
      }),
      expect.anything(),
    );
  });
});
