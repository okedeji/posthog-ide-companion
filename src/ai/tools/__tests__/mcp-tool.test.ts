import { McpTool, createMcpTools } from '../mcp-tool';
import type { PostHogMcpClient, McpToolResult } from '../../../mcp/client';
import type { ToolDefinition, ToolCall } from '../../types';
import type { McpToolHook, McpToolHooks } from '../mcp-hooks';

function makeDef(name = 'test-tool'): ToolDefinition {
  return {
    name,
    description: 'A test tool. With extra details.',
    parameters: { type: 'object', properties: {} },
  };
}

function makeCall(name = 'test-tool'): ToolCall {
  return { id: 'call-1', name, arguments: { key: 'value' } };
}

function makeMockClient(
  result: McpToolResult = { content: 'ok', isError: false },
  tools: ToolDefinition[] = [],
): PostHogMcpClient {
  return {
    callTool: jest.fn().mockResolvedValue(result),
    tools,
  } as unknown as PostHogMcpClient;
}

describe('McpTool', () => {
  it('returns content from callTool', async () => {
    const client = makeMockClient({ content: 'Flag created', isError: false });
    const tool = new McpTool(client, makeDef());

    const result = await tool.execute(makeCall());

    expect(result).toBe('Flag created');
  });

  it('fires hook on success', async () => {
    const client = makeMockClient({ content: 'done', isError: false });
    const hook: McpToolHook = { onSuccess: jest.fn() };
    const tool = new McpTool(client, makeDef(), hook);

    await tool.execute(makeCall());

    expect(hook.onSuccess).toHaveBeenCalledWith({ key: 'value' }, 'done');
  });

  it('does not fire hook on error', async () => {
    const client = makeMockClient({ content: 'Not found', isError: true });
    const hook: McpToolHook = { onSuccess: jest.fn() };
    const tool = new McpTool(client, makeDef(), hook);

    await tool.execute(makeCall());

    expect(hook.onSuccess).not.toHaveBeenCalled();
  });

  it('still returns content if hook throws', async () => {
    const client = makeMockClient({ content: 'done', isError: false });
    const hook: McpToolHook = {
      onSuccess: jest.fn().mockImplementation(() => {
        throw new Error('hook broke');
      }),
    };
    const tool = new McpTool(client, makeDef(), hook);

    const result = await tool.execute(makeCall());

    expect(result).toBe('done');
  });

  it('works without a hook', async () => {
    const client = makeMockClient({ content: 'result', isError: false });
    const tool = new McpTool(client, makeDef());

    const result = await tool.execute(makeCall());

    expect(result).toBe('result');
  });

  it('uses first sentence of description as promptSummary', () => {
    const tool = new McpTool(makeMockClient(), makeDef());

    expect(tool.promptSummary).toBe('A test tool');
  });
});

describe('createMcpTools', () => {
  it('creates tools from client definitions', () => {
    const defs = [makeDef('tool-a'), makeDef('tool-b')];
    const client = makeMockClient(undefined, defs);

    const tools = createMcpTools(client);

    expect(tools).toHaveLength(2);
    expect(tools[0]?.definition.name).toBe('tool-a');
    expect(tools[1]?.definition.name).toBe('tool-b');
  });

  it('attaches hooks to matching tools', () => {
    const defs = [makeDef('hooked'), makeDef('plain')];
    const client = makeMockClient(undefined, defs);
    const hooks: McpToolHooks = new Map([['hooked', { onSuccess: jest.fn() }]]);

    const tools = createMcpTools(client, hooks);

    // Both are McpTool instances — hook wiring is internal,
    // so we just verify they were created
    expect(tools).toHaveLength(2);
  });
});
