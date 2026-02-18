import { exec } from 'child_process';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 50_000;

// Consent gate is the primary safety layer. This denylist catches obviously
// catastrophic commands. Tested with and without `sudo` prefix.
const BLOCKED_PATTERNS: readonly RegExp[] = [
  // Filesystem destruction
  /^rm\s+.*-[a-z]*r[a-z]*.*\s+\/($|\s|\*)/,
  /^rm\s+.*-[a-z]*r[a-z]*.*\s+~($|\s|\/)/,
  /--no-preserve-root/,

  // Disk-level operations
  /^mkfs\b/,
  /^dd\s+.*of=\/dev\//,

  // System power
  /^shutdown\b/,
  /^reboot\b/,
  /^halt\b/,
  /^init\s+0/,

  // Fork bomb
  /^:\(\)\{.*\}/,

  // Remote code execution via pipe to shell
  /\|\s*(ba)?sh(\s|$)/,

  // Root-level permission changes
  /^chmod\s+(-R\s+)?[0-7]{3,4}\s+\/($|\s)/,
  /^chown\s+-R\s+.*\s+\/($|\s)/,
];

const DEFINITION: ToolDefinition = {
  name: 'bash',
  description:
    'Run a shell command in the workspace directory. Returns stdout and stderr. The user will be asked to approve each command before execution.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute.',
      },
      timeout: {
        type: 'number',
        description: `Timeout in milliseconds. Default ${DEFAULT_TIMEOUT_MS}.`,
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  requiresConsent: true,
};

export class BashTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'action' as const;
  readonly promptSummary = 'run a shell command in the workspace';

  constructor(private readonly _workspaceRoot: string) {}

  async execute(call: ToolCall): Promise<string> {
    const command = String(call.arguments['command'] ?? '');
    const timeout = Number(call.arguments['timeout'] ?? DEFAULT_TIMEOUT_MS);

    if (!command.trim()) {
      return 'Error: command is required';
    }

    const blocked = isBlockedCommand(command);
    if (blocked) {
      return `Error: command blocked - ${blocked}`;
    }

    return executeCommand(command, this._workspaceRoot, timeout);
  }
}

function isBlockedCommand(command: string): string | undefined {
  const trimmed = command.trim();
  const withoutSudo = trimmed.replace(/^sudo\s+/, '');

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed) || pattern.test(withoutSudo)) {
      return 'this command pattern is not allowed for safety reasons';
    }
  }

  return undefined;
}

function executeCommand(
  command: string,
  cwd: string,
  timeout: number,
): Promise<string> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        timeout: Math.min(timeout, DEFAULT_TIMEOUT_MS * 2),
        maxBuffer: MAX_OUTPUT_BYTES,
        shell: '/bin/sh',
      },
      (error, stdout, stderr) => {
        const parts: string[] = [];

        if (stdout) {
          parts.push(truncate(stdout, MAX_OUTPUT_BYTES));
        }

        if (stderr) {
          parts.push(`[stderr]\n${truncate(stderr, MAX_OUTPUT_BYTES)}`);
        }

        if (error && !stdout && !stderr) {
          parts.push(`Error: ${error.message}`);
        }

        resolve(parts.join('\n') || '(no output)');
      },
    );
  });
}

function truncate(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) {
    return text;
  }

  return `${text.slice(0, maxBytes)}\n... (output truncated at ${maxBytes} bytes)`;
}
