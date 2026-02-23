import type { Tool } from './tool';
import type { PostHogMcpClient } from '../../mcp/client';
import type { ToolDefinition, ToolCall } from '../types';
import type { McpToolHook, McpToolHooks } from './mcp-hooks';

export class McpTool implements Tool {
  readonly definition: ToolDefinition;
  readonly category = 'posthog' as const;
  readonly promptSummary: string;

  constructor(
    private readonly _client: PostHogMcpClient,
    definition: ToolDefinition,
    private readonly _hook?: McpToolHook,
  ) {
    this.definition = definition;
    this.promptSummary =
      definition.description.split('.')[0] || definition.name;
  }

  async execute(call: ToolCall): Promise<string> {
    const result = await this._client.callTool(call.name, call.arguments);

    if (!result.isError && this._hook) {
      try {
        this._hook.onSuccess(call.arguments, result.content);
      } catch {
        // hooks are fire-and-forget
      }
    }

    return result.content;
  }
}

export function createMcpTools(
  client: PostHogMcpClient,
  hooks?: McpToolHooks,
  exclude?: Set<string>,
): Tool[] {
  return client.tools
    .filter((def) => !exclude || !exclude.has(def.name))
    .map((def) => new McpTool(client, def, hooks?.get(def.name)));
}
