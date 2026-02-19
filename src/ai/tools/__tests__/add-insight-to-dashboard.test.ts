import { AddInsightToDashboardTool } from '../add-insight-to-dashboard';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'addInsightToDashboard', arguments: args };
}

const BASE_INSIGHT = {
  id: 42,
  short_id: 'abc123',
  name: 'My Insight',
  description: null,
  filters: {},
  query: null,
  dashboards: null,
  created_at: '2024-01-15T10:00:00Z',
};

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    get: jest.fn().mockResolvedValue({ ok: true, data: BASE_INSIGHT }),
    patch: jest
      .fn()
      .mockResolvedValue({
        ok: true,
        data: { ...BASE_INSIGHT, dashboards: [10] },
      }),
    getProjectUrl: jest
      .fn()
      .mockReturnValue('https://us.posthog.com/project/1/insights/abc123'),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('AddInsightToDashboardTool', () => {
  it('fetches current insight then patches with updated dashboards list', async () => {
    const client = makeClient();
    const tool = new AddInsightToDashboardTool(client);

    await tool.execute(makeCall({ insight_id: 42, dashboard_id: 10 }));

    expect(client.get).toHaveBeenCalledWith('/insights/42/', expect.anything());
    expect(client.patch).toHaveBeenCalledWith(
      '/insights/42/',
      { dashboards: [10] },
      expect.anything(),
    );
  });

  it('preserves existing dashboards when adding a new one', async () => {
    const insightWithDashboard = { ...BASE_INSIGHT, dashboards: [5] };
    const client = makeClient({
      get: jest
        .fn()
        .mockResolvedValue({ ok: true, data: insightWithDashboard }),
      patch: jest
        .fn()
        .mockResolvedValue({
          ok: true,
          data: { ...insightWithDashboard, dashboards: [5, 10] },
        }),
    } as Partial<PostHogApiClient>);
    const tool = new AddInsightToDashboardTool(client);

    await tool.execute(makeCall({ insight_id: 42, dashboard_id: 10 }));

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body['dashboards']).toEqual([5, 10]);
  });

  it('returns already-attached message when dashboard is already in the list', async () => {
    const insightAlreadyAttached = { ...BASE_INSIGHT, dashboards: [10] };
    const client = makeClient({
      get: jest
        .fn()
        .mockResolvedValue({ ok: true, data: insightAlreadyAttached }),
    } as Partial<PostHogApiClient>);
    const tool = new AddInsightToDashboardTool(client);

    const result = await tool.execute(
      makeCall({ insight_id: 42, dashboard_id: 10 }),
    );

    expect(client.patch).not.toHaveBeenCalled();
    expect(result).toContain('already on dashboard');
  });

  it('returns success message with insight and dashboard ids', async () => {
    const client = makeClient();
    const tool = new AddInsightToDashboardTool(client);

    const result = await tool.execute(
      makeCall({ insight_id: 42, dashboard_id: 10 }),
    );

    expect(result).toContain('Insight added to dashboard');
    expect(result).toContain('42');
    expect(result).toContain('10');
    expect(result).toContain(
      'https://us.posthog.com/project/1/insights/abc123',
    );
  });

  it('returns error for invalid insight_id', async () => {
    const tool = new AddInsightToDashboardTool(makeClient());
    const result = await tool.execute(
      makeCall({ insight_id: 0, dashboard_id: 10 }),
    );
    expect(result).toMatch(/insight_id must be a positive integer/i);
  });

  it('returns error for invalid dashboard_id', async () => {
    const tool = new AddInsightToDashboardTool(makeClient());
    const result = await tool.execute(
      makeCall({ insight_id: 42, dashboard_id: -1 }),
    );
    expect(result).toMatch(/dashboard_id must be a positive integer/i);
  });

  it('returns error when GET fails', async () => {
    const client = makeClient({
      get: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'Insight not found' },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new AddInsightToDashboardTool(client);

    const result = await tool.execute(
      makeCall({ insight_id: 42, dashboard_id: 10 }),
    );

    expect(result).toMatch(/error fetching insight/i);
    expect(result).toContain('Insight not found');
  });

  it('returns error when PATCH fails', async () => {
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'unknown', message: 'Update failed' },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new AddInsightToDashboardTool(client);

    const result = await tool.execute(
      makeCall({ insight_id: 42, dashboard_id: 10 }),
    );

    expect(result).toMatch(/error updating insight/i);
    expect(result).toContain('Update failed');
  });

  it('has requiresConsent set', () => {
    const tool = new AddInsightToDashboardTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });
});
