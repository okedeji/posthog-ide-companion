import type { PostHogApiClient } from '../../api/client';
import { FeatureFlagSchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

// key must match PostHog's validation: letters, numbers, hyphens, underscores only
const VALID_KEY = /^[a-zA-Z0-9_-]+$/;

const DEFINITION: ToolDefinition = {
  name: 'createFeatureFlag',
  description:
    'Create a new feature flag in PostHog. Use kebab-case for the key (e.g. "new-checkout-flow"). ' +
    'Set rollout_percentage to control what percentage of users see the flag (0 = nobody, 100 = everyone). ' +
    'Use targeting_rules to restrict the flag to specific users (e.g. by email, country, or any person property). ' +
    'Each rule has: key (property name), value (what to match), operator (e.g. "exact", "icontains", "gt"), ' +
    'and type ("person" for user properties — the most common). ' +
    'If unsure about available operators or property types, use docs-search to look up PostHog feature flag targeting. ' +
    'The flag is enabled by default (active: true). The user will be asked to confirm before creating.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description:
          'Unique identifier for the flag. kebab-case, letters/numbers/hyphens/underscores only (e.g. "new-checkout-flow").',
      },
      name: {
        type: 'string',
        description: 'Human-readable label for the flag.',
      },
      description: {
        type: 'string',
        description: 'Optional description of what the flag does.',
      },
      rollout_percentage: {
        type: 'number',
        description:
          'Percentage of matching users who see the flag (0-100). Defaults to 100 when targeting_rules are set, 0 otherwise.',
      },
      active: {
        type: 'boolean',
        description: 'Whether the flag is enabled. Defaults to true.',
      },
      targeting_rules: {
        type: 'array',
        description:
          'Optional property filters to restrict who sees the flag. Each rule targets users by a person or event property. ' +
          'Example: [{ "key": "email", "value": "@company.com", "operator": "icontains", "type": "person" }]. ' +
          'Use docs-search for the full list of supported operators and property types.',
        items: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Property name (e.g. "email", "country").',
            },
            value: {
              description: 'Value to match against. String, number, or array.',
            },
            operator: {
              type: 'string',
              description:
                'Comparison operator: "exact", "is_not", "icontains", "not_icontains", "regex", "not_regex", "gt", "gte", "lt", "lte", "is_set", "is_not_set".',
            },
            type: {
              type: 'string',
              description:
                'Property type: "person" (default), "cohort", "group".',
            },
          },
          required: ['key', 'value', 'operator'],
          additionalProperties: false,
        },
      },
    },
    required: ['key', 'name'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class CreateFeatureFlagTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary = 'create a new feature flag in PostHog';

  constructor(private readonly _client: PostHogApiClient) {}

  async execute(call: ToolCall): Promise<string> {
    const key = String(call.arguments['key'] ?? '').trim();
    const name = String(call.arguments['name'] ?? '').trim();
    const description =
      call.arguments['description'] != null
        ? String(call.arguments['description'])
        : undefined;
    const active =
      call.arguments['active'] != null
        ? Boolean(call.arguments['active'])
        : true;

    const targetingRules = Array.isArray(call.arguments['targeting_rules'])
      ? (call.arguments['targeting_rules'] as Record<string, unknown>[])
      : [];

    const rollout =
      call.arguments['rollout_percentage'] != null
        ? Number(call.arguments['rollout_percentage'])
        : targetingRules.length > 0
          ? 100
          : 0;

    if (!key) {
      return 'Error: key is required';
    }

    if (!VALID_KEY.test(key)) {
      return 'Error: key may only contain letters, numbers, hyphens, and underscores';
    }

    if (!name) {
      return 'Error: name is required';
    }

    if (rollout < 0 || rollout > 100) {
      return 'Error: rollout_percentage must be between 0 and 100';
    }

    const properties = targetingRules.map((rule) => ({
      key: String(rule['key'] ?? ''),
      value: rule['value'],
      operator: String(rule['operator'] ?? 'exact'),
      type: String(rule['type'] ?? 'person'),
    }));

    const body: Record<string, unknown> = {
      key,
      name,
      active,
      filters: {
        groups: [{ rollout_percentage: rollout, properties }],
      },
    };

    if (description !== undefined) {
      body['description'] = description;
    }

    const result = await this._client.post(
      '/feature_flags/',
      body,
      FeatureFlagSchema,
    );

    if (!result.ok) {
      return `Error creating feature flag: ${result.error.message}`;
    }

    const flag = result.data;
    const url = this._client.getProjectUrl(`/feature_flags/${flag.id}`);
    const targetingSummary =
      properties.length > 0
        ? `\n  Targeting: ${properties.map((p) => `${p.key} ${p.operator} ${String(p.value)}`).join(', ')}`
        : '';

    return [
      `Feature flag created.`,
      `  Key: ${flag.key}`,
      `  ID: ${flag.id}`,
      `  Rollout: ${rollout}%${targetingSummary}`,
      `  Active: ${flag.active}`,
      `  View in PostHog: ${url}`,
    ].join('\n');
  }
}
