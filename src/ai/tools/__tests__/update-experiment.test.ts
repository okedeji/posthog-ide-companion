import { UpdateExperimentTool } from '../update-experiment';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'updateExperiment', arguments: args };
}

const DRAFT_EXPERIMENT = {
  id: 7,
  name: 'My Experiment',
  description: null,
  feature_flag_key: 'my-exp',
  start_date: null,
  end_date: null,
  conclusion: null,
  conclusion_comment: null,
  parameters: { feature_flag_variants: [], rollout_percentage: 100 },
};

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    patch: jest.fn().mockResolvedValue({ ok: true, data: DRAFT_EXPERIMENT }),
    getProjectUrl: jest
      .fn()
      .mockReturnValue('https://us.posthog.com/project/1/experiments/7'),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('UpdateExperimentTool', () => {
  it('sends name update', async () => {
    const client = makeClient();
    const tool = new UpdateExperimentTool(client);

    await tool.execute(makeCall({ id: 7, name: 'Renamed Experiment' }));

    expect(client.patch).toHaveBeenCalledWith(
      '/experiments/7/',
      { name: 'Renamed Experiment' },
      expect.anything(),
    );
  });

  it('sends description update', async () => {
    const client = makeClient();
    const tool = new UpdateExperimentTool(client);

    await tool.execute(makeCall({ id: 7, description: 'New description' }));

    expect(client.patch).toHaveBeenCalledWith(
      '/experiments/7/',
      { description: 'New description' },
      expect.anything(),
    );
  });

  it('sets start_date to an ISO string when launch is true', async () => {
    const client = makeClient();
    const tool = new UpdateExperimentTool(client);

    await tool.execute(makeCall({ id: 7, launch: true }));

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body['start_date']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body).not.toHaveProperty('end_date');
  });

  it('does not set start_date when launch is false', async () => {
    const client = makeClient();
    const tool = new UpdateExperimentTool(client);

    await tool.execute(makeCall({ id: 7, launch: false, name: 'Rename only' }));

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('start_date');
  });

  it('sets end_date and conclusion when conclude is provided', async () => {
    const concludedExp = {
      ...DRAFT_EXPERIMENT,
      end_date: '2024-03-30T00:00:00Z',
      conclusion: 'won',
    };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: concludedExp }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateExperimentTool(client);

    await tool.execute(
      makeCall({
        id: 7,
        conclude: {
          conclusion: 'won',
          comment: 'Test lifted conversion by 8%',
        },
      }),
    );

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body['end_date']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body['conclusion']).toBe('won');
    expect(body['conclusion_comment']).toBe('Test lifted conversion by 8%');
  });

  it('sends conclude without comment when comment is omitted', async () => {
    const client = makeClient();
    const tool = new UpdateExperimentTool(client);

    await tool.execute(
      makeCall({ id: 7, conclude: { conclusion: 'inconclusive' } }),
    );

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body['conclusion']).toBe('inconclusive');
    expect(body).not.toHaveProperty('conclusion_comment');
  });

  it('returns status Running in message when experiment has start_date but no end_date', async () => {
    const runningExp = {
      ...DRAFT_EXPERIMENT,
      start_date: '2024-01-15T09:00:00Z',
    };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: runningExp }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateExperimentTool(client);

    const result = await tool.execute(makeCall({ id: 7, launch: true }));
    expect(result).toContain('Running');
  });

  it('returns status Concluded in message when experiment has end_date', async () => {
    const concludedExp = {
      ...DRAFT_EXPERIMENT,
      end_date: '2024-03-30T00:00:00Z',
      conclusion: 'lost',
    };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: concludedExp }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateExperimentTool(client);

    const result = await tool.execute(
      makeCall({ id: 7, conclude: { conclusion: 'lost' } }),
    );
    expect(result).toContain('Concluded');
    expect(result).toContain('lost');
  });

  it('returns error for missing id', async () => {
    const tool = new UpdateExperimentTool(makeClient());
    const result = await tool.execute(makeCall({ id: 0 }));
    expect(result).toMatch(/positive integer/i);
  });

  it('returns error when no fields to update are provided', async () => {
    const tool = new UpdateExperimentTool(makeClient());
    const result = await tool.execute(makeCall({ id: 7 }));
    expect(result).toMatch(/at least one field/i);
  });

  it('returns error for invalid conclusion value', async () => {
    const tool = new UpdateExperimentTool(makeClient());
    const result = await tool.execute(
      makeCall({ id: 7, conclude: { conclusion: 'maybe' } }),
    );
    expect(result).toMatch(/conclusion must be one of/i);
  });

  it('returns error when patch call fails', async () => {
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'Experiment not found' },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateExperimentTool(client);

    const result = await tool.execute(makeCall({ id: 7, name: 'New Name' }));
    expect(result).toMatch(/error updating experiment/i);
    expect(result).toContain('Experiment not found');
  });

  it('calls onExperimentUpdated with concluded=true when experiment has end_date', async () => {
    const concludedExp = {
      ...DRAFT_EXPERIMENT,
      end_date: '2024-03-30T00:00:00Z',
      conclusion: 'won',
    };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: concludedExp }),
    } as Partial<PostHogApiClient>);
    const onExperimentUpdated = jest.fn();
    const tool = new UpdateExperimentTool(client, onExperimentUpdated);

    await tool.execute(makeCall({ id: 7, conclude: { conclusion: 'won' } }));

    expect(onExperimentUpdated).toHaveBeenCalledWith(7, true);
  });

  it('calls onExperimentUpdated with concluded=false when experiment has no end_date', async () => {
    const client = makeClient();
    const onExperimentUpdated = jest.fn();
    const tool = new UpdateExperimentTool(client, onExperimentUpdated);

    await tool.execute(makeCall({ id: 7, name: 'Renamed' }));

    expect(onExperimentUpdated).toHaveBeenCalledWith(7, false);
  });

  it('does not call onExperimentUpdated when PATCH fails', async () => {
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'Not found' },
      }),
    } as Partial<PostHogApiClient>);
    const onExperimentUpdated = jest.fn();
    const tool = new UpdateExperimentTool(client, onExperimentUpdated);

    await tool.execute(makeCall({ id: 7, name: 'New Name' }));

    expect(onExperimentUpdated).not.toHaveBeenCalled();
  });

  it('has requiresConsent set', () => {
    const tool = new UpdateExperimentTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });
});
