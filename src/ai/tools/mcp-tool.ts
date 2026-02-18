import type { Tool } from './tool';
import type { PostHogMcpClient } from '../../mcp/client';
import type { ToolDefinition, ToolCall } from '../types';

// Wraps a single MCP tool into the Tool interface so the registry
// treats MCP and local tools identically.
export class McpTool implements Tool {
  readonly definition: ToolDefinition;
  readonly category = 'posthog' as const;
  readonly promptSummary: string;

  constructor(
    private readonly _client: PostHogMcpClient,
    definition: ToolDefinition,
  ) {
    this.definition = definition;
    // Use first sentence of the MCP description
    this.promptSummary =
      definition.description.split('.')[0] || definition.name;
  }

  async execute(call: ToolCall): Promise<string> {
    return this._client.callTool(call.name, call.arguments);
  }
}

export function createMcpTools(client: PostHogMcpClient): Tool[] {
  return client.tools.map((def) => new McpTool(client, def));
}
