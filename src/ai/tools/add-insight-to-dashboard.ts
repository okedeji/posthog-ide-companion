import type { PostHogApiClient } from '../../api/client';
import { InsightSchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'addInsightToDashboard',
  description:
    'Attach an existing PostHog insight to a dashboard. ' +
    'Use this when you have an insight ID and a dashboard ID and want to display ' +
    'the insight on that dashboard. ' +
    'Note: if you are creating a new insight, you can pass dashboard_id directly to createInsight instead. ' +
    'The user will be asked to confirm before updating.',
  parameters: {
    type: 'object',
    properties: {
      insight_id: {
        type: 'number',
        description: 'The numeric ID of the insight to attach.',
      },
      dashboard_id: {
        type: 'number',
        description:
          'The numeric ID of the dashboard to attach the insight to.',
      },
    },
    required: ['insight_id', 'dashboard_id'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class AddInsightToDashboardTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary = 'attach an insight to a PostHog dashboard';

  constructor(private readonly _client: PostHogApiClient) {}

  async execute(call: ToolCall): Promise<string> {
    const insightId = Number(call.arguments['insight_id']);
    const dashboardId = Number(call.arguments['dashboard_id']);

    if (!Number.isInteger(insightId) || insightId <= 0) {
      return 'Error: insight_id must be a positive integer';
    }

    if (!Number.isInteger(dashboardId) || dashboardId <= 0) {
      return 'Error: dashboard_id must be a positive integer';
    }

    // The insights API uses an array so the same insight can appear on multiple dashboards.
    // We fetch current dashboards first so we don't overwrite existing ones.
    const current = await this._client.get(
      `/insights/${insightId}/`,
      InsightSchema,
    );

    if (!current.ok) {
      return `Error fetching insight: ${current.error.message}`;
    }

    const existingDashboards = current.data.dashboards ?? [];

    if (existingDashboards.includes(dashboardId)) {
      return `Insight ${insightId} is already on dashboard ${dashboardId}.`;
    }

    const updatedDashboards = [...existingDashboards, dashboardId];

    const result = await this._client.patch(
      `/insights/${insightId}/`,
      { dashboards: updatedDashboards },
      InsightSchema,
    );

    if (!result.ok) {
      return `Error updating insight: ${result.error.message}`;
    }

    const insight = result.data;
    const url = this._client.getProjectUrl(`/insights/${insight.short_id}`);

    return [
      `Insight added to dashboard.`,
      `  Insight ID: ${insight.id}`,
      `  Dashboard ID: ${dashboardId}`,
      `  View insight: ${url}`,
    ].join('\n');
  }
}
