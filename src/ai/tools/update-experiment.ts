import type { PostHogApiClient } from '../../api/client';
import { ExperimentSchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const VALID_CONCLUSIONS = [
  'won',
  'lost',
  'inconclusive',
  'stopped_early',
  'invalid',
] as const;
type Conclusion = (typeof VALID_CONCLUSIONS)[number];

const DEFINITION: ToolDefinition = {
  name: 'updateExperiment',
  description:
    'Update an existing PostHog experiment. Use the experiment ID (from createExperiment or entity-search). ' +
    'You can rename/redescribe it, launch it (start running), or conclude it (stop and record the winner). ' +
    'Launch sets start_date to now. Conclude sets end_date to now plus an optional conclusion and comment. ' +
    'Once launched, variant keys cannot be changed (only weights). ' +
    'The user will be asked to confirm before updating.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'number',
        description: 'The numeric ID of the experiment to update.',
      },
      name: {
        type: 'string',
        description: 'New name for the experiment.',
      },
      description: {
        type: 'string',
        description: 'New description for the experiment.',
      },
      launch: {
        type: 'boolean',
        description:
          'Set to true to launch the experiment now (sets start_date to current time, activates the feature flag).',
      },
      conclude: {
        type: 'object',
        description: 'Conclude the experiment. Sets end_date to now.',
        properties: {
          conclusion: {
            type: 'string',
            description:
              'Outcome: "won", "lost", "inconclusive", "stopped_early", or "invalid".',
          },
          comment: {
            type: 'string',
            description:
              'Optional free-text explanation of why this conclusion was reached.',
          },
        },
        required: ['conclusion'],
        additionalProperties: false,
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class UpdateExperimentTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary =
    'launch, conclude, or rename an existing PostHog experiment';

  constructor(private readonly _client: PostHogApiClient) {}

  async execute(call: ToolCall): Promise<string> {
    const id = Number(call.arguments['id']);

    if (!Number.isInteger(id) || id <= 0) {
      return 'Error: id must be a positive integer';
    }

    const hasName = 'name' in call.arguments;
    const hasDescription = 'description' in call.arguments;
    const hasLaunch = 'launch' in call.arguments;
    const hasConclude = 'conclude' in call.arguments;

    if (!hasName && !hasDescription && !hasLaunch && !hasConclude) {
      return 'Error: provide at least one field to update (name, description, launch, conclude)';
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

    if (hasConclude) {
      const conclude = call.arguments['conclude'] as Record<string, unknown>;
      const conclusion = String(conclude['conclusion'] ?? '');

      if (!VALID_CONCLUSIONS.includes(conclusion as Conclusion)) {
        return `Error: conclusion must be one of: ${VALID_CONCLUSIONS.join(', ')}`;
      }

      body['end_date'] = new Date().toISOString();
      body['conclusion'] = conclusion;

      if (conclude['comment'] != null) {
        body['conclusion_comment'] = String(conclude['comment']);
      }
    }

    const result = await this._client.patch(
      `/experiments/${id}/`,
      body,
      ExperimentSchema,
    );

    if (!result.ok) {
      return `Error updating experiment: ${result.error.message}`;
    }

    const exp = result.data;
    const url = this._client.getProjectUrl(`/experiments/${exp.id}`);

    const status = exp.end_date
      ? `Concluded (${exp.conclusion ?? 'no conclusion recorded'})`
      : exp.start_date
        ? 'Running'
        : 'Draft';

    const lines = [
      `Experiment updated.`,
      `  Name: ${exp.name}`,
      `  ID: ${exp.id}`,
      `  Status: ${status}`,
    ];

    if (exp.conclusion) {
      lines.push(`  Conclusion: ${exp.conclusion}`);
    }
    if (exp.conclusion_comment) {
      lines.push(`  Comment: ${exp.conclusion_comment}`);
    }

    lines.push(`  View in PostHog: ${url}`);

    return lines.join('\n');
  }
}
