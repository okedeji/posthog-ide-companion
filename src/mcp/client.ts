import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolDefinition } from '../ai/types';
import type { CloudRegion } from '../auth/constants';

const MCP_URLS: Record<CloudRegion, string> = {
  us: 'https://mcp.us.posthog.com/mcp',
  eu: 'https://mcp.eu.posthog.com/mcp',
};

export type McpConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type McpToolResult = {
  content: string;
  isError: boolean;
};

export type McpClientOptions = {
  apiKey: string;
  projectId: number;
  region: CloudRegion;
};

// Wraps the MCP SDK client with connect/disconnect lifecycle and tool bridging.
export class PostHogMcpClient implements vscode.Disposable {
  private _client: Client | undefined;
  private _transport: StreamableHTTPClientTransport | undefined;
  private _state: McpConnectionState = 'disconnected';
  private _tools: ToolDefinition[] = [];

  private readonly _onDidChangeState =
    new vscode.EventEmitter<McpConnectionState>();
  readonly onDidChangeState = this._onDidChangeState.event;

  constructor(private readonly _options: McpClientOptions) {}

  get state(): McpConnectionState {
    return this._state;
  }

  get tools(): ToolDefinition[] {
    return this._tools;
  }

  async connect(): Promise<void> {
    if (this._state === 'connecting' || this._state === 'connected') {
      return;
    }

    this.setState('connecting');

    try {
      const mcpUrl = MCP_URLS[this._options.region];
      this._transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${this._options.apiKey}`,
          },
        },
      });

      this._client = new Client({
        name: 'ide-companion-for-posthog',
        version: '0.2.0',
      });

      await this._client.connect(this._transport);

      // Scope subsequent calls to the right project
      await this._client.callTool({
        name: 'switch-project',
        arguments: { projectId: this._options.projectId },
      });

      this._tools = await this.listAllTools();

      this.setState('connected');
    } catch (_err) {
      this._tools = [];
      this.setState('error');
      throw _err;
    }
  }

  async disconnect(): Promise<void> {
    if (this._state === 'disconnected') {
      return;
    }

    try {
      await this._client?.close();
    } catch {
      // Best-effort cleanup
    }

    this._client = undefined;
    this._transport = undefined;
    this._tools = [];
    this.setState('disconnected');
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    if (!this._client || this._state !== 'connected') {
      return { content: 'Error: MCP client is not connected', isError: true };
    }

    const result = await this._client.callTool({
      name,
      arguments: args,
    });

    return {
      content: serializeToolResult(result.content),
      isError: result.isError === true,
    };
  }

  dispose(): void {
    void this.disconnect();
    this._onDidChangeState.dispose();
  }

  private async listAllTools(): Promise<ToolDefinition[]> {
    if (!this._client) {
      return [];
    }

    const allTools: ToolDefinition[] = [];
    let cursor: string | undefined;

    do {
      const result = await this._client.listTools(
        cursor ? { cursor } : undefined,
      );
      allTools.push(
        ...result.tools
          .filter((t) => !MCP_EXCLUDED_TOOLS.has(t.name))
          .map(bridgeToolDefinition),
      );
      cursor = result.nextCursor;
    } while (cursor);

    return allTools;
  }

  private setState(state: McpConnectionState): void {
    this._state = state;
    this._onDidChangeState.fire(state);
  }
}

// Tools managed by the extension UI, not exposed to the LLM
const MCP_EXCLUDED_TOOLS = new Set(['switch-project']);

// Explicit registry of MCP tools that modify data and require user consent.
const MCP_WRITE_TOOLS = new Set([
  'create-feature-flag',
  'update-feature-flag',
  'delete-feature-flag',
  'experiment-create',
  'experiment-update',
  'experiment-delete',
  'dashboard-create',
  'dashboard-update',
  'dashboard-delete',
  'dashboard-reorder-tiles',
  'add-insight-to-dashboard',
  'insight-create-from-query',
  'insight-update',
  'insight-delete',
  'survey-create',
  'survey-update',
  'survey-delete',
]);

// Both MCP and our ToolDefinition use JSON Schema, so this is a direct map
function bridgeToolDefinition(mcpTool: {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}): ToolDefinition {
  return {
    name: mcpTool.name,
    description: mcpTool.description ?? '',
    parameters: mcpTool.inputSchema,
    requiresConsent: MCP_WRITE_TOOLS.has(mcpTool.name),
  };
}

// MCP results can have multiple content blocks - flatten to a single string
function serializeToolResult(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : JSON.stringify(content);
  }

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'text' in block) {
      parts.push(String((block as Record<string, unknown>)['text']));
    } else if (typeof block === 'string') {
      parts.push(block);
    } else {
      parts.push(JSON.stringify(block));
    }
  }

  return parts.join('\n');
}
