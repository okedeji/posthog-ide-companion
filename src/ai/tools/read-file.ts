import * as fs from 'fs/promises';
import {
  resolveSafePath,
  isSensitiveFile,
  isEnvFile,
  MAX_FILE_SIZE,
} from './utils';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'readFile',
  description:
    'Read the contents of a file in the workspace. Returns the file text or an error message.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path from the workspace root.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

export class ReadFileTool implements Tool {
  readonly definition = DEFINITION;

  constructor(private readonly _workspaceRoot: string) {}

  async execute(call: ToolCall): Promise<string> {
    const filePath = String(call.arguments['path'] ?? '');

    if (!filePath) {
      return 'Error: path is required';
    }

    if (isSensitiveFile(filePath)) {
      if (isEnvFile(filePath)) {
        return 'Error: access denied - use the checkEnvKeys tool to inspect .env files safely without exposing secret values.';
      }
      return 'Error: access denied - this file may contain secrets or credentials';
    }

    const resolved = await resolveSafePath(this._workspaceRoot, filePath);
    if (!resolved) {
      return 'Error: path is outside the workspace';
    }

    try {
      const stat = await fs.stat(resolved);

      if (stat.isDirectory()) {
        return 'Error: path is a directory, use listDirectory instead';
      }

      if (stat.size > MAX_FILE_SIZE) {
        return `Error: file is too large (${stat.size} bytes, max ${MAX_FILE_SIZE})`;
      }

      return await fs.readFile(resolved, 'utf-8');
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : 'could not read file'}`;
    }
  }
}
