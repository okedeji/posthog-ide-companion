import type { PostHogApiClient } from '../../api/client';
import { SurveySchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'updateSurvey',
  description:
    'Update an existing PostHog survey. Use the survey ID (from createSurvey or entity-search). ' +
    'You can rename/redescribe it, launch it (start collecting responses), ' +
    'stop it (stop collecting), or archive it. ' +
    'Launch sets start_date to now. Stop sets end_date to now. ' +
    'The user will be asked to confirm before updating.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the survey to update.',
      },
      name: {
        type: 'string',
        description: 'New name for the survey.',
      },
      description: {
        type: 'string',
        description: 'New description for the survey.',
      },
      launch: {
        type: 'boolean',
        description:
          'Set to true to launch the survey now (sets start_date to current time, begins collecting responses).',
      },
      stop: {
        type: 'boolean',
        description:
          'Set to true to stop the survey now (sets end_date to current time, stops collecting responses).',
      },
      archived: {
        type: 'boolean',
        description: 'Set to true to archive the survey, false to unarchive.',
      },
      responses_limit: {
        type: 'number',
        description:
          'Update the maximum number of responses before auto-stopping.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class UpdateSurveyTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary = 'launch, stop, or rename an existing PostHog survey';

  constructor(private readonly _client: PostHogApiClient) {}

  async execute(call: ToolCall): Promise<string> {
    const id = String(call.arguments['id'] ?? '').trim();

    if (!id) {
      return 'Error: id is required';
    }

    const hasName = 'name' in call.arguments;
    const hasDescription = 'description' in call.arguments;
    const hasLaunch = 'launch' in call.arguments;
    const hasStop = 'stop' in call.arguments;
    const hasArchived = 'archived' in call.arguments;
    const hasResponsesLimit = 'responses_limit' in call.arguments;

    if (
      !hasName &&
      !hasDescription &&
      !hasLaunch &&
      !hasStop &&
      !hasArchived &&
      !hasResponsesLimit
    ) {
      return 'Error: provide at least one field to update (name, description, launch, stop, archived, responses_limit)';
    }

    const body: Record<string, unknown> = {};

    if (hasName) {
      body['name'] = String(call.arguments['name']);
    }

    if (hasDescription) {
      body['description'] = String(call.arguments['description']);
    }

    if (hasLaunch && Boolean(call.arguments['launch'])) {
      body['start_date'] = new Date().toISOString();
    }

    if (hasStop && Boolean(call.arguments['stop'])) {
      body['end_date'] = new Date().toISOString();
    }

    if (hasArchived) {
      body['archived'] = Boolean(call.arguments['archived']);
    }

    if (hasResponsesLimit) {
      const limit = Number(call.arguments['responses_limit']);
      if (Number.isInteger(limit) && limit > 0) {
        body['responses_limit'] = limit;
      }
    }

    const result = await this._client.patch(
      `/surveys/${id}/`,
      body,
      SurveySchema,
    );

    if (!result.ok) {
      return `Error updating survey: ${result.error.message}`;
    }

    const survey = result.data;
    const url = this._client.getProjectUrl(`/surveys/${survey.id}`);

    const status = survey.archived
      ? 'Archived'
      : survey.end_date
        ? 'Stopped'
        : survey.start_date
          ? 'Running'
          : 'Draft';

    const lines = [
      `Survey updated.`,
      `  Name: ${survey.name}`,
      `  ID: ${survey.id}`,
      `  Status: ${status}`,
    ];

    lines.push(`  View in PostHog: ${url}`);

    return lines.join('\n');
  }
}
