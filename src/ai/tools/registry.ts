import type { Tool } from './tool';
import type { ToolDefinition, ToolCall, ToolExecutor } from '../types';

export type ToolRegistry = {
  coreDefinitions: ToolDefinition[];
  onDemandDefinitions: Map<string, ToolDefinition>;
  executor: ToolExecutor;
  toolsPromptSection: string;
  dispose: () => Promise<void>;
};

// When coreNames is provided, only those tools get full schemas sent to the API.
// Everything else is on-demand (listed in prompt, loaded via findTools).
// Executor handles all tools regardless of tier.
export function createToolRegistry(
  tools: Tool[],
  coreNames?: Set<string>,
): ToolRegistry {
  const toolMap = new Map<string, Tool>();
  for (const tool of tools) {
    toolMap.set(tool.definition.name, tool);
  }

  const isCore = coreNames ? (name: string) => coreNames.has(name) : () => true;

  const coreDefinitions: ToolDefinition[] = [];
  const onDemandDefinitions = new Map<string, ToolDefinition>();

  for (const tool of tools) {
    if (isCore(tool.definition.name)) {
      coreDefinitions.push(tool.definition);
    } else {
      onDemandDefinitions.set(tool.definition.name, tool.definition);
    }
  }

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

  return {
    coreDefinitions,
    onDemandDefinitions,
    executor,
    toolsPromptSection: buildToolsPromptSection(tools, isCore),
    dispose,
  };
}

function buildToolsPromptSection(
  tools: Tool[],
  isCore: (name: string) => boolean,
): string {
  const core: Tool[] = [];
  const onDemand: Tool[] = [];

  for (const tool of tools) {
    if (isCore(tool.definition.name)) {
      core.push(tool);
    } else {
      onDemand.push(tool);
    }
  }

  const lines: string[] = ['## Tools', ''];

  lines.push('**Core tools (always available):**');
  for (const t of core) {
    lines.push(`- \`${t.definition.name}\` — ${t.promptSummary}`);
  }
  lines.push('');

  if (onDemand.length > 0) {
    lines.push(
      '**On-demand tools (call `findTools` with exact names to load):**',
    );
    lines.push(
      'Always set filterTestAccounts: false unless the user asks for production-only data.',
    );
    for (const t of onDemand) {
      lines.push(`- \`${t.definition.name}\` — ${t.promptSummary}`);
    }
    lines.push('');
  }

  lines.push(
    'You MUST call the appropriate tool before answering. ' +
      'Never describe what a tool would return — call it and report the actual result.',
  );

  return lines.join('\n').trim();
}
