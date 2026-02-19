import { CreateDashboardTool } from '../create-dashboard';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'createDashboard', arguments: args };
}

const CREATED_DASHBOARD = {
  id: 5,
  name: 'Growth Metrics',
  description: null,
  created_at: '2024-01-15T10:00:00Z',
};

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    post: jest.fn().mockResolvedValue({ ok: true, data: CREATED_DASHBOARD }),
    getProjectUrl: jest
      .fn()
      .mockReturnValue('https://us.posthog.com/project/1/dashboard/5'),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('CreateDashboardTool', () => {
  it('sends correct payload with name only', async () => {
    const client = makeClient();
    const tool = new CreateDashboardTool(client);

    await tool.execute(makeCall({ name: 'Growth Metrics' }));

    expect(client.post).toHaveBeenCalledWith(
      '/dashboards/',
      { name: 'Growth Metrics' },
      expect.anything(),
    );
  });

  it('includes description when provided', async () => {
    const client = makeClient();
    const tool = new CreateDashboardTool(client);

    await tool.execute(
      makeCall({
        name: 'Growth Metrics',
        description: 'Tracks all growth KPIs',
      }),
    );

    expect(client.post).toHaveBeenCalledWith(
      '/dashboards/',
      { name: 'Growth Metrics', description: 'Tracks all growth KPIs' },
      expect.anything(),
    );
  });

  it('does not include description key when not provided', async () => {
    const client = makeClient();
    const tool = new CreateDashboardTool(client);

    await tool.execute(makeCall({ name: 'Growth Metrics' }));

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('description');
  });

  it('returns success message with id and url', async () => {
    const client = makeClient();
    const tool = new CreateDashboardTool(client);

    const result = await tool.execute(makeCall({ name: 'Growth Metrics' }));

    expect(result).toContain('Dashboard created');
    expect(result).toContain('Growth Metrics');
    expect(result).toContain('5');
    expect(result).toContain('https://us.posthog.com/project/1/dashboard/5');
  });

  it('returns error for empty name', async () => {
    const tool = new CreateDashboardTool(makeClient());
    const result = await tool.execute(makeCall({ name: '' }));
    expect(result).toMatch(/name is required/i);
  });

  it('returns error when API call fails', async () => {
    const client = makeClient({
      post: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'unknown', message: 'Server error' },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new CreateDashboardTool(client);

    const result = await tool.execute(makeCall({ name: 'Growth Metrics' }));

    expect(result).toMatch(/error creating dashboard/i);
    expect(result).toContain('Server error');
  });

  it('has requiresConsent set', () => {
    const tool = new CreateDashboardTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });
});
