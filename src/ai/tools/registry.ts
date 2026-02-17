import type { Tool } from './tool';
import type { ToolDefinition, ToolCall, ToolExecutor } from '../types';

export type ToolRegistry = {
  definitions: ToolDefinition[];
  executor: ToolExecutor;
  dispose: () => Promise<void>;
};

export function createToolRegistry(tools: Tool[]): ToolRegistry {
  const toolMap = new Map<string, Tool>();
  for (const tool of tools) {
    toolMap.set(tool.definition.name, tool);
  }

  const definitions = tools.map((t) => t.definition);

  const executor: ToolExecutor = async (call: ToolCall): Promise<string> => {
    const tool = toolMap.get(call.name);
    if (!tool) {
      return `Error: unknown tool "${call.name}"`;
    }
    return tool.execute(call);
  };

  const dispose = async (): Promise<void> => {
    for (const tool of tools) {
      await tool.dispose?.();
    }
  };

  return { definitions, executor, dispose };
}
