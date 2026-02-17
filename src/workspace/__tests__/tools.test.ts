import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createToolRegistry } from '../../ai/tools/registry';
import { ReadFileTool } from '../../ai/tools/read-file';
import { ListDirectoryTool } from '../../ai/tools/list-directory';
import { SearchCodeTool } from '../../ai/tools/search-code';
import { CheckEnvKeysTool } from '../../ai/tools/check-env-keys';
import { SetEnvValuesTool } from '../../ai/tools/set-env-values';
import { SENSITIVE_FILE_PATTERNS } from '../../ai/tools/utils';
import type { ToolRegistry } from '../../ai/tools/registry';
import type { ToolCall } from '../../ai/types';

// Setup: create a temp workspace with test files

let workspaceRoot: string;
let registry: ToolRegistry;
let executor: (call: ToolCall) => Promise<string>;

beforeAll(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-test-'));

  // Create test files
  await fs.writeFile(path.join(workspaceRoot, 'hello.txt'), 'Hello, world!');
  await fs.writeFile(
    path.join(workspaceRoot, 'index.ts'),
    'export function main() { return 42; }',
  );
  await fs.mkdir(path.join(workspaceRoot, 'src'));
  await fs.writeFile(
    path.join(workspaceRoot, 'src', 'utils.ts'),
    'export const add = (a: number, b: number) => a + b;',
  );
  await fs.mkdir(path.join(workspaceRoot, 'empty-dir'));

  registry = createToolRegistry([
    new ReadFileTool(workspaceRoot),
    new ListDirectoryTool(workspaceRoot),
    new SearchCodeTool(workspaceRoot),
    new CheckEnvKeysTool(workspaceRoot),
    new SetEnvValuesTool(workspaceRoot),
  ]);
  executor = registry.executor;
});

