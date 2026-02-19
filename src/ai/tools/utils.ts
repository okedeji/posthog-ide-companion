import * as fs from 'fs/promises';
import * as path from 'path';

export const MAX_FILE_SIZE = 1_048_576; // 1 MB
export const MAX_SEARCH_RESULTS = 50;

export const ENV_KEY_PATTERN = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/;

export const SENSITIVE_FILE_PATTERNS: readonly string[] = [
  '.env',
  '.envrc',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  'credentials.json',
  'service-account.json',
  'serviceAccountKey.json',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.htpasswd',
  '*.secret',
];

export const EXCLUDED_DIRS: readonly string[] = [
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.vite',
  '.turbo',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.eggs',
  '.mypy_cache',
  '.pytest_cache',
  'target',
  '.gradle',
  'vendor',
  '.bundle',
  'bin',
  'obj',
  'coverage',
  '.cache',
  '.idea',
  '.vscode',
];

// Both sides need realpath because macOS rewrites /var to /private/var.
export async function resolveSafePath(
  root: string,
  relative: string,
): Promise<string | undefined> {
  const resolved = path.resolve(root, relative);

  if (!resolved.startsWith(root)) {
    return undefined;
  }

  try {
    const realPath = await fs.realpath(resolved);
    const realRoot = await fs.realpath(root);

    if (!realPath.startsWith(realRoot)) {
      return undefined;
    }

    return realPath;
  } catch (err) {
    // File doesn't exist yet; the lexical check passed so allow it through.
    // readFile/listDirectory will produce their own ENOENT errors downstream.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return resolved;
  }
}

export function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);

  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.startsWith('*.')) {
      if (basename.endsWith(pattern.slice(1))) {
        return true;
      }
    } else if (pattern === '.env') {
      if (basename === '.env' || basename.startsWith('.env.')) {
        return true;
      }
    } else {
      if (basename === pattern) {
        return true;
      }
    }
  }

  return false;
}

export function isEnvFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return basename === '.env' || basename.startsWith('.env.');
}

export async function ensureGitignoreCoverage(
  root: string,
  envFileName: string,
): Promise<void> {
  const gitignorePath = path.join(root, '.gitignore');
  let content = '';

  try {
    content = await fs.readFile(gitignorePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const lines = content.split('\n');
  const alreadyCovered = lines.some((line) => {
    const trimmed = line.trim();
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

export function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function hasExitCode(err: unknown, code: number): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as Record<string, unknown>)['code'] === code
  );
}

export function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as Record<string, unknown>)['message']);
  }
  return fallback;
}
