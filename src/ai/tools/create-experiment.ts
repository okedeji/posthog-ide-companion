import type { PostHogApiClient } from '../../api/client';
import { ExperimentSchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

// key must match PostHog's validation: letters, numbers, hyphens, underscores only
const VALID_KEY = /^[a-zA-Z0-9_-]+$/;

const DEFINITION: ToolDefinition = {
  name: 'createExperiment',
  description:
    'Create a new A/B experiment in PostHog. PostHog will automatically create the underlying ' +
    'multivariate feature flag — you do not need to create it separately. ' +
    'By default the experiment is created as a draft (not running yet). ' +
    'Use launchExperiment or updateExperiment to start it when ready. ' +
    'The experiment splits users into variants (control vs test) and lets you measure ' +
    'which performs better. Variants default to control/test at 50/50 if not specified. ' +
    'rollout_percentage controls what % of all users even enter the experiment (default 100). ' +
    'The user will be asked to confirm before creating.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'Human-readable name for the experiment (e.g. "Checkout Button Color Test").',
      },
      feature_flag_key: {
        type: 'string',
        description:
          'Key for the auto-created feature flag. kebab-case, letters/numbers/hyphens/underscores only ' +
          '(e.g. "checkout-button-color"). Must not already exist unless it is already multivariate with a "control" variant.',
      },
      description: {
        type: 'string',
        description: 'Optional description of what the experiment is testing.',
      },
      variants: {
        type: 'array',
        description:
          'Experiment variants. Must include a "control" variant. Defaults to [{key:"control", rollout_percentage:50}, {key:"test", rollout_percentage:50}]. ' +
          'rollout_percentage here is the relative weight between variants (not the % of all users — use rollout_percentage at the top level for that).',
        items: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'Variant identifier (e.g. "control", "test", "red-button").',
            },
            name: {
              type: 'string',
              description:
                'Human-readable variant label (e.g. "Control Group", "Red Button").',
            },
            rollout_percentage: {
              type: 'number',
              description:
                "Relative weight for this variant (0-100). All variants' weights need not sum to 100.",
            },
          },
          required: ['key', 'rollout_percentage'],
          additionalProperties: false,
        },
      },
      rollout_percentage: {
        type: 'number',
        description:
          'Percentage of all users who enter the experiment (0-100). Defaults to 100.',
      },
    },
    required: ['name', 'feature_flag_key'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class CreateExperimentTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary = 'create a new A/B experiment in PostHog';

  constructor(private readonly _client: PostHogApiClient) {}

  async execute(call: ToolCall): Promise<string> {
    const name = String(call.arguments['name'] ?? '').trim();
    const featureFlagKey = String(
      call.arguments['feature_flag_key'] ?? '',
    ).trim();
    const description =
      call.arguments['description'] != null
        ? String(call.arguments['description'])
        : undefined;

    const rolloutPercentage =
      call.arguments['rollout_percentage'] != null
        ? Number(call.arguments['rollout_percentage'])
        : 100;

    if (!name) {
      return 'Error: name is required';
    }

    if (!featureFlagKey) {
      return 'Error: feature_flag_key is required';
    }

    if (!VALID_KEY.test(featureFlagKey)) {
      return 'Error: feature_flag_key may only contain letters, numbers, hyphens, and underscores';
    }

    if (rolloutPercentage < 0 || rolloutPercentage > 100) {
      return 'Error: rollout_percentage must be between 0 and 100';
    }

    const rawVariants = Array.isArray(call.arguments['variants'])
      ? (call.arguments['variants'] as Record<string, unknown>[])
      : null;

    if (rawVariants !== null) {
      if (rawVariants.length < 2) {
        return 'Error: variants must include at least 2 entries';
      }
      if (!rawVariants.some((v) => String(v['key']) === 'control')) {
        return 'Error: variants must include a "control" variant';
      }
    }

    const body: Record<string, unknown> = {
      name,
      feature_flag_key: featureFlagKey,
    };

    if (description !== undefined) {
      body['description'] = description;
    }

    const variants = rawVariants
      ? rawVariants.map((v) => ({
          key: String(v['key']),
          name: v['name'] != null ? String(v['name']) : undefined,
          rollout_percentage: Number(v['rollout_percentage'] ?? 50),
        }))
      : [
          { key: 'control', name: 'Control Group', rollout_percentage: 50 },
          { key: 'test', name: 'Test Variant', rollout_percentage: 50 },
        ];

    body['parameters'] = {
      feature_flag_variants: variants,
      rollout_percentage: rolloutPercentage,
    };

    const result = await this._client.post(
      '/experiments/',
      body,
      ExperimentSchema,
    );

    if (!result.ok) {
      return `Error creating experiment: ${result.error.message}`;
    }

    const exp = result.data;
    const url = this._client.getProjectUrl(`/experiments/${exp.id}`);
    const variantSummary = variants
      .map((v) => `${v.key} (${v.rollout_percentage}%)`)
      .join(', ');

    return [
      `Experiment created (draft — not running yet).`,
      `  Name: ${exp.name}`,
      `  ID: ${exp.id}`,
      `  Flag key: ${exp.feature_flag_key}`,
      `  Variants: ${variantSummary}`,
      `  Exposure: ${rolloutPercentage}% of users`,
      `  View in PostHog: ${url}`,
    ].join('\n');
  }
}
