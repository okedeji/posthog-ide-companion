import type { PostHogApiClient } from '../../api/client';
import { DashboardSchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'createDashboard',
  description:
    'Create a new dashboard in PostHog to organise related insights. ' +
    'Returns the dashboard ID and URL. Use the ID with createInsight (dashboard_id) ' +
    'or addInsightToDashboard to attach charts. ' +
    'The user will be asked to confirm before creating.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the dashboard (e.g. "Growth Metrics").',
      },
      description: {
        type: 'string',
        description: 'Optional description of what this dashboard tracks.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class CreateDashboardTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary = 'create a new dashboard in PostHog';

  constructor(private readonly _client: PostHogApiClient) {}

  async execute(call: ToolCall): Promise<string> {
    const name = String(call.arguments['name'] ?? '').trim();

    if (!name) {
      return 'Error: name is required';
    }

    const body: Record<string, unknown> = { name };

    if (call.arguments['description'] != null) {
      body['description'] = String(call.arguments['description']);
    }

    const result = await this._client.post(
      '/dashboards/',
      body,
      DashboardSchema,
    );

    if (!result.ok) {
      return `Error creating dashboard: ${result.error.message}`;
    }

    const dashboard = result.data;
    const url = this._client.getProjectUrl(`/dashboard/${dashboard.id}`);

    const lines = [
      `Dashboard created.`,
      `  Name: ${dashboard.name}`,
      `  ID: ${dashboard.id}`,
      `  View in PostHog: ${url}`,
    ];

    return lines.join('\n');
  }
}
