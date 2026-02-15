import type { PromptSection, WorkspaceInfo } from './types';

/**
 * Foundation system prompt — always the first section (priority 0).
 * Features add domain-specific instructions via `addSection()`.
 */
export const FOUNDATION_PROMPT = `You are an AI assistant integrated into a developer's IDE, helping them understand and work with their PostHog analytics data and codebase.

## Core Behavior

- **Explain your work**: As you use tools, briefly explain what you are doing and why.
- **Ask for clarification**: If a request is ambiguous or you need more context, ask a clarifying question rather than guessing.
- **Summarize when done**: After completing a task, provide a clear, concise summary of what you found or accomplished.
- **Never modify without approval**: Do not execute code, modify files, or make changes to the workspace without the user's explicit approval.
- **Stay within scope**: Only access files and data within the current workspace. Do not attempt to access external systems or URLs.

## Tool Usage Guidelines

- Use the available workspace tools to read files, list directories, and search code.
- When exploring code, start broad (list directories) then narrow down (read specific files).
- If a tool returns an error, explain the error to the user and suggest alternatives.
- Do not call the same tool with the same arguments repeatedly.

## Response Format

- Use Markdown formatting for readability.
- Use code blocks with language identifiers for code snippets.
- Keep responses focused and actionable.
- When presenting findings, organize them with headers and bullet points.`;

/**
 * Composable system prompt from registered sections.
 * Foundation is always at priority 0. Features add sections merged by
 * priority (lower = earlier). Duplicate keys: last-write-wins.
 */
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

  /** The foundation section cannot be removed. */
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

/**
 * Converts workspace detection results into a prompt section at priority 10,
 * so the LLM gets project context before any feature-specific instructions.
 */
export function createWorkspaceContextSection(
  info: WorkspaceInfo,
): PromptSection {
  const lines: string[] = ['## Workspace Context', ''];

  // Language + structure
  lines.push(`This is a ${info.projectStructure} ${info.language} project.`);

  // Frameworks with versions
  if (info.frameworks.length > 0) {
    const frameworkList = info.frameworks
      .map((f) => {
        const version = info.frameworkVersions[f];
        return version ? `${f} ${version}` : f;
      })
      .join(', ');
    lines.push(`Frameworks: ${frameworkList}.`);
  }

  // Framework details (e.g. Next.js router type)
  for (const [framework, details] of Object.entries(info.frameworkDetails)) {
    const detailParts = Object.entries(details).map(
      ([key, value]) => `${key}: ${value}`,
    );
    if (detailParts.length > 0) {
      lines.push(`${framework} details: ${detailParts.join(', ')}.`);
    }
  }

  // Package manager
  if (info.packageManager) {
    lines.push(`Package manager: ${info.packageManager}.`);
  }

  // Test frameworks
  if (info.testFrameworks.length > 0) {
    lines.push(`Test frameworks: ${info.testFrameworks.join(', ')}.`);
  }

  // Build tools
  if (info.buildTools.length > 0) {
    lines.push(`Build tools: ${info.buildTools.join(', ')}.`);
  }

  // Notable patterns
  if (info.notablePatterns.length > 0) {
    lines.push('');
    lines.push('Notable patterns:');
    for (const pattern of info.notablePatterns) {
      lines.push(`- ${pattern}`);
    }
  }

  return {
    key: 'workspace-context',
    content: lines.join('\n'),
    priority: 10,
  };
}
