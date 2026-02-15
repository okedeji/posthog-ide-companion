import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition, ToolCall, ToolExecutor } from '../types';

const execAsync = promisify(exec);

/** Maximum file size to read (1 MB). Prevents sending huge files to the LLM. */
const MAX_FILE_SIZE = 1_048_576;

/** Maximum search results to return. */
const MAX_SEARCH_RESULTS = 50;

/**
 * File patterns that must never be read or returned in search results.
 * These typically contain secrets, credentials, or private keys.
 * Patterns are matched against the basename (not the full path).
 */
export const SENSITIVE_FILE_PATTERNS: readonly string[] = [
  // Environment files
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.staging',
  '.env.test',
  '.envrc',
  // Private keys and certificates
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  // SSH keys
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  // Cloud & service credentials
  'credentials.json',
  'service-account.json',
  'serviceAccountKey.json',
  // Auth tokens and configs
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.htpasswd',
  // Docker secrets
  '*.secret',
];

/**
 * Directories excluded from search across all ecosystems.
 * These are dependency, build output, or VCS directories that are
 * never useful for the LLM to search inside.
 */
const EXCLUDED_DIRS = [
  // VCS
  '.git',
  '.svn',
  '.hg',
  // JS / TS
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.vite',
  '.turbo',
  // Python
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.eggs',
  '.mypy_cache',
  '.pytest_cache',
  // Java / Kotlin / Scala
  'target',
  '.gradle',
  // Rust
  // (also 'target' — already listed)
  // Go
  'vendor',
  // Ruby
  '.bundle',
  // .NET
  'bin',
  'obj',
  // General
  'coverage',
  '.cache',
  '.idea',
  '.vscode',
];

// ---------------------------------------------------------------------------
// Tool definitions (JSON Schema for the LLM)
// ---------------------------------------------------------------------------

/** Tool definitions for workspace exploration. Shared across features. */
export const WORKSPACE_TOOLS: ToolDefinition[] = [
  {
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
  },
  {
    name: 'listDirectory',
    description:
      'List files and folders in a directory. Returns names with trailing / for directories.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative path from the workspace root. Use "." for root.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
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
  },
  {
    name: 'checkEnvKeys',
    description:
      'Check which environment variable keys are present or missing in a .env file. Never reveals values — only reports "present" or "missing" for each key.',
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
  },
  {
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
  },
];

// ---------------------------------------------------------------------------
// Tool executor factory
// ---------------------------------------------------------------------------

/**
 * Creates a tool executor bound to a workspace root directory.
 *
 * All paths are resolved relative to the workspace root. Path traversal
 * outside the workspace is rejected.
 *
 * @param workspaceRoot - Absolute path to the workspace root.
 * @returns A tool executor function.
 */
export function createWorkspaceExecutor(workspaceRoot: string): ToolExecutor {
  return async (call: ToolCall): Promise<string> => {
    switch (call.name) {
      case 'readFile':
        return executeReadFile(workspaceRoot, call.arguments);
      case 'listDirectory':
        return executeListDirectory(workspaceRoot, call.arguments);
      case 'searchCode':
        return executeSearchCode(workspaceRoot, call.arguments);
      case 'checkEnvKeys':
        return executeCheckEnvKeys(workspaceRoot, call.arguments);
      case 'setEnvValues':
        return executeSetEnvValues(workspaceRoot, call.arguments);
      default:
        return `Unknown tool: ${call.name}`;
    }
  };
}

// ---------------------------------------------------------------------------
// Tool implementations (internal)
// ---------------------------------------------------------------------------

