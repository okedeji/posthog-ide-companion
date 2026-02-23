import type * as vscode from 'vscode';
import {
  WorkspaceInfoSchema,
  extractJson,
  detectWorkspace,
} from '../detection';
import {
  getStoredWorkspaceInfo,
  setStoredWorkspaceInfo,
  clearStoredWorkspaceInfo,
  isWorkspaceInfoStale,
} from '../storage';
import { createToolRegistry } from '../../ai/tools/registry';
import { ReadFileTool } from '../../ai/tools/read-file';
import { ListDirectoryTool } from '../../ai/tools/list-directory';
import { SearchCodeTool } from '../../ai/tools/search-code';
import { CheckEnvKeysTool } from '../../ai/tools/check-env-keys';
import type { DetectionLogLevel } from '../detection';
import { createWorkspaceContextSection } from '../../ai/prompts';
import type { LLMProvider } from '../../ai/provider';
import type {
  LLMMessage,
  LLMResponse,
  LLMGenerateOptions,
} from '../../ai/types';
import type { WorkspaceInfo } from '../types';

const USAGE = { inputTokens: 10, outputTokens: 5 };

const VALID_WORKSPACE_INFO = {
  language: 'typescript',
  frameworks: ['next.js', 'tailwind'],
  frameworkVersions: { 'next.js': '14.2.0', tailwind: '3.4.1' },
  frameworkDetails: { 'next.js': { router: 'app', srcDir: 'true' } },
  packageManager: 'pnpm',
  testFrameworks: ['jest'],
  buildTools: ['tsc', 'esbuild'],
  projectStructure: 'single-package' as const,
  notablePatterns: ['uses barrel exports'],
  codebaseSummary:
    'An e-commerce Next.js app selling handmade crafts with Stripe checkout and PostHog analytics.',
  setupIssues: [],
};

/**
 * Creates a mock provider that returns tool calls for N iterations,
 * then returns a text response with the given JSON.
 */
function createDetectionProvider(
  json: Record<string, unknown>,
  toolIterations = 2,
): LLMProvider {
  let callCount = 0;
  return {
    name: 'mock',
    generate: async (
      _messages: LLMMessage[],
      _options?: LLMGenerateOptions,
    ): Promise<LLMResponse> => {
      callCount++;
      if (callCount <= toolIterations) {
        return {
          type: 'tool_calls',
          calls: [
            {
              id: `tc_${String(callCount)}`,
              name: 'listDirectory',
              arguments: { path: '.' },
            },
          ],
          usage: USAGE,
        };
      }
      return {
        type: 'text',
        content: JSON.stringify(json),
        usage: USAGE,
      };
    },
    async *stream() {
      yield { type: 'done', content: '', usage: USAGE };
    },
  };
}

