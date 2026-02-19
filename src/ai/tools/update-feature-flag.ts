import type { PostHogApiClient } from '../../api/client';
import { FeatureFlagSchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'updateFeatureFlag',
  description:
    'Update an existing PostHog feature flag. Use the flag ID (from createFeatureFlag or entity-search). ' +
    'You can toggle it on/off, change the rollout percentage, update targeting rules, or rename it. ' +
    'When changing rollout_percentage or targeting_rules, the current flag is fetched first. ' +
    'Providing targeting_rules replaces all existing targeting on the flag. ' +
    'If unsure about available operators or property types, use docs-search to look up PostHog feature flag targeting. ' +
    'The user will be asked to confirm before updating.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'number',
        description: 'The numeric ID of the feature flag to update.',
      },
      active: {
        type: 'boolean',
        description: 'Set to true to enable the flag, false to disable it.',
      },
      rollout_percentage: {
        type: 'number',
        description:
          'New rollout percentage (0–100). Existing targeting rules are preserved unless targeting_rules is also provided.',
      },
      targeting_rules: {
        type: 'array',
        description:
          "Replace the flag's targeting rules. Provide an empty array to remove all targeting (flag will apply to everyone at rollout_percentage). " +
          'Each rule targets users by a person or event property. ' +
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
      name: {
        type: 'string',
        description: 'New human-readable label for the flag.',
      },
      description: {
        type: 'string',
        description: 'New description for the flag.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class UpdateFeatureFlagTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary =
    'toggle, ramp, retarget, or rename an existing PostHog feature flag';

  constructor(private readonly _client: PostHogApiClient) {}

  async execute(call: ToolCall): Promise<string> {
    const id = Number(call.arguments['id']);

    if (!Number.isInteger(id) || id <= 0) {
      return 'Error: id must be a positive integer';
    }

    const hasActive = 'active' in call.arguments;
    const hasRollout = 'rollout_percentage' in call.arguments;
    const hasTargeting = 'targeting_rules' in call.arguments;
    const hasName = 'name' in call.arguments;
    const hasDescription = 'description' in call.arguments;

    if (
      !hasActive &&
      !hasRollout &&
      !hasTargeting &&
      !hasName &&
      !hasDescription
    ) {
      return 'Error: provide at least one field to update (active, rollout_percentage, targeting_rules, name, description)';
    }

    const body: Record<string, unknown> = {};

    if (hasActive) {
      body['active'] = Boolean(call.arguments['active']);
    }

    if (hasName) {
      body['name'] = String(call.arguments['name']);
    }

    if (hasDescription) {
      body['description'] = String(call.arguments['description']);
    }

    if (hasRollout || hasTargeting) {
      const rollout = hasRollout
        ? Number(call.arguments['rollout_percentage'])
        : undefined;

      if (rollout !== undefined && (rollout < 0 || rollout > 100)) {
        return 'Error: rollout_percentage must be between 0 and 100';
      }

      // Fetch current flag to merge rollout/targeting without clobbering the rest of filters
      const current = await this._client.get(
        `/feature_flags/${id}/`,
        FeatureFlagSchema,
      );
      if (!current.ok) {
        return `Error fetching flag: ${current.error.message}`;
      }

      const existingGroups = current.data.filters?.groups ?? [
        { properties: [] },
      ];

      const newProperties = hasTargeting
        ? (call.arguments['targeting_rules'] as Record<string, unknown>[]).map(
            (rule) => ({
              key: String(rule['key'] ?? ''),
              value: rule['value'],
              operator: String(rule['operator'] ?? 'exact'),
              type: String(rule['type'] ?? 'person'),
            }),
          )
        : undefined;

      const updatedGroups = existingGroups.map((g, i) => {
        if (i !== 0) return g;
        const updated = { ...g };
        if (rollout !== undefined) updated.rollout_percentage = rollout;
        if (newProperties !== undefined) updated.properties = newProperties;
        return updated;
      });

      body['filters'] = { ...current.data.filters, groups: updatedGroups };
    }

    const result = await this._client.patch(
      `/feature_flags/${id}/`,
      body,
      FeatureFlagSchema,
    );

    if (!result.ok) {
      return `Error updating feature flag: ${result.error.message}`;
    }

    const flag = result.data;
    const url = this._client.getProjectUrl(`/feature_flags/${flag.id}`);
    const rolloutNow =
      flag.filters?.groups?.[0]?.rollout_percentage ?? 'unchanged';
    const propertiesNow = flag.filters?.groups?.[0]?.properties ?? [];
    const targetingSummary =
      propertiesNow.length > 0
        ? `\n  Targeting: ${(propertiesNow as Array<{ key: string; operator: string; value: unknown }>).map((p) => `${p.key} ${p.operator} ${String(p.value)}`).join(', ')}`
        : '';

    return [
      `Feature flag updated.`,
      `  Key: ${flag.key}`,
      `  Active: ${flag.active}`,
      `  Rollout: ${rolloutNow}%${targetingSummary}`,
      `  View in PostHog: ${url}`,
    ].join('\n');
  }
}