async function executeReadFile(
  root: string,
  args: Record<string, unknown>,
): Promise<string> {
  const filePath = String(args['path'] ?? '');

  if (!filePath) {
    return 'Error: path is required';
  }

  if (isSensitiveFile(filePath)) {
    if (isEnvFile(filePath)) {
      return 'Error: access denied — use the checkEnvKeys tool to inspect .env files safely without exposing secret values.';
    }
    return 'Error: access denied — this file may contain secrets or credentials';
  }

  const resolved = await resolveSafePath(root, filePath);
  if (!resolved) {
    return 'Error: path is outside the workspace';
  }

  try {
    const stat = await fs.stat(resolved);

    if (stat.isDirectory()) {
      return 'Error: path is a directory, use listDirectory instead';
    }

    if (stat.size > MAX_FILE_SIZE) {
      return `Error: file is too large (${String(stat.size)} bytes, max ${String(MAX_FILE_SIZE)})`;
    }

    return await fs.readFile(resolved, 'utf-8');
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : 'could not read file'}`;
  }
}

async function executeListDirectory(
  root: string,
  args: Record<string, unknown>,
): Promise<string> {
  const dirPath = String(args['path'] ?? '.');

  const resolved = await resolveSafePath(root, dirPath);
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

async function executeSearchCode(
  root: string,
  args: Record<string, unknown>,
): Promise<string> {
  const pattern = String(args['pattern'] ?? '');
  const fileGlob = args['fileGlob'] as string | undefined;

  if (!pattern) {
    return 'Error: pattern is required';
  }

  try {
    const grepArgs = ['-rn', `--max-count=${String(MAX_SEARCH_RESULTS)}`];

    if (fileGlob) {
      grepArgs.push(`--include=${fileGlob}`);
    }

    for (const dir of EXCLUDED_DIRS) {
      grepArgs.push(`--exclude-dir=${dir}`);
    }

    grepArgs.push('--', pattern, '.');

    const { stdout } = await execAsync(
      `grep ${grepArgs.map(shellEscape).join(' ')}`,
      { cwd: root, maxBuffer: MAX_FILE_SIZE },
    );

    // Filter out matches from sensitive files
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

// ---------------------------------------------------------------------------
// Env file tools (safe .env interaction)
// ---------------------------------------------------------------------------

/**
 * Checks which keys are present or missing in a .env file.
 * Never reveals values — only returns "present" or "missing" per key.
 */
async function executeCheckEnvKeys(
  root: string,
  args: Record<string, unknown>,
): Promise<string> {
  const filePath = String(args['filePath'] ?? '');
  const keys = args['keys'];

  if (!filePath) {
    return 'Error: filePath is required';
  }

  if (!Array.isArray(keys) || keys.length === 0) {
    return 'Error: keys must be a non-empty array of strings';
  }

  if (!isEnvFile(filePath)) {
    return 'Error: filePath must point to a .env file';
  }

  const resolved = await resolveSafePath(root, filePath);
  if (!resolved) {
    return 'Error: path is outside the workspace';
  }

  // Parse existing keys from the file (if it exists)
  const existingKeys = new Set<string>();
  try {
    const content = await fs.readFile(resolved, 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match?.[1]) {
        existingKeys.add(match[1]);
      }
    }
  } catch {
    // File doesn't exist — all keys are missing
  }

  const results: Record<string, 'present' | 'missing'> = {};
  for (const key of keys) {
    results[String(key)] = existingKeys.has(String(key))
      ? 'present'
      : 'missing';
  }

  return JSON.stringify(results, null, 2);
}

/**
 * Creates or updates key-value pairs in a .env file.
 * Automatically ensures the file is covered by .gitignore.
 */
async function executeSetEnvValues(
  root: string,
  args: Record<string, unknown>,
): Promise<string> {
  const filePath = String(args['filePath'] ?? '');
  const values = args['values'] as Record<string, string> | undefined;

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

  const resolved = await resolveSafePath(root, filePath);
  if (!resolved) {
    return 'Error: path is outside the workspace';
  }

  let lines: string[] = [];
  try {
    const content = await fs.readFile(resolved, 'utf-8');
    lines = content.split('\n');
  } catch {
    // File doesn't exist yet — will be created below
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
  await ensureGitignoreCoverage(root, path.basename(filePath));

  const keyList = Object.keys(values).join(', ');
  return `Updated ${filePath}: set ${keyList}`;
}

/**
 * Ensures a .gitignore file in the workspace root covers the given env filename.
 * Creates .gitignore if it doesn't exist. Appends the filename if not already covered.
 */
async function ensureGitignoreCoverage(
  root: string,
  envFileName: string,
): Promise<void> {
  const gitignorePath = path.join(root, '.gitignore');
  let content = '';

  try {
    content = await fs.readFile(gitignorePath, 'utf-8');
  } catch {
    // .gitignore doesn't exist — will create it
  }

  const lines = content.split('\n');
  const alreadyCovered = lines.some((line) => {
    const trimmed = line.trim();
    // Exact match or wildcard patterns that would cover this file
    return (
      trimmed === envFileName ||
      trimmed === '.env*' ||
      trimmed === '.env.*' ||
      trimmed === '.env'
    );
  });

  if (!alreadyCovered) {
    const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    await fs.writeFile(
      gitignorePath,
      `${content}${separator}${envFileName}\n`,
      'utf-8',
    );
  }
}

// ---------------------------------------------------------------------------
// Utilities (internal)
// ---------------------------------------------------------------------------

/**
 * Resolves a relative path within the workspace root, following symlinks.
 * Returns undefined if the real (physical) path escapes the workspace.
 *
 * Both the resolved path and the root are run through `fs.realpath()`
 * because the workspace root itself can be a symlink (common on macOS
 * where `/var` is a symlink to `/private/var`).
 */
async function resolveSafePath(
  root: string,
  relative: string,
): Promise<string | undefined> {
  const resolved = path.resolve(root, relative);

  // Quick lexical check first (catches obvious ../../../ traversals)
  if (!resolved.startsWith(root)) {
    return undefined;
  }

  try {
    // Resolve symlinks to get the physical path
    const realPath = await fs.realpath(resolved);
    const realRoot = await fs.realpath(root);

    if (!realPath.startsWith(realRoot)) {
      return undefined;
    }

    return realPath;
  } catch {
    // File doesn't exist — fall back to the lexical check which already passed.
    // readFile/listDirectory will produce their own ENOENT errors downstream.
    return resolved;
  }
}

/** Escapes a string for safe use in a shell command. */
function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** Checks whether an exec error has a specific exit code. */
function hasExitCode(err: unknown, code: number): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as Record<string, unknown>)['code'] === code
  );
}

/** Extracts a human-readable message from an unknown error. */
function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as Record<string, unknown>)['message']);
  }
  return fallback;
}

/** Checks if a file path points to a .env file (any variant). */
function isEnvFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return basename === '.env' || basename.startsWith('.env.');
}

/**
 * Checks if a filename matches any sensitive file pattern.
 * Matches against the basename using:
 * - Exact match (e.g. `id_rsa`)
 * - Prefix match for `.env.*` variants
 * - Extension match (e.g. `*.pem`)
 */
function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);

  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.startsWith('*.')) {
      // Extension match: *.pem matches server.pem
      if (basename.endsWith(pattern.slice(1))) {
        return true;
      }
    } else if (pattern === '.env') {
      // .env prefix match: .env, .env.local, .env.anything
      if (basename === '.env' || basename.startsWith('.env.')) {
        return true;
      }
    } else {
      // Exact match
      if (basename === pattern) {
        return true;
      }
    }
  }

  return false;
}
