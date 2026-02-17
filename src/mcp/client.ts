import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { ToolDefinition } from '../ai/types';

const MCP_SSE_URL = 'https://mcp.posthog.com/sse';

export type McpConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type McpClientOptions = {
  apiKey: string;
  projectId: number;
};

// Wraps the MCP SDK client with connect/disconnect lifecycle and tool bridging.
export class PostHogMcpClient implements vscode.Disposable {
  private _client: Client | undefined;
  private _transport: SSEClientTransport | undefined;
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
      this._transport = new SSEClientTransport(new URL(MCP_SSE_URL), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${this._options.apiKey}`,
          },
        },
      });

      this._client = new Client({
        name: 'posthog-ide-companion',
        version: '0.1.0',
      });

      await this._client.connect(this._transport);

      // Scope subsequent calls to the right project
      await this._client.callTool({
        name: 'project-set-active',
        arguments: { projectId: this._options.projectId },
      });

      const { tools } = await this._client.listTools();
      this._tools = tools.map(bridgeToolDefinition);

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

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this._client || this._state !== 'connected') {
      return 'Error: MCP client is not connected';
    }

    const result = await this._client.callTool({
      name,
      arguments: args,
    });

    return serializeToolResult(result.content);
  }

  dispose(): void {
    void this.disconnect();
    this._onDidChangeState.dispose();
  }

  private setState(state: McpConnectionState): void {
    this._state = state;
    this._onDidChangeState.fire(state);
  }
}

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
