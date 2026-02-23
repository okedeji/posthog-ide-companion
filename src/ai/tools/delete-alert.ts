import type { PostHogApiClient } from '../../api/client';
import { AlertSchema } from '../../api/schemas';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'deleteAlert',
  description:
    'Delete a PostHog alert permanently. Use the alert ID (from createAlert or getAlerts). ' +
    'This removes the alert and stops all future checks and notifications. ' +
    'The user will be asked to confirm before deleting.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the alert to delete.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export type AlertDeletedCallback = (alertId: number | string) => void;

export class DeleteAlertTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary = 'permanently delete a PostHog alert';

  constructor(
    private readonly _client: PostHogApiClient,
    private readonly _onAlertDeleted?: AlertDeletedCallback,
  ) {}

  async execute(call: ToolCall): Promise<string> {
    const id = call.arguments['id'];
    if (id == null || String(id).trim() === '') {
      return 'Error: id is required';
    }

    const current = await this._client.get(`/alerts/${id}/`, AlertSchema);
    if (!current.ok) {
      return `Error fetching alert: ${current.error.message}`;
    }

    const alertName = current.data.name;

    const result = await this._client.delete(`/alerts/${id}/`);

    if (!result.ok) {
      return `Error deleting alert: ${result.error.message}`;
    }

    this._onAlertDeleted?.(current.data.id);

    return [`Alert deleted.`, `  ID: ${id}`, `  Name: ${alertName}`].join('\n');
  }
}
