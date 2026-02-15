import * as vscode from 'vscode';
import { PostHogSidebarProvider } from '../sidebar/sidebar-provider';
import { buildProjectHtml, buildEmptyHtml } from '../sidebar/sidebar-html';
import type { PostHogProject } from '../../auth/schemas';
import type { WorkspaceInfo } from '../../ai/types';

const sampleProject: PostHogProject = {
  id: 42,
  name: 'My App',
  api_token: 'phc_test',
  organization: 'Test Org',
  uuid: 'uuid-42',
};

const sampleWorkspaceInfo: WorkspaceInfo = {
  language: 'typescript',
  frameworks: ['next.js', 'tailwind'],
  frameworkVersions: { 'next.js': '14.2.0', tailwind: '3.4.1' },
  frameworkDetails: { 'next.js': { router: 'app' } },
  packageManager: 'pnpm',
  testFrameworks: ['jest'],
  buildTools: ['tsc', 'esbuild'],
  projectStructure: 'single-package',
  notablePatterns: [],
  detectedAt: new Date().toISOString(),
};

/** Creates a minimal mock of a WebviewView for testing. */
function createMockWebviewView() {
  let messageHandler: ((msg: { command: string }) => void) | undefined;
  const disposeFns: (() => void)[] = [];

  return {
    webview: {
      html: '',
      options: {} as vscode.WebviewOptions,
      onDidReceiveMessage: jest.fn(
        (handler: (msg: { command: string }) => void) => {
          messageHandler = handler;
          return {
            dispose: () => {
              messageHandler = undefined;
            },
          };
        },
      ),
    },
    onDidDispose: jest.fn((fn: () => void) => {
      disposeFns.push(fn);
    }),
    _simulateMessage: (msg: { command: string }) => {
      messageHandler?.(msg);
    },
    _simulateDispose: () => {
      for (const fn of disposeFns) {
        fn();
      }
    },
  };
}

const mockExecuteCommand = vscode.commands.executeCommand as jest.Mock;

describe('buildProjectHtml', () => {
  it('should include project name, id, org, and region', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).toContain('My App');
    expect(html).toContain('42');
    expect(html).toContain('Test Org');
    expect(html).toContain('US');
  });

  it('includes a Content Security Policy', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
    expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+'/);
  });

  it('should use a nonce on the script tag', () => {
    const html = buildProjectHtml(sampleProject, 'us');
    const nonceMatch = html.match(/nonce-([A-Za-z0-9+/=]+)/);

    expect(nonceMatch).not.toBeNull();
    expect(html).toContain(`<script nonce="${nonceMatch![1]}"`);
  });

  it('shows "Unknown" when region is undefined', () => {
    const html = buildProjectHtml(sampleProject, undefined);
    expect(html).toContain('Unknown');
  });

  it('should uppercase the region label', () => {
    const html = buildProjectHtml(sampleProject, 'eu');
    expect(html).toContain('EU');
  });

  it('escapes HTML in project name', () => {
    const html = buildProjectHtml(
      { ...sampleProject, name: '<img onerror=alert(1)>' },
      'us',
    );

    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img onerror');
  });

  it('should escape HTML in organization name', () => {
    const html = buildProjectHtml(
      {
        ...sampleProject,
        organization: 'Org & "Friends"',
      },
      'us',
    );

    expect(html).toContain('Org &amp; &quot;Friends&quot;');
  });

  it('renders the project initial as an avatar', () => {
    const html = buildProjectHtml(sampleProject, 'us');
    expect(html).toContain('<div class="avatar">M</div>');
  });

  it('should show a connected status indicator', () => {
    const html = buildProjectHtml(sampleProject, 'us');
    expect(html).toContain('Connected');
    expect(html).toContain('status-dot');
  });

  it('shows project ID in the details card', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).toContain('Project ID');
    expect(html).toContain('42');
  });

  it('should include "Open in PostHog" link for valid regions', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).toContain('Open in PostHog');
    expect(html).toContain('openDashboard');
  });

  it('does not include "Open in PostHog" for unknown regions', () => {
    const html = buildProjectHtml(sampleProject, undefined);

    expect(html).not.toContain('Open in PostHog');
  });

  it('should include section labels', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).toContain('Details');
    expect(html).toContain('Actions');
  });

  it('includes switch project and sign out buttons', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).toContain('Switch Project');
    expect(html).toContain('Sign Out');
  });

  it('should use addEventListener instead of inline handlers', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).not.toContain('onclick=');
    expect(html).toContain('addEventListener');
  });

  it('includes a footer', () => {
    const html = buildProjectHtml(sampleProject, 'us');
    expect(html).toContain('PostHog IDE Companion');
  });

  it('should show "Not detected" when no detection status', () => {
    const html = buildProjectHtml(sampleProject, 'us');
    expect(html).toContain('Workspace');
    expect(html).toContain('Not detected');
  });

  it('shows "Analyzing" when detection is running', () => {
    const html = buildProjectHtml(
      sampleProject,
      'us',
      undefined,
      undefined,
      undefined,
      'running',
    );
    expect(html).toContain('Analyzing');
  });

  it('should show language and frameworks when detection is complete', () => {
    const html = buildProjectHtml(
      sampleProject,
      'us',
      undefined,
      undefined,
      sampleWorkspaceInfo,
      'complete',
    );
    expect(html).toContain('typescript');
    expect(html).toContain('next.js');
    expect(html).toContain('tailwind');
  });

  it('shows only language when no frameworks detected', () => {
    const noFrameworks: WorkspaceInfo = {
      ...sampleWorkspaceInfo,
      frameworks: [],
    };
    const html = buildProjectHtml(
      sampleProject,
      'us',
      undefined,
      undefined,
      noFrameworks,
      'complete',
    );
    expect(html).toContain('typescript');
    expect(html).not.toContain('&middot;');
  });

  it('should show "Detection failed" when detection failed', () => {
    const html = buildProjectHtml(
      sampleProject,
      'us',
      undefined,
      undefined,
      undefined,
      'failed',
    );
    expect(html).toContain('Detection failed');
  });
});