describe('WorkspaceInfoSchema', () => {
  it('should validate a complete valid workspace info object', () => {
    const result = WorkspaceInfoSchema.safeParse(VALID_WORKSPACE_INFO);
    expect(result.success).toBe(true);
  });

  it('validates with empty arrays and null packageManager', () => {
    const minimal = {
      language: 'python',
      frameworks: [],
      frameworkVersions: {},
      frameworkDetails: {},
      packageManager: null,
      testFrameworks: [],
      buildTools: [],
      projectStructure: 'unknown',
      notablePatterns: [],
    };

    const result = WorkspaceInfoSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('should reject invalid projectStructure values', () => {
    const invalid = {
      ...VALID_WORKSPACE_INFO,
      projectStructure: 'invalid-structure',
    };

    const result = WorkspaceInfoSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const missing = { language: 'typescript' };

    const result = WorkspaceInfoSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });

  it('should reject non-string values in frameworkVersions', () => {
    const invalid = {
      ...VALID_WORKSPACE_INFO,
      frameworkVersions: { 'next.js': 123 },
    };

    const result = WorkspaceInfoSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('coerces non-string values in frameworkDetails to strings', () => {
    const withBooleans = {
      ...VALID_WORKSPACE_INFO,
      frameworkDetails: {
        electron: { multiWindow: true, nativeAddons: false },
        react: { version: '19.1.1' },
      },
    };

    const result = WorkspaceInfoSchema.safeParse(withBooleans);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.frameworkDetails['electron']?.['multiWindow']).toBe(
        'true',
      );
      expect(result.data.frameworkDetails['electron']?.['nativeAddons']).toBe(
        'false',
      );
      expect(result.data.frameworkDetails['react']?.['version']).toBe('19.1.1');
    }
  });

  it('should accept all valid projectStructure enum values', () => {
    for (const value of [
      'monorepo',
      'single-package',
      'multi-package',
      'unknown',
    ]) {
      const info = { ...VALID_WORKSPACE_INFO, projectStructure: value };
      const result = WorkspaceInfoSchema.safeParse(info);
      expect(result.success).toBe(true);
    }
  });
});

// extractJson

describe('extractJson', () => {
  it('extracts JSON from a markdown code block', () => {
    const text = 'Here is the result:\n```json\n{"language": "python"}\n```';
    expect(extractJson(text)).toEqual({ language: 'python' });
  });

  it('should extract JSON from a code block without language tag', () => {
    const text = '```\n{"language": "rust"}\n```';
    expect(extractJson(text)).toEqual({ language: 'rust' });
  });

  it('extracts raw JSON without code block', () => {
    const text = '{"language": "go", "frameworks": []}';
    expect(extractJson(text)).toEqual({ language: 'go', frameworks: [] });
  });

  it('should extract JSON with surrounding text', () => {
    const text =
      'The workspace analysis is complete.\n{"language": "typescript"}\nDone.';
    expect(extractJson(text)).toEqual({ language: 'typescript' });
  });

  it('returns undefined for text without JSON', () => {
    expect(extractJson('No JSON here')).toBeUndefined();
  });

  it('should return undefined for invalid JSON in code block', () => {
    const text = '```json\n{invalid json}\n```';
    expect(extractJson(text)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractJson('')).toBeUndefined();
  });

  it('should handle nested JSON objects', () => {
    const nested = {
      language: 'typescript',
      frameworkDetails: { 'next.js': { router: 'app' } },
    };
    const text = `\`\`\`json\n${JSON.stringify(nested)}\n\`\`\``;
    expect(extractJson(text)).toEqual(nested);
  });

  it('prefers code block over raw JSON when both exist', () => {
    const text =
      '{"wrong": true}\n```json\n{"correct": true}\n```\n{"also_wrong": true}';
    expect(extractJson(text)).toEqual({ correct: true });
  });
});

// detectWorkspace

describe('detectWorkspace', () => {
  it('should return validated workspace info on success', async () => {
    const provider = createDetectionProvider(VALID_WORKSPACE_INFO, 1);

    const result = await detectWorkspace(provider, '/fake/workspace');

    expect(result).toBeDefined();
    expect(result?.language).toBe('typescript');
    expect(result?.frameworks).toEqual(['next.js', 'tailwind']);
    expect(result?.frameworkDetails['next.js']?.router).toBe('app');
    expect(result?.detectedAt).toBeDefined();
  });

  it('adds a detectedAt timestamp', async () => {
    const before = new Date().toISOString();
    const provider = createDetectionProvider(VALID_WORKSPACE_INFO, 0);

    const result = await detectWorkspace(provider, '/fake/workspace');

    const after = new Date().toISOString();
    expect(result?.detectedAt).toBeDefined();
    expect(result!.detectedAt >= before).toBe(true);
    expect(result!.detectedAt <= after).toBe(true);
  });

  it('should return undefined when LLM returns invalid JSON', async () => {
    const provider: LLMProvider = {
      name: 'mock',
      generate: async (): Promise<LLMResponse> => ({
        type: 'text',
        content: 'I could not analyze the workspace.',
        usage: USAGE,
      }),
      async *stream() {
        yield { type: 'done', content: '', usage: USAGE };
      },
    };

    const result = await detectWorkspace(provider, '/fake/workspace');
    expect(result).toBeUndefined();
  });

  it('returns undefined when LLM returns invalid schema', async () => {
    const invalidSchema = { language: 'python' }; // Missing required fields
    const provider = createDetectionProvider(invalidSchema, 0);

    const result = await detectWorkspace(provider, '/fake/workspace');
    expect(result).toBeUndefined();
  });

  it('should forward onEvent callback to agent loop', async () => {
    const provider = createDetectionProvider(VALID_WORKSPACE_INFO, 1);
    const events: string[] = [];

    await detectWorkspace(provider, '/fake/workspace', {
      onEvent: (event) => events.push(event.type),
    });

    expect(events).toContain('iteration_start');
    expect(events).toContain('complete');
  });

  it('logs diagnostics on successful detection', async () => {
    const provider = createDetectionProvider(VALID_WORKSPACE_INFO, 0);
    const logs: { level: DetectionLogLevel; message: string }[] = [];

    await detectWorkspace(provider, '/fake/workspace', {
      onLog: (level, message) => logs.push({ level, message }),
    });

    const levels = logs.map((l) => l.level);
    expect(levels).toContain('info');
    expect(levels).toContain('debug');
    expect(
      logs.some((l) => l.message.includes('Starting workspace detection')),
    ).toBe(true);
    expect(logs.some((l) => l.message.includes('Workspace detected'))).toBe(
      true,
    );
  });

  it('should log warning with raw response when JSON extraction fails', async () => {
    const provider: LLMProvider = {
      name: 'mock',
      generate: async (): Promise<LLMResponse> => ({
        type: 'text',
        content: 'No JSON here, just text.',
        usage: USAGE,
      }),
      async *stream() {
        yield { type: 'done', content: '', usage: USAGE };
      },
    };
    const logs: { level: DetectionLogLevel; message: string }[] = [];

    await detectWorkspace(provider, '/fake/workspace', {
      onLog: (level, message) => logs.push({ level, message }),
    });

    const warn = logs.find((l) => l.level === 'warn');
    expect(warn).toBeDefined();
    expect(warn?.message).toContain('Failed to extract JSON');
    expect(warn?.message).toContain('No JSON here, just text.');
  });

  it('logs schema validation errors', async () => {
    const invalidSchema = { language: 'python' }; // Missing required fields
    const provider = createDetectionProvider(invalidSchema, 0);
    const logs: { level: DetectionLogLevel; message: string }[] = [];

    await detectWorkspace(provider, '/fake/workspace', {
      onLog: (level, message) => logs.push({ level, message }),
    });

    expect(
      logs.some(
        (l) =>
          l.level === 'error' && l.message.includes('Schema validation failed'),
      ),
    ).toBe(true);
  });

  it('should not log verbose output on success', async () => {
    const provider = createDetectionProvider(VALID_WORKSPACE_INFO, 0);
    const logs: { level: DetectionLogLevel; message: string }[] = [];

    await detectWorkspace(provider, '/fake/workspace', {
      onLog: (level, message) => logs.push({ level, message }),
    });

    expect(logs.some((l) => l.message.includes('Raw LLM response'))).toBe(
      false,
    );
    expect(logs.some((l) => l.message.includes('Extracted JSON'))).toBe(false);
  });

  it('respects custom maxIterations', async () => {
    // Provider that always returns tool calls (never text)
    let callCount = 0;
    const provider: LLMProvider = {
      name: 'mock',
      generate: async (): Promise<LLMResponse> => {
        callCount++;
        // After max iterations, the agent loop forces a text response.
        // This provider always returns tool calls, but on the forced
        // summary call (no tools), it returns text.
        return {
          type: 'tool_calls',
          calls: [
            {
              id: `tc_${String(callCount)}`,
              name: 'readFile',
              arguments: { path: 'package.json' },
            },
          ],
          usage: USAGE,
        };
      },
      async *stream() {
        yield { type: 'done', content: '', usage: USAGE };
      },
    };

    const result = await detectWorkspace(provider, '/fake/workspace', {
      maxIterations: 3,
    });

    // Agent loop: 3 tool iterations + 1 forced summary = 4 generate calls
    expect(callCount).toBe(4);
    // The forced summary won't be valid JSON, so result should be undefined
    expect(result).toBeUndefined();
  });
});

// Detection registry composition

describe('detection registry', () => {
  it('should include read-only tools', () => {
    const registry = createToolRegistry([
      new ReadFileTool('/tmp'),
      new ListDirectoryTool('/tmp'),
      new SearchCodeTool('/tmp'),
      new CheckEnvKeysTool('/tmp'),
    ]);
    const names = registry.coreDefinitions.map((t) => t.name);
    expect(names).toContain('readFile');
    expect(names).toContain('listDirectory');
    expect(names).toContain('searchCode');
    expect(names).toContain('checkEnvKeys');
  });

  it('excludes setEnvValues when not composed in', () => {
    const registry = createToolRegistry([
      new ReadFileTool('/tmp'),
      new ListDirectoryTool('/tmp'),
      new SearchCodeTool('/tmp'),
      new CheckEnvKeysTool('/tmp'),
    ]);
    const names = registry.coreDefinitions.map((t) => t.name);
    expect(names).not.toContain('setEnvValues');
  });
});

describe('workspace state helpers', () => {
  const mockState = new Map<string, unknown>();
  const mockContext = {
    workspaceState: {
      get: <T>(key: string): T | undefined => mockState.get(key) as T,
      update: async (key: string, value: unknown): Promise<void> => {
        if (value === undefined) {
          mockState.delete(key);
        } else {
          mockState.set(key, value);
        }
      },
    },
  } as unknown as vscode.ExtensionContext;

  beforeEach(() => {
    mockState.clear();
  });

  it('should return undefined when no workspace info is stored', () => {
    expect(getStoredWorkspaceInfo(mockContext)).toBeUndefined();
  });

  it('stores and retrieve workspace info', async () => {
    const info: WorkspaceInfo = {
      ...VALID_WORKSPACE_INFO,
      detectedAt: new Date().toISOString(),
    };

    await setStoredWorkspaceInfo(mockContext, info);
    const retrieved = getStoredWorkspaceInfo(mockContext);

    expect(retrieved).toEqual(info);
  });

  it('should clear stored workspace info', async () => {
    const info: WorkspaceInfo = {
      ...VALID_WORKSPACE_INFO,
      detectedAt: new Date().toISOString(),
    };

    await setStoredWorkspaceInfo(mockContext, info);
    await clearStoredWorkspaceInfo(mockContext);

    expect(getStoredWorkspaceInfo(mockContext)).toBeUndefined();
  });
});

// createWorkspaceContextSection

describe('createWorkspaceContextSection', () => {
  const fullInfo: WorkspaceInfo = {
    ...VALID_WORKSPACE_INFO,
    detectedAt: new Date().toISOString(),
  };

  it('has key "workspace-context" at priority 10', () => {
    const section = createWorkspaceContextSection(fullInfo);
    expect(section.key).toBe('workspace-context');
    expect(section.priority).toBe(10);
  });

  it('should include language and project structure', () => {
    const section = createWorkspaceContextSection(fullInfo);
    expect(section.content).toContain('single-package');
    expect(section.content).toContain('typescript');
  });

  it('includes frameworks with versions', () => {
    const section = createWorkspaceContextSection(fullInfo);
    expect(section.content).toContain('next.js 14.2.0');
    expect(section.content).toContain('tailwind 3.4.1');
  });

  it('should include framework details', () => {
    const section = createWorkspaceContextSection(fullInfo);
    expect(section.content).toContain('next.js details');
    expect(section.content).toContain('router: app');
  });

  it('includes package manager', () => {
    const section = createWorkspaceContextSection(fullInfo);
    expect(section.content).toContain('Package manager: pnpm');
  });

  it('should include test frameworks', () => {
    const section = createWorkspaceContextSection(fullInfo);
    expect(section.content).toContain('Test frameworks: jest');
  });

  it('includes build tools', () => {
    const section = createWorkspaceContextSection(fullInfo);
    expect(section.content).toContain('Build tools: tsc, esbuild');
  });

  it('should include notable patterns', () => {
    const section = createWorkspaceContextSection(fullInfo);
    expect(section.content).toContain('- uses barrel exports');
  });

  it('omits empty sections gracefully', () => {
    const minimal: WorkspaceInfo = {
      language: 'python',
      frameworks: [],
      frameworkVersions: {},
      frameworkDetails: {},
      packageManager: null,
      testFrameworks: [],
      buildTools: [],
      projectStructure: 'unknown',
      notablePatterns: [],
      codebaseSummary: '',
      setupIssues: [],
      detectedAt: new Date().toISOString(),
    };

    const section = createWorkspaceContextSection(minimal);
    expect(section.content).toContain('unknown python project');
    expect(section.content).not.toContain('Frameworks:');
    expect(section.content).not.toContain('Package manager:');
    expect(section.content).not.toContain('Test frameworks:');
    expect(section.content).not.toContain('Build tools:');
    expect(section.content).not.toContain('Notable patterns:');
  });

  it('should show framework without version when version is missing', () => {
    const info: WorkspaceInfo = {
      ...fullInfo,
      frameworkVersions: { 'next.js': '14.2.0' }, // tailwind has no version
    };

    const section = createWorkspaceContextSection(info);
    expect(section.content).toContain('next.js 14.2.0');
    // tailwind should appear without version
    expect(section.content).toMatch(/tailwind(?!\s\d)/);
  });
});

// isWorkspaceInfoStale

describe('isWorkspaceInfoStale', () => {
  it('returns false for recently detected info', () => {
    const info: WorkspaceInfo = {
      ...VALID_WORKSPACE_INFO,
      detectedAt: new Date().toISOString(),
    };

    expect(isWorkspaceInfoStale(info)).toBe(false);
  });

  it('should return true for info older than 7 days', () => {
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const info: WorkspaceInfo = {
      ...VALID_WORKSPACE_INFO,
      detectedAt: eightDaysAgo,
    };

    expect(isWorkspaceInfoStale(info)).toBe(true);
  });

  it('returns false for info within the 7-day window', () => {
    const sixDaysAgo = new Date(
      Date.now() - 6 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const info: WorkspaceInfo = {
      ...VALID_WORKSPACE_INFO,
      detectedAt: sixDaysAgo,
    };

    expect(isWorkspaceInfoStale(info)).toBe(false);
  });

  it('should respect a custom threshold', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const info: WorkspaceInfo = {
      ...VALID_WORKSPACE_INFO,
      detectedAt: twoHoursAgo,
    };

    const oneHourMs = 60 * 60 * 1000;
    expect(isWorkspaceInfoStale(info, oneHourMs)).toBe(true);
  });

  it('returns true for invalid detectedAt timestamp', () => {
    const info: WorkspaceInfo = {
      ...VALID_WORKSPACE_INFO,
      detectedAt: 'not-a-date',
    };

    expect(isWorkspaceInfoStale(info)).toBe(true);
  });
});
