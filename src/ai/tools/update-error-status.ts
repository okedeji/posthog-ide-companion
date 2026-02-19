import { z } from 'zod';
import type { PostHogApiClient } from '../../api/client';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

// The PATCH endpoint only accepts these three statuses.
// Other statuses visible in query results (archived, pending_release) are set through different mechanisms.
const VALID_STATUSES = ['active', 'resolved', 'suppressed'] as const;
type ErrorStatus = (typeof VALID_STATUSES)[number];

// Minimal schema for the PATCH response
const ErrorTrackingIssueUpdateSchema = z.object({
  id: z.string(),
  status: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

const DEFINITION: ToolDefinition = {
  name: 'updateErrorStatus',
  description:
    'Update the status of a PostHog error tracking issue. ' +
    'Use this after investigating an error to mark it as resolved or suppressed, or to reopen it. ' +
    'The error ID comes from the error investigation context or entity-search. ' +
    'The user will be asked to confirm before updating.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The UUID of the error tracking issue.',
      },
      status: {
        type: 'string',
        description:
          'New status: "resolved" (fixed), "suppressed" (ignore future occurrences), or "active" (reopen).',
      },
    },
    required: ['id', 'status'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export type StatusChangedCallback = (
  errorId: string,
  newStatus: string,
) => void;

export class UpdateErrorStatusTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'posthog' as const;
  readonly promptSummary =
    'update the status of a PostHog error tracking issue';

  constructor(
    private readonly _client: PostHogApiClient,
    private readonly _onStatusChanged?: StatusChangedCallback,
  ) {}

  async execute(call: ToolCall): Promise<string> {
    const id = String(call.arguments['id'] ?? '').trim();
    const status = String(call.arguments['status'] ?? '').trim();

    if (!id) {
      return 'Error: id is required';
    }

    if (!VALID_STATUSES.includes(status as ErrorStatus)) {
      return `Error: status must be one of: ${VALID_STATUSES.join(', ')}`;
    }

    const result = await this._client.patch(
      `/error_tracking/issues/${id}/`,
      { status },
      ErrorTrackingIssueUpdateSchema,
    );

    if (!result.ok) {
      return `Error updating error status: ${result.error.message}`;
    }

    this._onStatusChanged?.(id, status);

    const issue = result.data;
    const label = issue.name ?? issue.description ?? id.slice(0, 8);
    const url = this._client.getProjectUrl(`/error_tracking/${issue.id}`);

    return [
      `Error status updated.`,
      `  Issue: ${label}`,
      `  Status: ${issue.status}`,
      `  View in PostHog: ${url}`,
    ].join('\n');
  }
}