describe('buildEmptyHtml', () => {
  it('shows empty state message', () => {
    const html = buildEmptyHtml();
    expect(html).toContain('No project selected');
  });

  it('should include a Content Security Policy', () => {
    const html = buildEmptyHtml();
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
  });

  it('includes a descriptive subtitle', () => {
    const html = buildEmptyHtml();
    expect(html).toContain('Sign in and select a project to get started');
  });

  it('should not include any script tags', () => {
    const html = buildEmptyHtml();
    expect(html).not.toContain('<script');
  });
});

describe('PostHogSidebarProvider', () => {
  beforeEach(() => {
    mockExecuteCommand.mockReset();
  });

  it('has the correct static view type', () => {
    expect(PostHogSidebarProvider.viewType).toBe('posthog.sidebar');
  });

  it('should set webview HTML on resolve', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');

    const mockView = createMockWebviewView();
    provider.resolveWebviewView(mockView as unknown as vscode.WebviewView);

    expect(mockView.webview.html).toContain('My App');
  });

  it('enables scripts in webview options', () => {
    const provider = new PostHogSidebarProvider();
    const mockView = createMockWebviewView();

    provider.resolveWebviewView(mockView as unknown as vscode.WebviewView);

    expect(mockView.webview.options.enableScripts).toBe(true);
  });

  it('should show empty state when no project is set', () => {
    const provider = new PostHogSidebarProvider();
    const mockView = createMockWebviewView();

    provider.resolveWebviewView(mockView as unknown as vscode.WebviewView);

    expect(mockView.webview.html).toContain('No project selected');
  });

  it('updates webview when setProject is called after resolve', () => {
    const provider = new PostHogSidebarProvider();
    const mockView = createMockWebviewView();

    provider.resolveWebviewView(mockView as unknown as vscode.WebviewView);
    expect(mockView.webview.html).toContain('No project selected');

    provider.setProject(sampleProject, 'eu');
    expect(mockView.webview.html).toContain('My App');
    expect(mockView.webview.html).toContain('EU');
  });

  it('should execute selectProject on switchProject message', () => {
    const provider = new PostHogSidebarProvider();
    const mockView = createMockWebviewView();

    provider.resolveWebviewView(mockView as unknown as vscode.WebviewView);

    mockView._simulateMessage({
      command: 'switchProject',
    });

    expect(mockExecuteCommand).toHaveBeenCalledWith('posthog.selectProject');
  });

  it('executes signOut on signOut message', () => {
    const provider = new PostHogSidebarProvider();
    const mockView = createMockWebviewView();

    provider.resolveWebviewView(mockView as unknown as vscode.WebviewView);

    mockView._simulateMessage({ command: 'signOut' });

    expect(mockExecuteCommand).toHaveBeenCalledWith('posthog.signOut');
  });

  it('should open dashboard URL on openDashboard message', () => {
    const mockOpenExternal = vscode.env.openExternal as jest.Mock;

    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');

    const mockView = createMockWebviewView();
    provider.resolveWebviewView(mockView as unknown as vscode.WebviewView);

    mockView._simulateMessage({
      command: 'openDashboard',
    });

    expect(mockOpenExternal).toHaveBeenCalled();
  });

  it('updates webview when setWorkspaceDetection is called', () => {
    const provider = new PostHogSidebarProvider();
    const mockView = createMockWebviewView();

    provider.setProject(sampleProject, 'us');
    provider.resolveWebviewView(mockView as unknown as vscode.WebviewView);
    expect(mockView.webview.html).toContain('Not detected');

    provider.setWorkspaceDetection('running');
    expect(mockView.webview.html).toContain('Analyzing');

    provider.setWorkspaceDetection('complete', sampleWorkspaceInfo);
    expect(mockView.webview.html).toContain('typescript');
    expect(mockView.webview.html).toContain('next.js');
  });

  it('should clean up on webview dispose', () => {
    const provider = new PostHogSidebarProvider();
    const mockView = createMockWebviewView();

    provider.resolveWebviewView(mockView as unknown as vscode.WebviewView);

    // After dispose, setting project should not throw
    mockView._simulateDispose();
    provider.setProject(sampleProject, 'us');

    // HTML should not have updated since view is gone
    expect(mockView.webview.html).toContain('No project selected');
  });
});
