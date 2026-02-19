import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'dismissDiscovery',
  description:
    'Dismiss a setup issue from the discoveries panel after you have fixed it. ' +
    'Only call this after all code changes for the fix have been proposed and accepted. ' +
    'The discovery ID is provided in the setup issue context.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'The discovery ID to dismiss (e.g. "setup_issue:source_maps_not_configured").',
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
    'dismiss a resolved setup issue from the discoveries panel';

  constructor(private readonly _onResolved: (discoveryId: string) => void) {}

  async execute(call: ToolCall): Promise<string> {
    const id = String(call.arguments['id'] ?? '').trim();

    if (!id) {
      return 'Error: discovery id is required';
    }

    if (!id.startsWith('setup_issue:')) {
      return 'Error: only setup issue discoveries can be dismissed this way';
    }

    this._onResolved(id);
    return `Discovery dismissed: ${id}`;
  }
}
