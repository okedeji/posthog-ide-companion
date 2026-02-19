import type { PostHogApiClient } from '../../api/client';
import { InsightSchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'createInsight',
  description:
    'Save a new insight (chart) in PostHog. Use this after running a query to persist the result ' +
    'as a named chart on a dashboard. Supports two query modes: ' +
    '(1) hogql — write a HogQL SELECT statement; ' +
    '(2) filters — pass a PostHog trends/funnel filter object (events, date_from, etc.). ' +
    'Optionally attach the new insight to a dashboard by providing dashboard_id. ' +
    'The user will be asked to confirm before creating.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the insight (e.g. "Weekly Active Users").',
      },
      hogql: {
        type: 'string',
        description:
          'A HogQL SELECT query. Use this when the insight is based on a raw SQL query ' +
          '(e.g. "SELECT count(), properties.$browser FROM events GROUP BY 2").',
      },
      filters: {
        type: 'object',
        description:
          'A PostHog trends/funnel filter object. Use this for standard chart types. ' +
          'Example: { "events": [{"id": "pageview", "name": "Pageview"}], "date_from": "-7d", "insight": "TRENDS" }.',
        additionalProperties: true,
      },
      description: {
        type: 'string',
        description: 'Optional description of what this insight measures.',
      },
      dashboard_id: {
        type: 'number',
        description:
          'ID of the dashboard to attach this insight to. Use createDashboard first if you need a new one.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class CreateInsightTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary = 'save a new insight chart in PostHog';

  constructor(private readonly _client: PostHogApiClient) {}

  async execute(call: ToolCall): Promise<string> {
    const name = String(call.arguments['name'] ?? '').trim();

    if (!name) {
      return 'Error: name is required';
    }

    const hasHogql =
      'hogql' in call.arguments && call.arguments['hogql'] != null;
    const hasFilters =
      'filters' in call.arguments && call.arguments['filters'] != null;

    if (!hasHogql && !hasFilters) {
      return 'Error: provide either hogql (a HogQL SELECT statement) or filters (a trends/funnel filter object)';
    }

    const body: Record<string, unknown> = { name };

    if (call.arguments['description'] != null) {
      body['description'] = String(call.arguments['description']);
    }

    if (hasHogql) {
      body['query'] = {
        kind: 'HogQLQuery',
        query: String(call.arguments['hogql']),
      };
    } else {
      body['filters'] = call.arguments['filters'];
    }

    if (call.arguments['dashboard_id'] != null) {
      const dashboardId = Number(call.arguments['dashboard_id']);
      if (Number.isInteger(dashboardId) && dashboardId > 0) {
        body['dashboards'] = [dashboardId];
      }
    }

    const result = await this._client.post('/insights/', body, InsightSchema);

    if (!result.ok) {
      return `Error creating insight: ${result.error.message}`;
    }

    const insight = result.data;
    const url = this._client.getProjectUrl(`/insights/${insight.short_id}`);

    const lines = [
      `Insight saved.`,
      `  Name: ${insight.name ?? name}`,
      `  ID: ${insight.id}`,
    ];

    if (insight.dashboards?.length) {
      lines.push(`  Dashboard IDs: ${insight.dashboards.join(', ')}`);
    }

    lines.push(`  View in PostHog: ${url}`);

    return lines.join('\n');
  }
}
