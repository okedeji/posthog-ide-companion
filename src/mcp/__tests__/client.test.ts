import { PostHogMcpClient } from '../client';
import type { McpConnectionState } from '../client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Mock the MCP SDK
const mockConnect = jest.fn();
const mockClose = jest.fn();
const mockListTools = jest.fn();
const mockCallTool = jest.fn();

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

const MockClient = jest.mocked(Client);
const MockTransport = jest.mocked(StreamableHTTPClientTransport);

const OPTIONS = {
  apiKey: 'phx_test_key',
  projectId: 42,
  region: 'us' as const,
};

describe('PostHogMcpClient', () => {
  beforeEach(() => {
    jest.resetAllMocks();

    // Re-register constructor mocks after resetAllMocks clears them
    MockClient.mockImplementation(
      () =>
        ({
          connect: mockConnect,
          close: mockClose,
          listTools: mockListTools,
          callTool: mockCallTool,
        }) as unknown as Client,
    );

    MockTransport.mockImplementation(
      () => ({}) as unknown as StreamableHTTPClientTransport,
    );

    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: 'list-errors',
          description: 'Display project errors',
          inputSchema: {
            type: 'object',
            properties: { limit: { type: 'number' } },
          },
        },
        {
          name: 'docs-search',
          description: 'Search PostHog docs',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    });
    mockCallTool.mockResolvedValue({ content: [] });
  });

  describe('connect', () => {
    it('should transition through connecting to connected', async () => {
      const client = new PostHogMcpClient(OPTIONS);
      const states: McpConnectionState[] = [];
      client.onDidChangeState((s) => states.push(s));

      await client.connect();

      expect(states).toEqual(['connecting', 'connected']);
      expect(client.state).toBe('connected');
    });

    it('should use region-specific MCP URL', async () => {
      const euClient = new PostHogMcpClient({ ...OPTIONS, region: 'eu' });
      await euClient.connect();

      expect(MockTransport).toHaveBeenCalledWith(
        new URL('https://mcp.eu.posthog.com/mcp'),
        expect.any(Object),
      );

      const usClient = new PostHogMcpClient({ ...OPTIONS, region: 'us' });
      await usClient.connect();

      expect(MockTransport).toHaveBeenCalledWith(
        new URL('https://mcp.us.posthog.com/mcp'),
        expect.any(Object),
      );
    });

    it('should call switch-project with the project ID', async () => {
      const client = new PostHogMcpClient(OPTIONS);
      await client.connect();

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'switch-project',
        arguments: { projectId: 42 },
      });
    });

    it('should bridge MCP tool schemas to ToolDefinition format', async () => {
      const client = new PostHogMcpClient(OPTIONS);
      await client.connect();

      expect(client.tools).toHaveLength(2);
      expect(client.tools[0]).toEqual({
        name: 'list-errors',
        description: 'Display project errors',
        parameters: {
          type: 'object',
          properties: { limit: { type: 'number' } },
        },
        requiresConsent: false,
      });
    });

    it('should set requiresConsent on write tools', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          {
            name: 'create-feature-flag',
            description: 'Create a feature flag',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'entity-search',
            description: 'Search entities',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });

      const client = new PostHogMcpClient(OPTIONS);
      await client.connect();

      expect(client.tools[0]?.requiresConsent).toBe(true);
      expect(client.tools[1]?.requiresConsent).toBe(false);
    });

    it('should set state to error on connection failure', async () => {
      mockConnect.mockRejectedValue(new Error('network error'));

      const client = new PostHogMcpClient(OPTIONS);
      const states: McpConnectionState[] = [];
      client.onDidChangeState((s) => states.push(s));

      await expect(client.connect()).rejects.toThrow('network error');
      expect(states).toEqual(['connecting', 'error']);
      expect(client.tools).toEqual([]);
    });
  });

  describe('disconnect', () => {
    it('should close the client and clear tools', async () => {
      const client = new PostHogMcpClient(OPTIONS);
      await client.connect();
      expect(client.tools).toHaveLength(2);

      await client.disconnect();

      expect(mockClose).toHaveBeenCalled();
      expect(client.state).toBe('disconnected');
      expect(client.tools).toEqual([]);
    });
  });

  describe('callTool', () => {
    it('should delegate to the MCP client and serialize text result', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Found 5 errors' }],
      });

      const client = new PostHogMcpClient(OPTIONS);
      await client.connect();

      const result = await client.callTool('list-errors', { limit: 5 });

      expect(result).toEqual({ content: 'Found 5 errors', isError: false });
      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'list-errors',
        arguments: { limit: 5 },
      });
    });

    it('should join multiple text blocks with newlines', async () => {
      mockCallTool.mockResolvedValue({
        content: [
          { type: 'text', text: 'Line 1' },
          { type: 'text', text: 'Line 2' },
        ],
      });

      const client = new PostHogMcpClient(OPTIONS);
      await client.connect();

      const result = await client.callTool('test', {});
      expect(result.content).toBe('Line 1\nLine 2');
    });

    it('should return isError true when MCP reports an error', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Not found' }],
        isError: true,
      });

      const client = new PostHogMcpClient(OPTIONS);
      await client.connect();

      const result = await client.callTool('test', {});
      expect(result).toEqual({ content: 'Not found', isError: true });
    });

    it('should return error when not connected', async () => {
      const client = new PostHogMcpClient(OPTIONS);

      const result = await client.callTool('list-errors', {});
      expect(result).toEqual({
        content: 'Error: MCP client is not connected',
        isError: true,
      });
    });
  });

  describe('dispose', () => {
    it('should disconnect and clean up', async () => {
      const client = new PostHogMcpClient(OPTIONS);
      await client.connect();

      client.dispose();

      // dispose triggers disconnect asynchronously
      await tick();
      expect(client.state).toBe('disconnected');
    });
  });
});

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
