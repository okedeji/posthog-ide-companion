import type { ToolDefinition, ToolCall } from '../types';

export type ToolCategory = 'workspace' | 'action' | 'posthog';

export interface Tool {
  readonly definition: ToolDefinition;
  readonly category: ToolCategory;
  readonly promptSummary: string; // one-liner used when building system prompts
  execute(call: ToolCall): Promise<string>;
  dispose?(): Promise<void>;
}
