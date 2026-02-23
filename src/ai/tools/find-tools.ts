import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

type ToolResolver = (names: string[]) => string;

const DEFINITION: ToolDefinition = {
  name: 'findTools',
  description:
    'Load on-demand PostHog tools by their exact names so you can call them. ' +
    'Pass the exact tool names from the on-demand list in the system prompt. ' +
    'Once loaded, the tools become available for the rest of this conversation.',
  parameters: {
    type: 'object',
    properties: {
      names: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Exact tool names to load (e.g. ["create-feature-flag", "dashboard-create"])',
      },
    },
    required: ['names'],
    additionalProperties: false,
  },
};

export class FindToolsTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'workspace' as const;
  readonly promptSummary = 'load on-demand PostHog tools by name';

  private _resolve: ToolResolver = () =>
    'Error: tool loading not configured yet.';

  bindResolver(resolve: ToolResolver): void {
    this._resolve = resolve;
  }

  async execute(call: ToolCall): Promise<string> {
    const raw = call.arguments['names'];
    if (!Array.isArray(raw) || raw.length === 0) {
      return 'Error: pass an array of tool names.';
    }
    const names = raw.map(String);
    return this._resolve(names);
  }
}
