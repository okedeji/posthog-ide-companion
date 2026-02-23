import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'think',
  description:
    'Use this to think through a problem step by step before acting. ' +
    'Call it to plan which tools to use, process previous tool results, ' +
    'or reason about complex requests. Does not fetch data or change anything.',
  parameters: {
    type: 'object',
    properties: {
      thought: {
        type: 'string',
        description: 'Your reasoning or plan.',
      },
    },
    required: ['thought'],
    additionalProperties: false,
  },
};

export class ThinkTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'workspace' as const;
  readonly promptSummary = 'reason step by step before acting';

  async execute(call: ToolCall): Promise<string> {
    return String(call.arguments['thought'] ?? '');
  }
}