afterAll(async () => {
  await registry.dispose();
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

describe('tool definitions', () => {
  it('should include readFile, listDirectory, and searchCode', () => {
    const names = registry.definitions.map((t) => t.name);
    expect(names).toContain('readFile');
    expect(names).toContain('listDirectory');
    expect(names).toContain('searchCode');
  });

  it('has descriptions and parameters for all tools', () => {
    for (const tool of registry.definitions) {
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters['type']).toBe('object');
    }
  });
});

// readFile

describe('readFile executor', () => {
  it('should read a file in the workspace', async () => {
    const result = await executor({
      id: 'tc1',
      name: 'readFile',
      arguments: { path: 'hello.txt' },
    });

    expect(result).toBe('Hello, world!');
  });

  it('reads a file in a subdirectory', async () => {
    const result = await executor({
      id: 'tc2',
      name: 'readFile',
      arguments: { path: 'src/utils.ts' },
    });

    expect(result).toContain('export const add');
  });

  it('should return error for missing path', async () => {
    const result = await executor({
      id: 'tc3',
      name: 'readFile',
      arguments: {},
    });

    expect(result).toContain('Error');
  });

  it('returns error for nonexistent file', async () => {
    const result = await executor({
      id: 'tc4',
      name: 'readFile',
      arguments: { path: 'does-not-exist.txt' },
    });

    expect(result).toContain('Error');
  });

  it('should reject path traversal outside workspace', async () => {
    const result = await executor({
      id: 'tc5',
      name: 'readFile',
      arguments: { path: '../../etc/passwd' },
    });

    expect(result).toContain('outside the workspace');
  });

  it('returns error when path is a directory', async () => {
    const result = await executor({
      id: 'tc6',
      name: 'readFile',
      arguments: { path: 'src' },
    });

    expect(result).toContain('directory');
  });
});

// listDirectory

describe('listDirectory executor', () => {
  it('should list root directory contents', async () => {
    const result = await executor({
      id: 'tc1',
      name: 'listDirectory',
      arguments: { path: '.' },
    });

    expect(result).toContain('hello.txt');
    expect(result).toContain('index.ts');
    expect(result).toContain('src/');
  });

  it('lists subdirectory contents', async () => {
    const result = await executor({
      id: 'tc2',
      name: 'listDirectory',
      arguments: { path: 'src' },
    });

    expect(result).toContain('utils.ts');
  });

  it('should show trailing slash for directories', async () => {
    const result = await executor({
      id: 'tc3',
      name: 'listDirectory',
      arguments: { path: '.' },
    });

    const lines = result.split('\n');
    const dirEntry = lines.find((l) => l.includes('src'));
    expect(dirEntry).toBe('src/');
  });

  it('handles empty directories', async () => {
    const result = await executor({
      id: 'tc4',
      name: 'listDirectory',
      arguments: { path: 'empty-dir' },
    });

    expect(result).toBe('(empty directory)');
  });

  it('should reject path traversal', async () => {
    const result = await executor({
      id: 'tc5',
      name: 'listDirectory',
      arguments: { path: '../../../' },
    });

    expect(result).toContain('outside the workspace');
  });

  it('returns error for nonexistent directory', async () => {
    const result = await executor({
      id: 'tc6',
      name: 'listDirectory',
      arguments: { path: 'no-such-dir' },
    });

    expect(result).toContain('Error');
  });
});

// searchCode

describe('searchCode executor', () => {
  it('should find matches in files', async () => {
    const result = await executor({
      id: 'tc1',
      name: 'searchCode',
      arguments: { pattern: 'export' },
    });

    expect(result).toContain('index.ts');
    expect(result).toContain('export');
  });

  it('filters by file glob', async () => {
    const result = await executor({
      id: 'tc2',
      name: 'searchCode',
      arguments: { pattern: 'export', fileGlob: '*.txt' },
    });

    // txt files don't contain 'export'
    expect(result).toBe('No matches found');
  });

  it('should return no matches for absent pattern', async () => {
    const result = await executor({
      id: 'tc3',
      name: 'searchCode',
      arguments: { pattern: 'zzz_nonexistent_pattern_zzz' },
    });

    expect(result).toBe('No matches found');
  });

  it('returns error for empty pattern', async () => {
    const result = await executor({
      id: 'tc4',
      name: 'searchCode',
      arguments: {},
    });

    expect(result).toContain('Error');
  });
});

describe('unknown tool', () => {
  it('should return an error message for unknown tools', async () => {
    const result = await executor({
      id: 'tc1',
      name: 'unknownTool',
      arguments: {},
    });

    expect(result).toContain('unknown tool');
  });
});

describe('SENSITIVE_FILE_PATTERNS', () => {
  it('includes common secret file patterns', () => {
    expect(SENSITIVE_FILE_PATTERNS).toContain('.env');
    expect(SENSITIVE_FILE_PATTERNS).toContain('*.pem');
    expect(SENSITIVE_FILE_PATTERNS).toContain('id_rsa');
    expect(SENSITIVE_FILE_PATTERNS).toContain('credentials.json');
  });
});

describe('sensitive file blocking', () => {
  beforeAll(async () => {
    await fs.writeFile(path.join(workspaceRoot, '.env'), 'SECRET=abc');
    await fs.writeFile(
      path.join(workspaceRoot, '.env.local'),
      'LOCAL_SECRET=xyz',
    );
    await fs.writeFile(path.join(workspaceRoot, 'server.key'), 'private-key');
    await fs.writeFile(path.join(workspaceRoot, 'id_rsa'), 'ssh-key-data');
    await fs.writeFile(
      path.join(workspaceRoot, 'credentials.json'),
      '{"secret": true}',
    );
  });

  it('should block .env files', async () => {
    const result = await executor({
      id: 'tc-env',
      name: 'readFile',
      arguments: { path: '.env' },
    });

    expect(result).toContain('access denied');
  });

  it('blocks .env.local files', async () => {
    const result = await executor({
      id: 'tc-envlocal',
      name: 'readFile',
      arguments: { path: '.env.local' },
    });

    expect(result).toContain('access denied');
  });

  it('should block *.key files', async () => {
    const result = await executor({
      id: 'tc-key',
      name: 'readFile',
      arguments: { path: 'server.key' },
    });

    expect(result).toContain('access denied');
  });

  it('blocks SSH key files', async () => {
    const result = await executor({
      id: 'tc-ssh',
      name: 'readFile',
      arguments: { path: 'id_rsa' },
    });

    expect(result).toContain('access denied');
  });

  it('should block credentials.json', async () => {
    const result = await executor({
      id: 'tc-creds',
      name: 'readFile',
      arguments: { path: 'credentials.json' },
    });

    expect(result).toContain('access denied');
  });

  it('filters sensitive files from search results', async () => {
    const result = await executor({
      id: 'tc-search-secret',
      name: 'searchCode',
      arguments: { pattern: 'SECRET' },
    });

    // .env contains SECRET=abc but should be filtered out
    expect(result).not.toContain('.env');
  });
});

// checkEnvKeys

describe('checkEnvKeys executor', () => {
  beforeAll(async () => {
    await fs.writeFile(
      path.join(workspaceRoot, '.env'),
      'POSTHOG_API_KEY=phx_test\nDATABASE_URL=postgres://localhost\n',
    );
  });

  it('should report present keys without revealing values', async () => {
    const result = await executor({
      id: 'tc-ck1',
      name: 'checkEnvKeys',
      arguments: {
        filePath: '.env',
        keys: ['POSTHOG_API_KEY', 'DATABASE_URL'],
      },
    });

    const parsed = JSON.parse(result);
    expect(parsed['POSTHOG_API_KEY']).toBe('present');
    expect(parsed['DATABASE_URL']).toBe('present');
    // Must NOT contain actual values
    expect(result).not.toContain('phx_test');
    expect(result).not.toContain('postgres://');
  });

  it('reports missing keys', async () => {
    const result = await executor({
      id: 'tc-ck2',
      name: 'checkEnvKeys',
      arguments: {
        filePath: '.env',
        keys: ['NONEXISTENT_KEY'],
      },
    });

    const parsed = JSON.parse(result);
    expect(parsed['NONEXISTENT_KEY']).toBe('missing');
  });

  it('should handle a mix of present and missing keys', async () => {
    const result = await executor({
      id: 'tc-ck3',
      name: 'checkEnvKeys',
      arguments: {
        filePath: '.env',
        keys: ['POSTHOG_API_KEY', 'MISSING_KEY'],
      },
    });

    const parsed = JSON.parse(result);
    expect(parsed['POSTHOG_API_KEY']).toBe('present');
    expect(parsed['MISSING_KEY']).toBe('missing');
  });

  it('reports all keys as missing when file does not exist', async () => {
    const result = await executor({
      id: 'tc-ck4',
      name: 'checkEnvKeys',
      arguments: {
        filePath: '.env.nonexistent',
        keys: ['ANY_KEY'],
      },
    });

    const parsed = JSON.parse(result);
    expect(parsed['ANY_KEY']).toBe('missing');
  });

  it('should reject non-.env file paths', async () => {
    const result = await executor({
      id: 'tc-ck5',
      name: 'checkEnvKeys',
      arguments: {
        filePath: 'hello.txt',
        keys: ['KEY'],
      },
    });

    expect(result).toContain('Error');
    expect(result).toContain('.env');
  });

  it('rejects empty keys array', async () => {
    const result = await executor({
      id: 'tc-ck6',
      name: 'checkEnvKeys',
      arguments: {
        filePath: '.env',
        keys: [],
      },
    });

    expect(result).toContain('Error');
  });

  it('should reject path traversal', async () => {
    const result = await executor({
      id: 'tc-ck7',
      name: 'checkEnvKeys',
      arguments: {
        filePath: '../../.env',
        keys: ['KEY'],
      },
    });

    expect(result).toContain('outside the workspace');
  });
});

// setEnvValues

describe('setEnvValues executor', () => {
  const testEnvPath = '.env.test-write';

  afterEach(async () => {
    // Clean up test env file
    try {
      await fs.unlink(path.join(workspaceRoot, testEnvPath));
    } catch {
      // May not exist
    }
  });

  it('creates a new .env file with values', async () => {
    const result = await executor({
      id: 'tc-sv1',
      name: 'setEnvValues',
      arguments: {
        filePath: testEnvPath,
        values: { API_KEY: 'test123', HOST: 'localhost' },
      },
    });

    expect(result).toContain('Updated');
    expect(result).toContain('API_KEY');
    expect(result).toContain('HOST');

    // Verify file contents
    const content = await fs.readFile(
      path.join(workspaceRoot, testEnvPath),
      'utf-8',
    );
    expect(content).toContain('API_KEY=test123');
    expect(content).toContain('HOST=localhost');
  });

  it('should update existing keys without losing others', async () => {
    // Create initial file
    await fs.writeFile(
      path.join(workspaceRoot, testEnvPath),
      'EXISTING=old\nKEEP_ME=safe\n',
    );

    await executor({
      id: 'tc-sv2',
      name: 'setEnvValues',
      arguments: {
        filePath: testEnvPath,
        values: { EXISTING: 'new' },
      },
    });

    const content = await fs.readFile(
      path.join(workspaceRoot, testEnvPath),
      'utf-8',
    );
    expect(content).toContain('EXISTING=new');
    expect(content).toContain('KEEP_ME=safe');
    expect(content).not.toContain('EXISTING=old');
  });

  it('appends new keys to existing file', async () => {
    await fs.writeFile(
      path.join(workspaceRoot, testEnvPath),
      'EXISTING=value\n',
    );

    await executor({
      id: 'tc-sv3',
      name: 'setEnvValues',
      arguments: {
        filePath: testEnvPath,
        values: { NEW_KEY: 'new_value' },
      },
    });

    const content = await fs.readFile(
      path.join(workspaceRoot, testEnvPath),
      'utf-8',
    );
    expect(content).toContain('EXISTING=value');
    expect(content).toContain('NEW_KEY=new_value');
  });

  it('should ensure .gitignore covers the env file', async () => {
    await executor({
      id: 'tc-sv4',
      name: 'setEnvValues',
      arguments: {
        filePath: testEnvPath,
        values: { KEY: 'val' },
      },
    });

    const gitignore = await fs.readFile(
      path.join(workspaceRoot, '.gitignore'),
      'utf-8',
    );
    expect(gitignore).toContain(testEnvPath);
  });

  it('does not duplicate .gitignore entries', async () => {
    // Run twice
    await executor({
      id: 'tc-sv5a',
      name: 'setEnvValues',
      arguments: { filePath: testEnvPath, values: { A: '1' } },
    });
    await executor({
      id: 'tc-sv5b',
      name: 'setEnvValues',
      arguments: { filePath: testEnvPath, values: { B: '2' } },
    });

    const gitignore = await fs.readFile(
      path.join(workspaceRoot, '.gitignore'),
      'utf-8',
    );
    const occurrences = gitignore
      .split('\n')
      .filter((l) => l.trim() === testEnvPath).length;
    expect(occurrences).toBe(1);
  });

  it('should reject non-.env file paths', async () => {
    const result = await executor({
      id: 'tc-sv6',
      name: 'setEnvValues',
      arguments: {
        filePath: 'config.json',
        values: { KEY: 'val' },
      },
    });

    expect(result).toContain('Error');
    expect(result).toContain('.env');
  });

  it('rejects empty values', async () => {
    const result = await executor({
      id: 'tc-sv7',
      name: 'setEnvValues',
      arguments: {
        filePath: testEnvPath,
        values: {},
      },
    });

    expect(result).toContain('Error');
  });

  it('should suggest checkEnvKeys when readFile blocks .env', async () => {
    const result = await executor({
      id: 'tc-sv8',
      name: 'readFile',
      arguments: { path: '.env' },
    });

    expect(result).toContain('checkEnvKeys');
  });
});

describe('symlink escape prevention', () => {
  it('blocks symlinks that point outside the workspace', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-'));
    await fs.writeFile(
      path.join(outsideDir, 'secret.txt'),
      'outside-workspace',
    );

    await fs.symlink(outsideDir, path.join(workspaceRoot, 'escape-link'));

    const result = await executor({
      id: 'tc-sym',
      name: 'readFile',
      arguments: { path: 'escape-link/secret.txt' },
    });

    expect(result).toContain('outside the workspace');

    // Cleanup
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('should allow symlinks that point within the workspace', async () => {
    await fs.symlink(
      path.join(workspaceRoot, 'hello.txt'),
      path.join(workspaceRoot, 'hello-link.txt'),
    );

    const result = await executor({
      id: 'tc-sym2',
      name: 'readFile',
      arguments: { path: 'hello-link.txt' },
    });

    expect(result).toBe('Hello, world!');
  });

  it('blocks directory symlinks that point outside the workspace', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'outside2-'));
    await fs.writeFile(path.join(outsideDir, 'data.txt'), 'external');

    await fs.symlink(outsideDir, path.join(workspaceRoot, 'dir-escape'));

    const result = await executor({
      id: 'tc-sym3',
      name: 'listDirectory',
      arguments: { path: 'dir-escape' },
    });

    expect(result).toContain('outside the workspace');

    // Cleanup
    await fs.rm(outsideDir, { recursive: true, force: true });
  });
});
