import type { PromptSection } from './types';

// ---------------------------------------------------------------------------
// Foundation prompt — always included at priority 0.
// ---------------------------------------------------------------------------

/**
 * The foundation system prompt. Establishes the AI's identity, behavior
 * rules, tool usage guidelines, and response format expectations.
 *
 * This is always the first section in a composed prompt. Features add
 * domain-specific instructions via `addSection()`.
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

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds a composable system prompt from registered sections.
 *
 * The foundation prompt is always included at priority 0.
 * Features register additional sections that are merged by priority
 * (lower number = appears earlier in the final prompt).
 *
 * Sections with duplicate keys are resolved by last-write-wins.
 *
 * @example
 * ```ts
 * const builder = createSystemPromptBuilder();
 * builder.addSection({
 *   key: 'error-analysis',
 *   content: '## Error Analysis\nWhen analyzing errors...',
 *   priority: 50,
 * });
 * const prompt = builder.build();
 * ```
 */
export class SystemPromptBuilder {
  private _sections: Map<string, Required<PromptSection>> = new Map();

  constructor() {
    this._sections.set('foundation', {
      key: 'foundation',
      content: FOUNDATION_PROMPT,
      priority: 0,
    });
  }

  /**
   * Registers a prompt section. If a section with the same key exists,
   * it is overwritten.
   *
   * @param section - The section to register.
   * @returns This builder, for chaining.
   */
  addSection(section: PromptSection): this {
    this._sections.set(section.key, {
      ...section,
      priority: section.priority ?? 100,
    });
    return this;
  }

  /**
   * Removes a previously registered section by key.
   * The foundation section cannot be removed.
   *
   * @param key - The section key to remove.
   * @returns True if the section was found and removed.
   */
  removeSection(key: string): boolean {
    if (key === 'foundation') {
      return false;
    }
    return this._sections.delete(key);
  }

  /**
   * Returns the merged system prompt string.
   * Sections are sorted by priority (lower = first) and joined with
   * double newlines.
   */
  build(): string {
    const sorted = [...this._sections.values()].sort(
      (a, b) => a.priority - b.priority,
    );
    return sorted.map((s) => s.content).join('\n\n');
  }

  /** Returns the registered section keys (for debugging/testing). */
  get keys(): string[] {
    return [...this._sections.keys()];
  }
}

/**
 * Creates a pre-configured system prompt builder with the foundation prompt.
 * Features call `addSection()` to contribute their domain-specific instructions.
 */
export function createSystemPromptBuilder(): SystemPromptBuilder {
  return new SystemPromptBuilder();
}
