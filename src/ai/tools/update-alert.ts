import type { PostHogApiClient } from '../../api/client';
import { AlertSchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const VALID_CONDITION_TYPES = [
  'absolute_value',
  'relative_increase',
  'relative_decrease',
];

const VALID_INTERVALS = ['hourly', 'daily', 'weekly', 'monthly'];

const DEFINITION: ToolDefinition = {
  name: 'updateAlert',
  description:
    'Update an existing PostHog alert. Use the alert ID (from createAlert or entity-search). ' +
    'You can enable/disable it, change the threshold, update the condition type, adjust the check interval, or snooze it. ' +
    'When changing threshold bounds, the current alert config is fetched first to preserve other settings. ' +
    'To snooze, set snoozed_until to a duration like "2h" or "1d". To unsnooze, set it to "null". ' +
    'The user will be asked to confirm before updating.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'number',
        description: 'The numeric ID of the alert to update.',
      },
      name: {
        type: 'string',
        description: 'New name for the alert.',
      },
      enabled: {
        type: 'boolean',
        description: 'Set to true to enable, false to disable.',
      },
      condition_type: {
        type: 'string',
        description:
          '"absolute_value", "relative_increase", or "relative_decrease".',
      },
      upper_bound: {
        type: 'number',
        description: 'New upper threshold bound.',
      },
      lower_bound: {
        type: 'number',
        description: 'New lower threshold bound.',
      },
      threshold_type: {
        type: 'string',
        description: '"absolute" or "percentage".',
      },
      calculation_interval: {
        type: 'string',
        description: '"hourly", "daily", "weekly", or "monthly".',
      },
      skip_weekend: {
        type: 'boolean',
        description: 'Skip checks on Saturday and Sunday.',
      },
      snoozed_until: {
        type: 'string',
        description: 'Snooze duration (e.g. "2h", "1d") or "null" to unsnooze.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export type AlertUpdatedCallback = (alertId: number, enabled: boolean) => void;

export class UpdateAlertTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary =
    'enable, disable, snooze, or reconfigure an existing PostHog alert';

  constructor(
    private readonly _client: PostHogApiClient,
    private readonly _onAlertUpdated?: AlertUpdatedCallback,
  ) {}

  async execute(call: ToolCall): Promise<string> {
    const id = Number(call.arguments['id']);
    if (!Number.isInteger(id) || id <= 0) {
      return 'Error: id must be a positive integer';
    }

    const hasName = 'name' in call.arguments;
    const hasEnabled = 'enabled' in call.arguments;
    const hasCondition = 'condition_type' in call.arguments;
    const hasUpper = 'upper_bound' in call.arguments;
    const hasLower = 'lower_bound' in call.arguments;
    const hasThresholdType = 'threshold_type' in call.arguments;
    const hasInterval = 'calculation_interval' in call.arguments;
    const hasSkipWeekend = 'skip_weekend' in call.arguments;
    const hasSnoozed = 'snoozed_until' in call.arguments;

    if (
      !hasName &&
      !hasEnabled &&
      !hasCondition &&
      !hasUpper &&
      !hasLower &&
      !hasThresholdType &&
      !hasInterval &&
      !hasSkipWeekend &&
      !hasSnoozed
    ) {
      return 'Error: provide at least one field to update';
    }

    if (hasCondition) {
      const ct = String(call.arguments['condition_type']);
      if (!VALID_CONDITION_TYPES.includes(ct)) {
        return `Error: condition_type must be one of: ${VALID_CONDITION_TYPES.join(', ')}`;
      }
    }

    if (hasInterval) {
      const iv = String(call.arguments['calculation_interval']);
      if (!VALID_INTERVALS.includes(iv)) {
        return `Error: calculation_interval must be one of: ${VALID_INTERVALS.join(', ')}`;
      }
    }

    const body: Record<string, unknown> = {};

    if (hasName) {
      body['name'] = String(call.arguments['name']);
    }
    if (hasEnabled) {
      body['enabled'] = Boolean(call.arguments['enabled']);
    }
    if (hasCondition) {
      body['condition'] = { type: String(call.arguments['condition_type']) };
    }
    if (hasInterval) {
      body['calculation_interval'] = String(
        call.arguments['calculation_interval'],
      );
    }
    if (hasSkipWeekend) {
      body['skip_weekend'] = Boolean(call.arguments['skip_weekend']);
    }
    if (hasSnoozed) {
      const val = String(call.arguments['snoozed_until']);
      body['snoozed_until'] = val === 'null' ? null : val;
    }

    if (hasUpper || hasLower || hasThresholdType) {
      const current = await this._client.get(`/alerts/${id}/`, AlertSchema);
      if (!current.ok) {
        return `Error fetching alert: ${current.error.message}`;
      }

      const existingConfig = current.data.threshold?.configuration ?? {
        type: 'absolute',
        bounds: {},
      };
      const existingBounds = existingConfig.bounds ?? {};

      const newBounds = { ...existingBounds };
      if (hasUpper) {
        newBounds['upper'] = Number(call.arguments['upper_bound']);
      }
      if (hasLower) {
        newBounds['lower'] = Number(call.arguments['lower_bound']);
      }

      body['threshold'] = {
        configuration: {
          type: hasThresholdType
            ? String(call.arguments['threshold_type'])
            : existingConfig.type,
          bounds: newBounds,
        },
      };
    }

    const result = await this._client.patch(
      `/alerts/${id}/`,
      body,
      AlertSchema,
    );

    if (!result.ok) {
      return `Error updating alert: ${result.error.message}`;
    }

    const alert = result.data;
    this._onAlertUpdated?.(alert.id, alert.enabled);

    const lines = [
      `Alert updated.`,
      `  Name: ${alert.name}`,
      `  ID: ${alert.id}`,
      `  Enabled: ${alert.enabled}`,
    ];

    if (alert.calculation_interval) {
      lines.push(`  Interval: ${alert.calculation_interval}`);
    }

    if (alert.snoozed_until) {
      lines.push(`  Snoozed until: ${alert.snoozed_until}`);
    }

    return lines.join('\n');
  }
}
