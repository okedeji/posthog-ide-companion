import { UpdateSurveyTool } from '../update-survey';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'updateSurvey', arguments: args };
}

const DRAFT_SURVEY = {
  id: 'survey_01',
  name: 'My Survey',
  description: null,
  type: 'popover',
  questions: [{ type: 'open', question: 'How was it?' }],
  conditions: null,
  start_date: null,
  end_date: null,
  archived: false,
  linked_flag_id: null,
  responses_limit: null,
};

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    patch: jest.fn().mockResolvedValue({ ok: true, data: DRAFT_SURVEY }),
    getProjectUrl: jest
      .fn()
      .mockReturnValue('https://us.posthog.com/project/1/surveys/survey_01'),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('UpdateSurveyTool', () => {
  it('sends name update', async () => {
    const client = makeClient();
    const tool = new UpdateSurveyTool(client);

    await tool.execute(makeCall({ id: 'survey_01', name: 'Renamed Survey' }));

    expect(client.patch).toHaveBeenCalledWith(
      '/surveys/survey_01/',
      { name: 'Renamed Survey' },
      expect.anything(),
    );
  });

  it('sends description update', async () => {
    const client = makeClient();
    const tool = new UpdateSurveyTool(client);

    await tool.execute(
      makeCall({ id: 'survey_01', description: 'New description' }),
    );

    expect(client.patch).toHaveBeenCalledWith(
      '/surveys/survey_01/',
      { description: 'New description' },
      expect.anything(),
    );
  });

  it('sets start_date to ISO string when launch is true', async () => {
    const runningSurvey = {
      ...DRAFT_SURVEY,
      start_date: '2024-03-15T10:00:00Z',
    };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: runningSurvey }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateSurveyTool(client);

    await tool.execute(makeCall({ id: 'survey_01', launch: true }));

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body['start_date']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body).not.toHaveProperty('end_date');
  });

  it('does not set start_date when launch is false', async () => {
    const client = makeClient();
    const tool = new UpdateSurveyTool(client);

    await tool.execute(
      makeCall({ id: 'survey_01', launch: false, name: 'Rename only' }),
    );

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('start_date');
  });

  it('sets end_date when stop is true', async () => {
    const stoppedSurvey = {
      ...DRAFT_SURVEY,
      start_date: '2024-03-15T10:00:00Z',
      end_date: '2024-03-20T10:00:00Z',
    };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: stoppedSurvey }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateSurveyTool(client);

    await tool.execute(makeCall({ id: 'survey_01', stop: true }));

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body['end_date']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sends archived flag', async () => {
    const archivedSurvey = { ...DRAFT_SURVEY, archived: true };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: archivedSurvey }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateSurveyTool(client);

    await tool.execute(makeCall({ id: 'survey_01', archived: true }));

    expect(client.patch).toHaveBeenCalledWith(
      '/surveys/survey_01/',
      { archived: true },
      expect.anything(),
    );
  });

  it('sends responses_limit', async () => {
    const client = makeClient();
    const tool = new UpdateSurveyTool(client);

    await tool.execute(makeCall({ id: 'survey_01', responses_limit: 1000 }));

    const body = (client.patch as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body['responses_limit']).toBe(1000);
  });

  it('returns status Running when survey has start_date but no end_date', async () => {
    const runningSurvey = {
      ...DRAFT_SURVEY,
      start_date: '2024-03-15T10:00:00Z',
    };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: runningSurvey }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateSurveyTool(client);

    const result = await tool.execute(
      makeCall({ id: 'survey_01', launch: true }),
    );
    expect(result).toContain('Running');
  });

  it('returns status Stopped when survey has end_date', async () => {
    const stoppedSurvey = {
      ...DRAFT_SURVEY,
      start_date: '2024-03-15T10:00:00Z',
      end_date: '2024-03-20T10:00:00Z',
    };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: stoppedSurvey }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateSurveyTool(client);

    const result = await tool.execute(
      makeCall({ id: 'survey_01', stop: true }),
    );
    expect(result).toContain('Stopped');
  });

  it('returns status Archived when survey is archived', async () => {
    const archivedSurvey = { ...DRAFT_SURVEY, archived: true };
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({ ok: true, data: archivedSurvey }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateSurveyTool(client);

    const result = await tool.execute(
      makeCall({ id: 'survey_01', archived: true }),
    );
    expect(result).toContain('Archived');
  });

  it('returns error for missing id', async () => {
    const tool = new UpdateSurveyTool(makeClient());
    const result = await tool.execute(makeCall({ id: '' }));
    expect(result).toMatch(/id is required/i);
  });

  it('returns error when no fields to update are provided', async () => {
    const tool = new UpdateSurveyTool(makeClient());
    const result = await tool.execute(makeCall({ id: 'survey_01' }));
    expect(result).toMatch(/at least one field/i);
  });

  it('returns error when patch call fails', async () => {
    const client = makeClient({
      patch: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'Survey not found' },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new UpdateSurveyTool(client);

    const result = await tool.execute(
      makeCall({ id: 'survey_01', name: 'New Name' }),
    );
    expect(result).toMatch(/error updating survey/i);
    expect(result).toContain('Survey not found');
  });

  it('has requiresConsent set', () => {
    const tool = new UpdateSurveyTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });
});
