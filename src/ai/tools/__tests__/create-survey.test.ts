import { CreateSurveyTool } from '../create-survey';
import type { PostHogApiClient } from '../../../api/client';
import type { ToolCall } from '../../types';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name: 'createSurvey', arguments: args };
}

const CREATED_SURVEY = {
  id: 'survey_01',
  name: 'Post-Checkout Feedback',
  description: null,
  type: 'popover',
  questions: [{ type: 'open', question: 'How was your experience?' }],
  conditions: null,
  start_date: null,
  end_date: null,
  archived: false,
  linked_flag_id: null,
  responses_limit: null,
  created_at: '2024-03-15T10:00:00Z',
};

function makeClient(overrides?: Partial<PostHogApiClient>): PostHogApiClient {
  return {
    post: jest.fn().mockResolvedValue({ ok: true, data: CREATED_SURVEY }),
    getProjectUrl: jest
      .fn()
      .mockReturnValue('https://us.posthog.com/project/1/surveys/survey_01'),
    ...overrides,
  } as unknown as PostHogApiClient;
}

describe('CreateSurveyTool', () => {
  it('sends correct payload with popover type and one question', async () => {
    const client = makeClient();
    const tool = new CreateSurveyTool(client);

    await tool.execute(
      makeCall({
        name: 'Post-Checkout Feedback',
        type: 'popover',
        questions: [{ type: 'open', question: 'How was your experience?' }],
      }),
    );

    expect(client.post).toHaveBeenCalledWith(
      '/surveys/',
      expect.objectContaining({
        name: 'Post-Checkout Feedback',
        type: 'popover',
        questions: [{ type: 'open', question: 'How was your experience?' }],
      }),
      expect.anything(),
    );
  });

  it('sends multiple choice question with choices', async () => {
    const client = makeClient();
    const tool = new CreateSurveyTool(client);

    await tool.execute(
      makeCall({
        name: 'Feature Poll',
        type: 'widget',
        questions: [
          {
            type: 'single_choice',
            question: 'What feature do you want next?',
            choices: ['Dark mode', 'Export to PDF', 'Mobile app'],
          },
        ],
      }),
    );

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const questions = body['questions'] as Record<string, unknown>[];
    expect(questions[0]['choices']).toEqual([
      'Dark mode',
      'Export to PDF',
      'Mobile app',
    ]);
  });

  it('includes description when provided', async () => {
    const client = makeClient();
    const tool = new CreateSurveyTool(client);

    await tool.execute(
      makeCall({
        name: 'My Survey',
        type: 'popover',
        questions: [{ type: 'open', question: 'Thoughts?' }],
        description: 'Internal test survey',
      }),
    );

    expect(client.post).toHaveBeenCalledWith(
      '/surveys/',
      expect.objectContaining({ description: 'Internal test survey' }),
      expect.anything(),
    );
  });

  it('includes linked_flag_id when provided', async () => {
    const client = makeClient();
    const tool = new CreateSurveyTool(client);

    await tool.execute(
      makeCall({
        name: 'My Survey',
        type: 'popover',
        questions: [{ type: 'open', question: 'Thoughts?' }],
        linked_flag_id: 42,
      }),
    );

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body['linked_flag_id']).toBe(42);
  });

  it('includes responses_limit when provided', async () => {
    const client = makeClient();
    const tool = new CreateSurveyTool(client);

    await tool.execute(
      makeCall({
        name: 'My Survey',
        type: 'api',
        questions: [{ type: 'rating', question: 'Rate us' }],
        responses_limit: 500,
      }),
    );

    const body = (client.post as jest.Mock).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body['responses_limit']).toBe(500);
  });

  it('returns success message with id and url', async () => {
    const client = makeClient();
    const tool = new CreateSurveyTool(client);

    const result = await tool.execute(
      makeCall({
        name: 'Post-Checkout Feedback',
        type: 'popover',
        questions: [{ type: 'open', question: 'How was your experience?' }],
      }),
    );

    expect(result).toContain('Survey created');
    expect(result).toContain('draft');
    expect(result).toContain('survey_01');
    expect(result).toContain(
      'https://us.posthog.com/project/1/surveys/survey_01',
    );
  });

  it('returns error for empty name', async () => {
    const tool = new CreateSurveyTool(makeClient());
    const result = await tool.execute(
      makeCall({
        name: '',
        type: 'popover',
        questions: [{ type: 'open', question: 'Test?' }],
      }),
    );
    expect(result).toMatch(/name is required/i);
  });

  it('returns error for invalid type', async () => {
    const tool = new CreateSurveyTool(makeClient());
    const result = await tool.execute(
      makeCall({
        name: 'My Survey',
        type: 'email',
        questions: [{ type: 'open', question: 'Test?' }],
      }),
    );
    expect(result).toMatch(/type must be one of/i);
  });

  it('returns error for empty questions array', async () => {
    const tool = new CreateSurveyTool(makeClient());
    const result = await tool.execute(
      makeCall({ name: 'My Survey', type: 'popover', questions: [] }),
    );
    expect(result).toMatch(/non-empty array/i);
  });

  it('returns error for invalid question type', async () => {
    const tool = new CreateSurveyTool(makeClient());
    const result = await tool.execute(
      makeCall({
        name: 'My Survey',
        type: 'popover',
        questions: [{ type: 'essay', question: 'Test?' }],
      }),
    );
    expect(result).toMatch(/invalid question type/i);
  });

  it('returns error when API call fails', async () => {
    const client = makeClient({
      post: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'unknown', message: 'Validation error' },
      }),
    } as Partial<PostHogApiClient>);
    const tool = new CreateSurveyTool(client);

    const result = await tool.execute(
      makeCall({
        name: 'My Survey',
        type: 'popover',
        questions: [{ type: 'open', question: 'Test?' }],
      }),
    );

    expect(result).toMatch(/error creating survey/i);
    expect(result).toContain('Validation error');
  });

  it('has requiresConsent set', () => {
    const tool = new CreateSurveyTool(makeClient());
    expect(tool.definition.requiresConsent).toBe(true);
  });
});
