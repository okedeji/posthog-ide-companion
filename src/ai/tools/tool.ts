import type { ToolDefinition, ToolCall } from '../types';

export interface Tool {
  readonly definition: ToolDefinition;
  execute(call: ToolCall): Promise<string>;
  dispose?(): Promise<void>; // cleanup (e.g. temp files)
}
