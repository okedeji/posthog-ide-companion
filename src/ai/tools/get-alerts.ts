import type { PostHogApiClient } from '../../api/client';
import { AlertListSchema } from '../../api/schemas';
import type { Alert } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const VALID_STATES = ['firing', 'not_firing', 'snoozed'];

const DEFINITION: ToolDefinition = {
  name: 'getAlerts',
  description:
    'List PostHog alerts for the current project. Can filter by insight, state, or enabled status. ' +
    'Returns alert name, ID, state, condition, thresholds, and interval.',
  parameters: {
    type: 'object',
    properties: {
      insight_id: {
        type: 'number',
        description: 'Only return alerts monitoring this insight.',
      },
      state: {
        type: 'string',
        description:
          'Filter by state: "firing", "not_firing", or "snoozed". Omit to include all states.',
      },
      enabled: {
        type: 'boolean',
        description: 'Filter by enabled status. Omit to include both.',
      },
    },
    additionalProperties: false,
  },
};

export class GetAlertsTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary = 'list PostHog alerts for the current project';

  constructor(private readonly _client: PostHogApiClient) {}

  async execute(call: ToolCall): Promise<string> {
    const insightId =
      call.arguments['insight_id'] != null
        ? Number(call.arguments['insight_id'])
        : undefined;
    const stateFilter =
      call.arguments['state'] != null
        ? String(call.arguments['state']).toLowerCase().replace(/ /g, '_')
        : undefined;
    const enabledFilter =
      call.arguments['enabled'] != null
        ? Boolean(call.arguments['enabled'])
        : undefined;

    if (stateFilter && !VALID_STATES.includes(stateFilter)) {
      return `Error: state must be one of: ${VALID_STATES.join(', ')}`;
    }

    const query = insightId ? `?insight=${insightId}` : '';
    const result = await this._client.get(`/alerts/${query}`, AlertListSchema);

    if (!result.ok) {
      return `Error fetching alerts: ${result.error.message}`;
    }

    let alerts = result.data.results;

    if (stateFilter) {
      alerts = alerts.filter(
        (a) => a.state?.toLowerCase().replace(/ /g, '_') === stateFilter,
      );
    }
    if (enabledFilter !== undefined) {
      alerts = alerts.filter((a) => a.enabled === enabledFilter);
    }

    if (alerts.length === 0) {
      const parts: string[] = [];
      if (insightId) parts.push(`insight ${insightId}`);
      if (stateFilter) parts.push(`state "${stateFilter}"`);
      if (enabledFilter !== undefined) parts.push(`enabled=${enabledFilter}`);
      const suffix = parts.length > 0 ? ` matching ${parts.join(', ')}` : '';
      return `No alerts found${suffix}.`;
    }

    const header = `Found ${alerts.length} alert${alerts.length === 1 ? '' : 's'}:\n`;
    return header + alerts.map(formatAlert).join('\n\n');
  }
}

function formatAlert(alert: Alert): string {
  const lines = [
    `**${alert.name}** (ID: ${alert.id})`,
    `  State: ${alert.state ?? 'unknown'}`,
    `  Enabled: ${alert.enabled}`,
  ];

  if (alert.condition?.type) {
    lines.push(`  Condition: ${alert.condition.type}`);
  }

  const bounds = alert.threshold?.configuration?.bounds;
  if (bounds) {
    if (bounds.upper != null) lines.push(`  Upper bound: ${bounds.upper}`);
    if (bounds.lower != null) lines.push(`  Lower bound: ${bounds.lower}`);
  }

  if (alert.calculation_interval) {
    lines.push(`  Interval: ${alert.calculation_interval}`);
  }

  if (alert.snoozed_until) {
    lines.push(`  Snoozed until: ${alert.snoozed_until}`);
  }

  if (alert.last_checked_at) {
    lines.push(`  Last checked: ${alert.last_checked_at}`);
  }

  return lines.join('\n');
}
