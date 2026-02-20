import type { PostHogApiClient } from '../../api/client';
import { AlertSchema, InsightSchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const VALID_CONDITION_TYPES = [
  'absolute_value',
  'relative_increase',
  'relative_decrease',
];

const VALID_INTERVALS = ['hourly', 'daily', 'weekly', 'monthly'];

const DEFINITION: ToolDefinition = {
  name: 'createAlert',
  description:
    'Create a PostHog alert that monitors a Trends insight and fires when a threshold is crossed. ' +
    'You can provide an existing insight_id, or provide an event_name to auto-create a simple Trends insight. ' +
    'If the user mentions a specific chart or insight, search for it first (via entity-search) and use its ID. ' +
    'If no matching insight exists, provide event_name to create one automatically. ' +
    'Supports three condition types: absolute_value (raw metric crosses threshold), ' +
    'relative_increase (metric increases by more than threshold), relative_decrease (metric decreases by more than threshold). ' +
    'The user will be asked to confirm before creating.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'Human-readable name for the alert (e.g. "High error rate").',
      },
      insight_id: {
        type: 'number',
        description:
          'ID of an existing Trends insight to monitor. If omitted, provide event_name to auto-create one.',
      },
      event_name: {
        type: 'string',
        description:
          'PostHog event name (e.g. "$exception", "purchase"). If no insight_id is provided, ' +
          'a simple Trends insight tracking this event will be created automatically.',
      },
      condition_type: {
        type: 'string',
        description:
          'When the alert fires: "absolute_value" (metric crosses threshold), ' +
          '"relative_increase" (metric increases by threshold), "relative_decrease" (metric decreases by threshold).',
      },
      upper_bound: {
        type: 'number',
        description:
          'Upper threshold. Alert fires when metric exceeds this value. Provide at least one of upper_bound or lower_bound.',
      },
      lower_bound: {
        type: 'number',
        description:
          'Lower threshold. Alert fires when metric drops below this value.',
      },
      threshold_type: {
        type: 'string',
        description:
          'How to interpret the bounds: "absolute" (default, raw numbers) or "percentage" (0.5 = 50%, for relative conditions only).',
      },
      calculation_interval: {
        type: 'string',
        description:
          'How often to check: "hourly", "daily" (default), "weekly", or "monthly".',
      },
      skip_weekend: {
        type: 'boolean',
        description: 'Skip checks on Saturday and Sunday. Defaults to false.',
      },
    },
    required: ['name', 'condition_type'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class CreateAlertTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary =
    'create a PostHog alert that fires when a metric crosses a threshold';

  constructor(private readonly _client: PostHogApiClient) {}

  async execute(call: ToolCall): Promise<string> {
    const name = String(call.arguments['name'] ?? '').trim();
    if (!name) {
      return 'Error: name is required';
    }

    const conditionType = String(call.arguments['condition_type'] ?? '').trim();
    if (!VALID_CONDITION_TYPES.includes(conditionType)) {
      return `Error: condition_type must be one of: ${VALID_CONDITION_TYPES.join(', ')}`;
    }

    const hasUpper = call.arguments['upper_bound'] != null;
    const hasLower = call.arguments['lower_bound'] != null;
    if (!hasUpper && !hasLower) {
      return 'Error: provide at least one of upper_bound or lower_bound';
    }

    const hasInsightId = call.arguments['insight_id'] != null;
    const hasEventName =
      call.arguments['event_name'] != null &&
      String(call.arguments['event_name']).trim() !== '';

    if (!hasInsightId && !hasEventName) {
      return 'Error: provide either insight_id (existing Trends insight) or event_name (to auto-create one)';
    }

    const interval = call.arguments['calculation_interval']
      ? String(call.arguments['calculation_interval'])
      : 'daily';
    if (!VALID_INTERVALS.includes(interval)) {
      return `Error: calculation_interval must be one of: ${VALID_INTERVALS.join(', ')}`;
    }

    const lines: string[] = [];
    let insightId: number;

    if (hasInsightId) {
      insightId = Number(call.arguments['insight_id']);
      if (!Number.isInteger(insightId) || insightId <= 0) {
        return 'Error: insight_id must be a positive integer';
      }
    } else {
      const eventName = String(call.arguments['event_name']).trim();
      const insightResult = await this._client.post(
        '/insights/',
        {
          name: `${eventName} trend (auto-created for alert)`,
          query: {
            kind: 'TrendsQuery',
            series: [{ event: eventName, kind: 'EventsNode' }],
            dateRange: { date_from: '-30d' },
          },
        },
        InsightSchema,
      );

      if (!insightResult.ok) {
        return `Error creating insight for alert: ${insightResult.error.message}`;
      }

      insightId = insightResult.data.id;
      const insightUrl = this._client.getProjectUrl(
        `/insights/${insightResult.data.short_id}`,
      );
      lines.push(
        `Created insight "${eventName} trend" (ID: ${insightId}) — ${insightUrl}`,
      );
    }

    const bounds: Record<string, number> = {};
    if (hasUpper) {
      bounds['upper'] = Number(call.arguments['upper_bound']);
    }
    if (hasLower) {
      bounds['lower'] = Number(call.arguments['lower_bound']);
    }

    if (
      bounds['lower'] != null &&
      bounds['upper'] != null &&
      bounds['lower'] >= bounds['upper']
    ) {
      return 'Error: lower_bound must be less than upper_bound';
    }

    const thresholdType = call.arguments['threshold_type']
      ? String(call.arguments['threshold_type'])
      : 'absolute';

    const body: Record<string, unknown> = {
      name,
      insight: insightId,
      condition: { type: conditionType },
      threshold: {
        configuration: {
          type: thresholdType,
          bounds,
        },
      },
      config: {
        type: 'TrendsAlertConfig',
        series_index: 0,
      },
      calculation_interval: interval,
      enabled: true,
    };

    if (call.arguments['skip_weekend'] != null) {
      body['skip_weekend'] = Boolean(call.arguments['skip_weekend']);
    }

    const result = await this._client.post('/alerts/', body, AlertSchema);

    if (!result.ok) {
      return `Error creating alert: ${result.error.message}`;
    }

    const alert = result.data;
    lines.push(`Alert created.`);
    lines.push(`  Name: ${alert.name}`);
    lines.push(`  ID: ${alert.id}`);
    lines.push(`  Condition: ${conditionType}`);
    lines.push(`  Interval: ${interval}`);

    if (hasUpper) {
      lines.push(`  Upper bound: ${bounds['upper']}`);
    }
    if (hasLower) {
      lines.push(`  Lower bound: ${bounds['lower']}`);
    }

    return lines.join('\n');
  }
}
