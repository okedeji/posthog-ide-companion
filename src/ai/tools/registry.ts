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
  workspace: 'Workspace - for exploring the codebase',
  action: 'Actions - require user approval',
  posthog: 'PostHog',
};

// Generates a prompt section listing all tools, grouped by category.
// Workspace and action tools are listed individually with their summaries.
// PostHog (MCP) tools get a count-based summary since there can be dozens.
function buildToolsPromptSection(tools: Tool[]): string {
  const grouped = new Map<ToolCategory, Tool[]>();
  for (const tool of tools) {
    const group = grouped.get(tool.category) ?? [];
    group.push(tool);
    grouped.set(tool.category, group);
  }

  const lines: string[] = ['## Tools', ''];

  const workspace = grouped.get('workspace') ?? [];
  if (workspace.length > 0) {
    lines.push(`**${CATEGORY_LABELS.workspace}:**`);
    for (const t of workspace) {
      lines.push(`- \`${t.definition.name}\` - ${t.promptSummary}`);
    }
    lines.push('');
  }

  const actions = grouped.get('action') ?? [];
  if (actions.length > 0) {
    lines.push(`**${CATEGORY_LABELS.action}:**`);
    for (const t of actions) {
      lines.push(`- \`${t.definition.name}\` - ${t.promptSummary}`);
    }
    lines.push('');
  }

  const posthog = grouped.get('posthog') ?? [];
  if (posthog.length > 0) {
    lines.push(
      `**${CATEGORY_LABELS.posthog}** (${posthog.length} tools) - ` +
        'query analytics data, manage feature flags, search docs, and more. ' +
        "These connect to the user's PostHog project via MCP.",
    );
    lines.push('');
  }

  return lines.join('\n').trim();
}
