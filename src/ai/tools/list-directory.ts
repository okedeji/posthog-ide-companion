import * as fs from 'fs/promises';
import { resolveSafePath } from './utils';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'listDirectory',
  description:
    'List files and folders in a directory. Returns names with trailing / for directories.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path from the workspace root. Use "." for root.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

export class ListDirectoryTool implements Tool {
  readonly definition = DEFINITION;

  constructor(private readonly _workspaceRoot: string) {}

  async execute(call: ToolCall): Promise<string> {
    const dirPath = String(call.arguments['path'] ?? '.');

    const resolved = await resolveSafePath(this._workspaceRoot, dirPath);
    if (!resolved) {
      return 'Error: path is outside the workspace';
    }

    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const lines = entries.map((entry) =>
        entry.isDirectory() ? `${entry.name}/` : entry.name,
      );
      return lines.join('\n') || '(empty directory)';
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : 'could not list directory'}`;
    }
  }
}
