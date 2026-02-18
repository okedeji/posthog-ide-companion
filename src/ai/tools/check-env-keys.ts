import * as fs from 'fs/promises';
import { resolveSafePath, isEnvFile } from './utils';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFINITION: ToolDefinition = {
  name: 'checkEnvKeys',
  description:
    'Check which environment variable keys are present or missing in a .env file. Never reveals values - only reports "present" or "missing" for each key.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description:
          'Path to the .env file, relative to the workspace root (e.g. ".env", ".env.local").',
      },
      keys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Environment variable key names to check.',
      },
    },
    required: ['filePath', 'keys'],
    additionalProperties: false,
  },
};

export class CheckEnvKeysTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'workspace' as const;
  readonly promptSummary = 'check which env var keys exist in .env files';

  constructor(private readonly _workspaceRoot: string) {}

  async execute(call: ToolCall): Promise<string> {
    const filePath = String(call.arguments['filePath'] ?? '');
    const keys = call.arguments['keys'];

    if (!filePath) {
      return 'Error: filePath is required';
    }

    if (!Array.isArray(keys) || keys.length === 0) {
      return 'Error: keys must be a non-empty array of strings';
    }

    if (!isEnvFile(filePath)) {
      return 'Error: filePath must point to a .env file';
    }

    const resolved = await resolveSafePath(this._workspaceRoot, filePath);
    if (!resolved) {
      return 'Error: path is outside the workspace';
    }

    const existingKeys = new Set<string>();
    try {
      const content = await fs.readFile(resolved, 'utf-8');
      for (const line of content.split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        if (match?.[1]) {
          existingKeys.add(match[1]);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    const results: Record<string, 'present' | 'missing'> = {};
    for (const key of keys) {
      results[String(key)] = existingKeys.has(String(key))
        ? 'present'
        : 'missing';
    }

    return JSON.stringify(results, null, 2);
  }
}
