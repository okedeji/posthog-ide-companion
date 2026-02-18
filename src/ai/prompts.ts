import type { PromptSection } from './types';
import type { WorkspaceInfo } from '../workspace/types';

export const FOUNDATION_PROMPT = `You are **PostHog Companion**, an AI assistant built into the developer's IDE. Your purpose is to help developers fix PostHog issues, interact with their PostHog data, and get the most out of PostHog in their projects.

## Core Behavior

- Do NOT use emojis anywhere in your responses — not in headings, lists, or body text — unless the user explicitly asks for them.
- Briefly explain what you are doing and why as you use tools.
- If a request is ambiguous, ask a clarifying question rather than guessing.
- Summarize what you found or accomplished when you finish a task.
- Never modify files or run commands without the user's approval.

## PostHog Tools

You have direct access to the user's PostHog project through MCP tools. **Use them aggressively.** These tools let you search docs, query errors, list feature flags, run analytics, and more — all against live PostHog data. Do not guess or rely on general knowledge when you can fetch the real data.

- **Always search the docs first** (docs-search) before acting on any request. The docs have up-to-date API references, SDK guides, and best practices that are critical for accurate advice.
- **Fetch live data when IDs are available.** If you have an error ID, look it up. If a feature flag key is mentioned, fetch its details. If an event name is referenced, query its recent volume. The PostHog tools give you direct access — use them to get the full picture before diagnosing or fixing anything.
- **Combine PostHog data with codebase context.** The most useful advice comes from cross-referencing what PostHog reports with what the code actually does. Fetch the data from PostHog, then read the relevant source files.
- **Never say you cannot help without checking docs first.** Even if there is no MCP tool for a specific task, the PostHog docs may have guides, API references, or manual steps that you can use to build a solution yourself or walk the user through. Search the docs before concluding something is not possible — then use what you find to help, whether that means writing code, proposing edits, or providing step-by-step instructions.

## Tool Usage

- When exploring code, start broad (list directories) then narrow down (read specific files).
- If a tool returns an error, explain it and suggest alternatives.
- Do not call the same tool with the same arguments repeatedly.

## Response Format

- Use Markdown formatting for readability.
- Use code blocks with language identifiers for code snippets.
- Keep responses focused and actionable.
- Reference file paths and line numbers when discussing code.`;

// Sections merged by priority (lower = earlier). Duplicate keys: last-write-wins.
export class SystemPromptBuilder {
  private _sections: Map<string, Required<PromptSection>> = new Map();

  // Priority: 0 = foundation, 10 = workspace context, 100 = default for features
  constructor() {
    this._sections.set('foundation', {
      key: 'foundation',
      content: FOUNDATION_PROMPT,
      priority: 0,
    });
  }

  addSection(section: PromptSection): this {
    this._sections.set(section.key, {
      ...section,
      priority: section.priority ?? 100,
    });
    return this;
  }

  removeSection(key: string): boolean {
    if (key === 'foundation') {
      return false;
    }
    return this._sections.delete(key);
  }

  build(): string {
    const sorted = [...this._sections.values()].sort(
      (a, b) => a.priority - b.priority,
    );
    return sorted.map((s) => s.content).join('\n\n');
  }

  get keys(): string[] {
    return [...this._sections.keys()];
  }
}

export function createSystemPromptBuilder(): SystemPromptBuilder {
  return new SystemPromptBuilder();
}

// Injects workspace info at priority 10 so the LLM has project context early.
export function createWorkspaceContextSection(
  info: WorkspaceInfo,
): PromptSection {
  const lines: string[] = ['## Workspace Context', ''];

  lines.push(`This is a ${info.projectStructure} ${info.language} project.`);

  if (info.frameworks.length > 0) {
    const frameworkList = info.frameworks
      .map((f) => {
        const version = info.frameworkVersions[f];
        return version ? `${f} ${version}` : f;
      })
      .join(', ');
    lines.push(`Frameworks: ${frameworkList}.`);
  }

  for (const [framework, details] of Object.entries(info.frameworkDetails)) {
    const detailParts = Object.entries(details).map(
      ([key, value]) => `${key}: ${value}`,
    );
    if (detailParts.length > 0) {
      lines.push(`${framework} details: ${detailParts.join(', ')}.`);
    }
  }

  if (info.packageManager) {
    lines.push(`Package manager: ${info.packageManager}.`);
  }

  if (info.testFrameworks.length > 0) {
    lines.push(`Test frameworks: ${info.testFrameworks.join(', ')}.`);
  }

  if (info.buildTools.length > 0) {
    lines.push(`Build tools: ${info.buildTools.join(', ')}.`);
  }

  if (info.notablePatterns.length > 0) {
    lines.push('');
    lines.push('Notable patterns:');
    for (const pattern of info.notablePatterns) {
      lines.push(`- ${pattern}`);
    }
  }

  if (info.codebaseSummary) {
    lines.push('');
    lines.push('### About this project');
    lines.push('');
    lines.push(info.codebaseSummary);
  }

  return {
    key: 'workspace-context',
    content: lines.join('\n'),
    priority: 10,
  };
}
