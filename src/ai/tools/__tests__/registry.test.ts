import { createToolRegistry } from '../registry';
import type { Tool } from '../tool';
import type { ToolCall } from '../../types';

/** Creates a minimal tool stub for testing. */
function stubTool(name: string, result: string): Tool {
  return {
    definition: {
      name,
      description: `Stub tool: ${name}`,
      parameters: { type: 'object', properties: {} },
    },
    category: 'workspace',
    promptSummary: `stub ${name}`,
    execute: jest.fn(async () => result),
  };
}

function stubDisposableTool(
  name: string,
  result: string,
): Tool & { dispose: jest.Mock } {
  const tool = stubTool(name, result);
  const dispose = jest.fn(async () => {});
  return { ...tool, dispose };
}

function makeCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: 'call-1', name, arguments: args };
}

describe('createToolRegistry', () => {
  it('should expose definitions from all registered tools', () => {
    const registry = createToolRegistry([
      stubTool('alpha', ''),
      stubTool('beta', ''),
    ]);

    const names = registry.definitions.map((d) => d.name);
    expect(names).toEqual(['alpha', 'beta']);
  });

  it('should route calls to the correct tool', async () => {
    const alpha = stubTool('alpha', 'alpha-result');
    const beta = stubTool('beta', 'beta-result');
    const registry = createToolRegistry([alpha, beta]);

    const result = await registry.executor(makeCall('beta'));

    expect(result).toBe('beta-result');
    expect(alpha.execute).not.toHaveBeenCalled();
    expect(beta.execute).toHaveBeenCalledWith(makeCall('beta'));
  });

  it('should return error for unknown tool name', async () => {
    const registry = createToolRegistry([stubTool('alpha', '')]);

    const result = await registry.executor(makeCall('unknown'));

    expect(result).toContain('unknown tool');
    expect(result).toContain('"unknown"');
  });

  it('should pass call arguments through to the tool', async () => {
    const tool = stubTool('myTool', 'ok');
    const registry = createToolRegistry([tool]);

    await registry.executor(makeCall('myTool', { key: 'value' }));

    expect(tool.execute).toHaveBeenCalledWith({
      id: 'call-1',
      name: 'myTool',
      arguments: { key: 'value' },
    });
  });

  describe('dispose', () => {
    it('should call dispose on all tools that have it', async () => {
      const disposable = stubDisposableTool('a', '');
      const plain = stubTool('b', '');
      const registry = createToolRegistry([disposable, plain]);

      await registry.dispose();

      expect(disposable.dispose).toHaveBeenCalled();
    });
  });
});
