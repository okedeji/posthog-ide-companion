import { exec } from 'child_process';
import { promisify } from 'util';
import {
  isSensitiveFile,
  EXCLUDED_DIRS,
  MAX_FILE_SIZE,
  MAX_SEARCH_RESULTS,
  shellEscape,
  hasExitCode,
  getErrorMessage,
} from './utils';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const execAsync = promisify(exec);

const DEFINITION: ToolDefinition = {
  name: 'searchCode',
  description:
    'Search for a text pattern across files in the workspace. Returns matching lines with file paths and line numbers.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Search pattern (grep basic regex).',
      },
      fileGlob: {
        type: 'string',
        description:
          'Optional glob to filter files (e.g. "*.ts", "*.py"). Omit to search all files.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
};

export class SearchCodeTool implements Tool {
  readonly definition = DEFINITION;

  constructor(private readonly _workspaceRoot: string) {}

  async execute(call: ToolCall): Promise<string> {
    const pattern = String(call.arguments['pattern'] ?? '');
    const fileGlob = call.arguments['fileGlob'] as string | undefined;

    if (!pattern) {
      return 'Error: pattern is required';
    }

    try {
      // TODO: grep isn't available on Windows, consider bundling a wasm alternative
      const grepArgs = ['-rn', `--max-count=${MAX_SEARCH_RESULTS}`];

      if (fileGlob) {
        grepArgs.push(`--include=${fileGlob}`);
      }

      for (const dir of EXCLUDED_DIRS) {
        grepArgs.push(`--exclude-dir=${dir}`);
      }

      grepArgs.push('--', pattern, '.');

      const { stdout } = await execAsync(
        `grep ${grepArgs.map(shellEscape).join(' ')}`,
        { cwd: this._workspaceRoot, maxBuffer: MAX_FILE_SIZE },
      );

      const lines = stdout.trim().split('\n');
      const filtered = lines.filter((line) => {
        // grep output format: ./path/to/file:linenum:content
        const fileMatch = line.match(/^\.\/(.+?):\d+:/);
        if (fileMatch?.[1]) {
          return !isSensitiveFile(fileMatch[1]);
        }
        return true;
      });

      return filtered.length > 0 ? filtered.join('\n') : 'No matches found';
    } catch (err) {
      // grep exits with code 1 when no matches are found
      if (hasExitCode(err, 1)) {
        return 'No matches found';
      }
      return `Error: ${getErrorMessage(err, 'search failed')}`;
    }
  }
}
