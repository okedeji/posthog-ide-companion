import type { PostHogApiClient } from '../../api/client';
import { AlertSchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'deleteAlert',
  description:
    'Delete a PostHog alert permanently. Use the alert ID (from createAlert or entity-search). ' +
    'This removes the alert and stops all future checks and notifications. ' +
    'The user will be asked to confirm before deleting.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'number',
        description: 'The numeric ID of the alert to delete.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export type AlertDeletedCallback = (alertId: number) => void;

export class DeleteAlertTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary = 'permanently delete a PostHog alert';

  constructor(
    private readonly _client: PostHogApiClient,
    private readonly _onAlertDeleted?: AlertDeletedCallback,
  ) {}

  async execute(call: ToolCall): Promise<string> {
    const id = Number(call.arguments['id']);
    if (!Number.isInteger(id) || id <= 0) {
      return 'Error: id must be a positive integer';
    }

    // Fetch alert first to get the name for the confirmation message
    const current = await this._client.get(`/alerts/${id}/`, AlertSchema);
    if (!current.ok) {
      return `Error fetching alert: ${current.error.message}`;
    }

    const alertName = current.data.name;

    const result = await this._client.delete(`/alerts/${id}/`);

    if (!result.ok) {
      return `Error deleting alert: ${result.error.message}`;
    }

    this._onAlertDeleted?.(id);

    return [`Alert deleted.`, `  ID: ${id}`, `  Name: ${alertName}`].join('\n');
  }
}
