import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as fs from 'fs/promises';
import { createFileAnalysisPoller } from '../file-analysis-poller';
import { DiscoveryStore } from '../../store';
import type { LLMProvider } from '../../../../ai/provider';
import type { WorkspaceInfo } from '../../../../workspace/types';
import type { Logger } from '../../../../utils/logger';

jest.mock('child_process');
jest.mock('fs/promises');

const mockedExec = jest.mocked(childProcess.exec);
const mockedReadFile = jest.mocked(fs.readFile);

function makeMockLogger(): Logger {
  return { info: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeMockProvider(response?: {
  type: 'text';
  content: string;
}): LLMProvider {
  return {
    name: 'test',
    generate: jest.fn().mockResolvedValue(
      response ?? {
        type: 'text',
        content: JSON.stringify({
          suggestions: [
            {
              file: 'src/pages/checkout.tsx',
              needs_integration: true,
              suggestion_type: 'event_capture',
              title: 'Track checkout events',
              description: 'Add event tracking for purchases.',
              recommended_actions: ['capture purchase_completed'],
            },
          ],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ),
    stream: jest.fn(),
  } as unknown as LLMProvider;
}

function makeWorkspaceInfo(
  overrides: Partial<WorkspaceInfo> = {},
): WorkspaceInfo {
  return {
    language: 'typescript',
    frameworks: ['next.js'],
    frameworkVersions: {},
    frameworkDetails: {},
    packageManager: 'npm',
    testFrameworks: ['jest'],
    buildTools: ['webpack'],
    projectStructure: 'single-package',
    notablePatterns: [],
    codebaseSummary: 'A Next.js e-commerce app with PostHog analytics.',
    setupIssues: [],
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

// helper to make exec return a value for specific git commands
function mockGitCommand(mapping: Record<string, string>) {
  mockedExec.mockImplementation(((
    cmd: string,
    _opts: unknown,
    cb?: (
      err: Error | null,
      result: { stdout: string; stderr: string },
    ) => void,
  ) => {
    // promisify calls exec with (cmd, opts, callback)
    if (typeof cb === 'function') {
      const match = Object.entries(mapping).find(([key]) => cmd.includes(key));
      if (match) {
        cb(null, { stdout: match[1], stderr: '' });
      } else {
        cb(new Error(`unknown command: ${cmd}`), { stdout: '', stderr: '' });
      }
    }
  }) as typeof childProcess.exec);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createFileAnalysisPoller', () => {
  it('skips when no AI provider is available', async () => {
    const store = new DiscoveryStore();
    const poller = createFileAnalysisPoller(
      store,
      makeMockLogger(),
      '/workspace',
      () => undefined,
      () => makeWorkspaceInfo(),
      60_000,
    );

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(0);
    expect(mockedExec).not.toHaveBeenCalled();

    poller.dispose();
  });

  it('skips when no workspace info is available', async () => {
    const store = new DiscoveryStore();
    const poller = createFileAnalysisPoller(
      store,
      makeMockLogger(),
      '/workspace',
      () => makeMockProvider(),
      () => undefined,
      60_000,
    );

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(0);

    poller.dispose();
  });

  it('skips when PostHog is not installed', async () => {
    const store = new DiscoveryStore();
    const info = makeWorkspaceInfo({
      setupIssues: [
        {
          checkId: 'posthog_not_integrated',
          title: 'PostHog not integrated',
          description: 'No SDK found',
          evidence: [],
          remediation: 'Install posthog-js',
        },
      ],
    });
    const poller = createFileAnalysisPoller(
      store,
      makeMockLogger(),
      '/workspace',
      () => makeMockProvider(),
      () => info,
      60_000,
    );

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(0);

    poller.dispose();
  });

  it('skips when not a git repo', async () => {
    const store = new DiscoveryStore();
    mockedExec.mockImplementation(((
      _cmd: string,
      _opts: unknown,
      cb?: (err: Error | null, result: { stdout: string }) => void,
    ) => {
      if (typeof cb === 'function') {
        cb(new Error('not a git repo'), { stdout: '' });
      }
    }) as typeof childProcess.exec);

    const poller = createFileAnalysisPoller(
      store,
      makeMockLogger(),
      '/workspace',
      () => makeMockProvider(),
      () => makeWorkspaceInfo(),
      60_000,
    );

    poller.start();
    await Promise.resolve();

    expect(store.count).toBe(0);

    poller.dispose();
  });

  it('captures baseline on first poll without creating discoveries', async () => {
    const store = new DiscoveryStore();
    const logger = makeMockLogger();

    mockGitCommand({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse HEAD': 'abc123\n',
    });

    const poller = createFileAnalysisPoller(
      store,
      logger,
      '/workspace',
      () => makeMockProvider(),
      () => makeWorkspaceInfo(),
      60_000,
    );

    await poller.pollNow();

    expect(store.count).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(
      '[file-analysis] baseline captured',
    );

    poller.dispose();
  });

  it('analyzes new files on subsequent polls and creates discoveries', async () => {
    const store = new DiscoveryStore();
    const provider = makeMockProvider();

    mockGitCommand({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse HEAD': 'abc123\n',
      'diff --name-only --diff-filter=A abc123..HEAD': '',
      'diff --name-only --diff-filter=A --cached': '',
      'ls-files --others --exclude-standard': 'src/pages/checkout.tsx\n',
    });

    mockedReadFile.mockResolvedValue(
      'export default function Checkout() { return <div>Buy</div>; }',
    );

    const poller = createFileAnalysisPoller(
      store,
      makeMockLogger(),
      '/workspace',
      () => provider,
      () => makeWorkspaceInfo(),
      60_000,
    );

    // first poll — baseline
    await poller.pollNow();
    expect(store.count).toBe(0);

    // second poll — analyze new files
    await poller.pollNow();

    expect(store.count).toBe(1);
    const discovery = store.getAll()[0]!;
    expect(discovery.kind).toBe('integration_suggestion');
    expect(discovery.title).toBe('Track checkout events');
    expect(discovery.id).toBe('integration_suggestion:src/pages/checkout.tsx');
    expect(provider.generate).toHaveBeenCalled();

    poller.dispose();
  });

  it('does not re-analyze previously analyzed files', async () => {
    const store = new DiscoveryStore();
    const provider = makeMockProvider();

    mockGitCommand({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse HEAD': 'abc123\n',
      'diff --name-only --diff-filter=A abc123..HEAD': '',
      'diff --name-only --diff-filter=A --cached': '',
      'ls-files --others --exclude-standard': 'src/pages/checkout.tsx\n',
    });

    mockedReadFile.mockResolvedValue(
      'export default function Checkout() { return <div>Buy</div>; }',
    );

    const poller = createFileAnalysisPoller(
      store,
      makeMockLogger(),
      '/workspace',
      () => provider,
      () => makeWorkspaceInfo(),
      60_000,
    );

    await poller.pollNow(); // baseline
    await poller.pollNow(); // analyze

    jest.mocked(provider.generate).mockClear();

    // third poll — same file, should not re-analyze
    await poller.pollNow();

    expect(provider.generate).not.toHaveBeenCalled();

    poller.dispose();
  });

  it('respects batch limit of 5 files', async () => {
    const store = new DiscoveryStore();
    const provider = makeMockProvider({
      type: 'text',
      content: JSON.stringify({ suggestions: [] }),
    });

    const files = Array.from({ length: 8 }, (_, i) => `src/file${i}.ts`).join(
      '\n',
    );

    mockGitCommand({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse HEAD': 'abc123\n',
      'diff --name-only --diff-filter=A abc123..HEAD': '',
      'diff --name-only --diff-filter=A --cached': '',
      'ls-files --others --exclude-standard': files,
    });

    mockedReadFile.mockResolvedValue('const x = 1;');

    const poller = createFileAnalysisPoller(
      store,
      makeMockLogger(),
      '/workspace',
      () => provider,
      () => makeWorkspaceInfo(),
      60_000,
    );

    await poller.pollNow(); // baseline
    await poller.pollNow(); // analyze batch

    // prompt should contain at most 5 files
    const call = jest.mocked(provider.generate).mock.calls[0]!;
    const prompt = call[0][0]!.content as string;
    const fileHeaders = prompt.match(/### src\/file\d\.ts/g) ?? [];
    expect(fileHeaders.length).toBe(5);

    poller.dispose();
  });

  it('skips files matching SKIP_PATTERNS', async () => {
    const store = new DiscoveryStore();
    const provider = makeMockProvider({
      type: 'text',
      content: JSON.stringify({ suggestions: [] }),
    });

    mockGitCommand({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse HEAD': 'abc123\n',
      'diff --name-only --diff-filter=A abc123..HEAD': '',
      'diff --name-only --diff-filter=A --cached': '',
      'ls-files --others --exclude-standard':
        'src/app.test.ts\nlogo.png\nsrc/types.d.ts\ndist/bundle.js\n',
    });

    const poller = createFileAnalysisPoller(
      store,
      makeMockLogger(),
      '/workspace',
      () => provider,
      () => makeWorkspaceInfo(),
      60_000,
    );

    await poller.pollNow(); // baseline
    await poller.pollNow();

    // all files are filtered out, no LLM call
    expect(provider.generate).not.toHaveBeenCalled();

    poller.dispose();
  });

  it('does not create discovery when LLM says needs_integration is false', async () => {
    const store = new DiscoveryStore();
    const provider = makeMockProvider({
      type: 'text',
      content: JSON.stringify({
        suggestions: [
          { file: 'src/utils/format.ts', needs_integration: false },
        ],
      }),
    });

    mockGitCommand({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse HEAD': 'abc123\n',
      'diff --name-only --diff-filter=A abc123..HEAD': '',
      'diff --name-only --diff-filter=A --cached': '',
      'ls-files --others --exclude-standard': 'src/utils/format.ts\n',
    });

    mockedReadFile.mockResolvedValue('export function format() {}');

    const poller = createFileAnalysisPoller(
      store,
      makeMockLogger(),
      '/workspace',
      () => provider,
      () => makeWorkspaceInfo(),
      60_000,
    );

    await poller.pollNow(); // baseline
    await poller.pollNow();

    expect(store.count).toBe(0);

    poller.dispose();
  });

  it('handles LLM errors gracefully', async () => {
    const store = new DiscoveryStore();
    const logger = makeMockLogger();
    const provider = makeMockProvider();
    jest.mocked(provider.generate).mockRejectedValue(new Error('API down'));

    mockGitCommand({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse HEAD': 'abc123\n',
      'diff --name-only --diff-filter=A abc123..HEAD': '',
      'diff --name-only --diff-filter=A --cached': '',
      'ls-files --others --exclude-standard': 'src/page.tsx\n',
    });

    mockedReadFile.mockResolvedValue('export default function Page() {}');

    const poller = createFileAnalysisPoller(
      store,
      logger,
      '/workspace',
      () => provider,
      () => makeWorkspaceInfo(),
      60_000,
    );

    await poller.pollNow(); // baseline
    await poller.pollNow();

    expect(store.count).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      '[file-analysis] LLM call failed',
      expect.any(Error),
    );

    poller.dispose();
  });

  it('shows notification for new suggestions', async () => {
    const store = new DiscoveryStore();

    mockGitCommand({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse HEAD': 'abc123\n',
      'diff --name-only --diff-filter=A abc123..HEAD': '',
      'diff --name-only --diff-filter=A --cached': '',
      'ls-files --others --exclude-standard': 'src/pages/checkout.tsx\n',
    });

    mockedReadFile.mockResolvedValue('export default function Checkout() {}');

    const poller = createFileAnalysisPoller(
      store,
      makeMockLogger(),
      '/workspace',
      () => makeMockProvider(),
      () => makeWorkspaceInfo(),
      60_000,
    );

    await poller.pollNow(); // baseline
    await poller.pollNow();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'PostHog: 1 new integration suggestion for recent files',
    );

    poller.dispose();
  });

  it('shows progress notification during LLM analysis', async () => {
    const store = new DiscoveryStore();

    mockGitCommand({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse HEAD': 'abc123\n',
      'diff --name-only --diff-filter=A abc123..HEAD': '',
      'diff --name-only --diff-filter=A --cached': '',
      'ls-files --others --exclude-standard': 'src/pages/checkout.tsx\n',
    });

    mockedReadFile.mockResolvedValue('export default function Checkout() {}');

    const poller = createFileAnalysisPoller(
      store,
      makeMockLogger(),
      '/workspace',
      () => makeMockProvider(),
      () => makeWorkspaceInfo(),
      60_000,
    );

    await poller.pollNow(); // baseline
    await poller.pollNow();

    expect(vscode.window.withProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'PostHog: Analyzing 1 new file for integration opportunities',
      }),
      expect.any(Function),
    );

    poller.dispose();
  });

  it('skips empty files without marking them as analyzed', async () => {
    const store = new DiscoveryStore();
    const provider = makeMockProvider({
      type: 'text',
      content: JSON.stringify({ suggestions: [] }),
    });

    mockGitCommand({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse HEAD': 'abc123\n',
      'diff --name-only --diff-filter=A abc123..HEAD': '',
      'diff --name-only --diff-filter=A --cached': '',
      'ls-files --others --exclude-standard': 'src/empty.ts\n',
    });

    mockedReadFile.mockResolvedValue('');

    const poller = createFileAnalysisPoller(
      store,
      makeMockLogger(),
      '/workspace',
      () => provider,
      () => makeWorkspaceInfo(),
      60_000,
    );

    await poller.pollNow(); // baseline
    await poller.pollNow();

    // empty file — no LLM call
    expect(provider.generate).not.toHaveBeenCalled();

    // give the file content and poll again — it should now be picked up
    mockedReadFile.mockResolvedValue('export function doStuff() {}');
    await poller.pollNow();

    expect(provider.generate).toHaveBeenCalled();

    poller.dispose();
  });
});
