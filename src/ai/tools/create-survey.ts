import type { PostHogApiClient } from '../../api/client';
import { SurveySchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const VALID_TYPES = ['popover', 'widget', 'api'] as const;
type SurveyType = (typeof VALID_TYPES)[number];

const VALID_QUESTION_TYPES = [
  'open',
  'link',
  'rating',
  'single_choice',
  'multiple_choice',
] as const;

const DEFINITION: ToolDefinition = {
  name: 'createSurvey',
  description:
    'Create a new survey in PostHog. Surveys let you collect user feedback via in-app popovers, ' +
    'widget buttons, or programmatically via the API. ' +
    'Created as a draft by default (not running). Use updateSurvey to launch it later. ' +
    'The user will be asked to confirm before creating.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the survey (e.g. "Post-Checkout Feedback").',
      },
      type: {
        type: 'string',
        description:
          'How the survey is displayed: "popover" (in-app popup), "widget" (floating button), or "api" (custom implementation).',
      },
      questions: {
        type: 'array',
        description:
          'Survey questions. Each must have a type and question text. ' +
          'Types: "open" (free text), "rating" (scale), "single_choice", "multiple_choice", "link".',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description:
                'Question type: "open", "rating", "single_choice", "multiple_choice", or "link".',
            },
            question: {
              type: 'string',
              description: 'The question text shown to the user.',
            },
            description: {
              type: 'string',
              description: 'Optional description/subtitle for the question.',
            },
            choices: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Answer options for single_choice and multiple_choice questions.',
            },
            link: {
              type: 'string',
              description: 'URL for link-type questions.',
            },
          },
          required: ['type', 'question'],
          additionalProperties: false,
        },
      },
      description: {
        type: 'string',
        description: 'Optional internal description of the survey purpose.',
      },
      linked_flag_id: {
        type: 'number',
        description:
          'ID of an existing feature flag to link. The survey only shows to users who match the flag.',
      },
      responses_limit: {
        type: 'number',
        description:
          'Optional cap on total responses. The survey stops after reaching this limit.',
      },
    },
    required: ['name', 'type', 'questions'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class CreateSurveyTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary = 'create a new survey in PostHog';

  constructor(private readonly _client: PostHogApiClient) {}

  async execute(call: ToolCall): Promise<string> {
    const name = String(call.arguments['name'] ?? '').trim();
    const type = String(call.arguments['type'] ?? '').trim();

    if (!name) {
      return 'Error: name is required';
    }

    if (!VALID_TYPES.includes(type as SurveyType)) {
      return `Error: type must be one of: ${VALID_TYPES.join(', ')}`;
    }

    const rawQuestions = call.arguments['questions'];
    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
      return 'Error: questions must be a non-empty array';
    }

    const questions = (rawQuestions as Record<string, unknown>[]).map((q) => {
      const qType = String(q['type'] ?? '');
      const obj: Record<string, unknown> = {
        type: qType,
        question: String(q['question'] ?? ''),
      };
      if (q['description'] != null) {
        obj['description'] = String(q['description']);
      }
      if (Array.isArray(q['choices'])) {
        obj['choices'] = (q['choices'] as unknown[]).map(String);
      }
      if (q['link'] != null) {
        obj['link'] = String(q['link']);
      }
      return obj;
    });

    // Validate question types
    for (const q of questions) {
      if (
        !VALID_QUESTION_TYPES.includes(
          q['type'] as (typeof VALID_QUESTION_TYPES)[number],
        )
      ) {
        return `Error: invalid question type "${q['type']}". Must be one of: ${VALID_QUESTION_TYPES.join(', ')}`;
      }
    }

    const body: Record<string, unknown> = { name, type, questions };

    if (call.arguments['description'] != null) {
      body['description'] = String(call.arguments['description']);
    }

    if (call.arguments['linked_flag_id'] != null) {
      const flagId = Number(call.arguments['linked_flag_id']);
      if (Number.isInteger(flagId) && flagId > 0) {
        body['linked_flag_id'] = flagId;
      }
    }

    if (call.arguments['responses_limit'] != null) {
      const limit = Number(call.arguments['responses_limit']);
      if (Number.isInteger(limit) && limit > 0) {
        body['responses_limit'] = limit;
      }
    }

    const result = await this._client.post('/surveys/', body, SurveySchema);

    if (!result.ok) {
      return `Error creating survey: ${result.error.message}`;
    }

    const survey = result.data;
    const url = this._client.getProjectUrl(`/surveys/${survey.id}`);

    const lines = [
      `Survey created (draft — not running yet).`,
      `  Name: ${survey.name}`,
      `  ID: ${survey.id}`,
      `  Type: ${survey.type}`,
      `  Questions: ${questions.length}`,
    ];

    if (survey.linked_flag_id) {
      lines.push(`  Linked flag ID: ${survey.linked_flag_id}`);
    }

    lines.push(`  View in PostHog: ${url}`);

    return lines.join('\n');
  }
}
