import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveSafePath, isEnvFile, ensureGitignoreCoverage } from './utils';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'setEnvValues',
  description:
    'Create or update environment variable key-value pairs in a .env file. Creates the file if it does not exist. Automatically ensures the file is covered by .gitignore.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description:
          'Path to the .env file, relative to the workspace root (e.g. ".env", ".env.local").',
      },
      values: {
        type: 'object',
        description:
          'Key-value pairs to set. Existing keys are updated, new keys are appended.',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['filePath', 'values'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class SetEnvValuesTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'action' as const;
  readonly promptSummary = 'create or update key-value pairs in .env files';

  constructor(private readonly _workspaceRoot: string) {}

  async execute(call: ToolCall): Promise<string> {
    const filePath = String(call.arguments['filePath'] ?? '');
    const values = call.arguments['values'] as
      | Record<string, string>
      | undefined;

    if (!filePath) {
      return 'Error: filePath is required';
    }

    if (
      !values ||
      typeof values !== 'object' ||
      Object.keys(values).length === 0
    ) {
      return 'Error: values must be a non-empty object of key-value pairs';
    }

    if (!isEnvFile(filePath)) {
      return 'Error: filePath must point to a .env file';
    }

    const resolved = await resolveSafePath(this._workspaceRoot, filePath);
    if (!resolved) {
      return 'Error: path is outside the workspace';
    }

    let lines: string[] = [];
    try {
      const content = await fs.readFile(resolved, 'utf-8');
      lines = content.split('\n');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    const updatedKeys = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i]?.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match?.[1] && match[1] in values) {
        lines[i] = `${match[1]}=${values[match[1]]}`;
        updatedKeys.add(match[1]);
      }
    }

    for (const [key, value] of Object.entries(values)) {
      if (!updatedKeys.has(key)) {
        // Add a trailing newline separator if file doesn't end with one
        if (lines.length > 0 && lines[lines.length - 1] !== '') {
          lines.push('');
        }
        lines.push(`${key}=${value}`);
      }
    }

    await fs.writeFile(resolved, lines.join('\n'), 'utf-8');
    await ensureGitignoreCoverage(this._workspaceRoot, path.basename(filePath));

    const keyList = Object.keys(values).join(', ');
    return `Updated ${filePath}: set ${keyList}`;
  }
}
