import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DISMISSABLE_PREFIXES = ['setup_issue:', 'integration_suggestion:'];

const DEFINITION: ToolDefinition = {
  name: 'dismissDiscovery',
  description:
    'Dismiss a setup issue or integration suggestion from the discoveries panel after you have fixed it. ' +
    'Only call this after all code changes for the fix have been proposed and accepted. ' +
    'The discovery ID is provided in the discovery context.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'The discovery ID to dismiss (e.g. "setup_issue:source_maps_not_configured" or "integration_suggestion:src/pages/checkout.tsx").',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class DismissDiscoveryTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'action' as const;
  readonly promptSummary =
    'dismiss a resolved setup issue or integration suggestion from the discoveries panel';

  constructor(private readonly _onResolved: (discoveryId: string) => void) {}

  async execute(call: ToolCall): Promise<string> {
    const id = String(call.arguments['id'] ?? '').trim();

    if (!id) {
      return 'Error: discovery id is required';
    }

    if (!DISMISSABLE_PREFIXES.some((prefix) => id.startsWith(prefix))) {
      return 'Error: only setup issues and integration suggestions can be dismissed this way';
    }

    this._onResolved(id);
    return `Discovery dismissed: ${id}`;
  }
}
