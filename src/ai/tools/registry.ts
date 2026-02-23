import type { Tool, ToolCategory } from './tool';
import type { ToolDefinition, ToolCall, ToolExecutor } from '../types';

export type ToolRegistry = {
  definitions: ToolDefinition[];
  executor: ToolExecutor;
  toolsPromptSection: string;
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

  return {
    definitions,
    executor,
    toolsPromptSection: buildToolsPromptSection(tools),
    dispose,
  };
}

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  workspace: 'Workspace — explore and search the codebase',
  action: 'Actions — require user approval before execution',
  posthog: 'PostHog — query project data via MCP',
};

function buildToolsPromptSection(tools: Tool[]): string {
  const grouped = new Map<ToolCategory, Tool[]>();
  for (const tool of tools) {
    const group = grouped.get(tool.category) ?? [];
    group.push(tool);
    grouped.set(tool.category, group);
  }

  const lines: string[] = ['## Tools', ''];

  for (const category of ['workspace', 'action', 'posthog'] as ToolCategory[]) {
    const group = grouped.get(category) ?? [];
    if (group.length === 0) continue;
    lines.push(`**${CATEGORY_LABELS[category]}:**`);
    for (const t of group) {
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
