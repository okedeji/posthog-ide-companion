import type { Tool } from './tool';
import type { PostHogMcpClient } from '../../mcp/client';
import type { ToolDefinition, ToolCall } from '../types';

// Wraps a single MCP tool into the Tool interface so the registry
// treats MCP and local tools identically.
export class McpTool implements Tool {
  readonly definition: ToolDefinition;

  constructor(
    private readonly _client: PostHogMcpClient,
    definition: ToolDefinition,
  ) {
    this.definition = definition;
  }

  async execute(call: ToolCall): Promise<string> {
    return this._client.callTool(call.name, call.arguments);
  }
}

export function createMcpTools(client: PostHogMcpClient): Tool[] {
  return client.tools.map((def) => new McpTool(client, def));
}
