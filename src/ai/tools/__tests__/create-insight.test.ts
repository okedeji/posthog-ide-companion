import { CreateInsightTool } from '../create-insight';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'createInsight', arguments: args };
}

const CREATED_INSIGHT = {
  id: 42,
  short_id: 'abc123',
  name: 'Weekly Active Users',
  description: null,
  filters: {},
  query: null,
  dashboards: null,
  created_at: '2024-01-15T10:00:00Z',
};

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    post: jest.fn().mockResolvedValue({ ok: true, data: CREATED_INSIGHT }),
    getProjectUrl: jest
      .fn()
      .mockReturnValue('https://us.posthog.com/project/1/insights/abc123'),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('CreateInsightTool', () => {
  it('sends correct payload for a HogQL insight', async () => {
    const client = makeClient();
    const tool = new CreateInsightTool(client);

    await tool.execute(
      makeCall({
        name: 'Weekly Active Users',
        hogql:
          'SELECT count(distinct person_id) FROM events WHERE timestamp > now() - INTERVAL 7 DAY',
      }),
    );

    expect(client.post).toHaveBeenCalledWith(
      '/insights/',
      expect.objectContaining({
        name: 'Weekly Active Users',
        query: {
          kind: 'HogQLQuery',
          query:
            'SELECT count(distinct person_id) FROM events WHERE timestamp > now() - INTERVAL 7 DAY',
        },
      }),
      expect.anything(),
    );
  });

  it('sends correct payload for a filters-based insight', async () => {
    const client = makeClient();
    const tool = new CreateInsightTool(client);

    const filters = {
      events: [{ id: 'pageview' }],
      date_from: '-7d',
      insight: 'TRENDS',
    };

    await tool.execute(
      makeCall({
        name: 'Pageviews Trend',
        filters,
      }),
    );

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body['filters']).toEqual(filters);
    expect(body).not.toHaveProperty('query');
  });

  it('attaches to dashboard when dashboard_id is provided', async () => {
    const client = makeClient();
    const tool = new CreateInsightTool(client);

    await tool.execute(
      makeCall({
        name: 'My Insight',
        hogql: 'SELECT count() FROM events',
        dashboard_id: 10,
      }),
    );

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body['dashboards']).toEqual([10]);
  });

  it('does not include dashboards key when dashboard_id is not provided', async () => {
    const client = makeClient();
    const tool = new CreateInsightTool(client);

    await tool.execute(
      makeCall({ name: 'My Insight', hogql: 'SELECT count() FROM events' }),
    );

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('dashboards');
  });

  it('includes description when provided', async () => {
    const client = makeClient();
    const tool = new CreateInsightTool(client);

    await tool.execute(
      makeCall({
        name: 'My Insight',
        hogql: 'SELECT count() FROM events',
        description: 'Tracks weekly active users',
      }),
    );

    expect(client.post).toHaveBeenCalledWith(
      '/insights/',
      expect.objectContaining({ description: 'Tracks weekly active users' }),
      expect.anything(),
    );
  });

  it('returns success message with id and url', async () => {
    const client = makeClient();
    const tool = new CreateInsightTool(client);

    const result = await tool.execute(
      makeCall({
        name: 'Weekly Active Users',
        hogql: 'SELECT count() FROM events',
      }),
    );

    expect(result).toContain('Insight saved');
    expect(result).toContain('42');
    expect(result).toContain(
      'https://us.posthog.com/project/1/insights/abc123',
    );
  });

  it('shows dashboard IDs in message when insight has dashboards', async () => {
    const insightWithDashboard = { ...CREATED_INSIGHT, dashboards: [10] };
    const client = makeClient({
      post: jest
        .fn()
        .mockResolvedValue({ ok: true, data: insightWithDashboard }),
    } as Partial<PostHogApiClient>);
    const tool = new CreateInsightTool(client);

    const result = await tool.execute(
      makeCall({
        name: 'My Insight',
        hogql: 'SELECT count() FROM events',
        dashboard_id: 10,
      }),
    );

    expect(result).toContain('10');
  });

  it('returns error for empty name', async () => {
    const tool = new CreateInsightTool(makeClient());
    const result = await tool.execute(
      makeCall({ name: '', hogql: 'SELECT count() FROM events' }),
    );
    expect(result).toMatch(/name is required/i);
  });

  it('returns error when neither hogql nor filters is provided', async () => {
    const tool = new CreateInsightTool(makeClient());
    const result = await tool.execute(makeCall({ name: 'My Insight' }));
    expect(result).toMatch(/hogql.*filters/i);
  });

  it('returns error when API call fails', async () => {
    const client = makeClient({
      post: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'unknown', message: 'Invalid query' },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new CreateInsightTool(client);

    const result = await tool.execute(
      makeCall({ name: 'My Insight', hogql: 'SELECT count() FROM events' }),
    );

    expect(result).toMatch(/error creating insight/i);
    expect(result).toContain('Invalid query');
  });

  it('has requiresConsent set', () => {
    const tool = new CreateInsightTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });
});
