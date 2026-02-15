import * as vscode from 'vscode';
import { PostHogSidebarProvider } from '../sidebar/sidebar-provider';
import { buildProjectHtml, buildEmptyHtml } from '../sidebar/sidebar-html';
import type { PostHogProject } from '../../auth/schemas';

const sampleProject: PostHogProject = {
  id: 42,
  name: 'My App',
  api_token: 'phc_test',
  organization: 'Test Org',
  uuid: 'uuid-42',
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

// ---------------------------------------------------------------------------
// Pure HTML builders
// ---------------------------------------------------------------------------

describe('buildProjectHtml', () => {
  it('should include project name, id, org, and region', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).toContain('My App');
    expect(html).toContain('42');
    expect(html).toContain('Test Org');
    expect(html).toContain('US');
  });

  it('should include a Content Security Policy', () => {
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

  it('should show "Unknown" when region is undefined', () => {
    const html = buildProjectHtml(sampleProject, undefined);
    expect(html).toContain('Unknown');
  });

  it('should uppercase the region label', () => {
    const html = buildProjectHtml(sampleProject, 'eu');
    expect(html).toContain('EU');
  });

  it('should escape HTML in project name', () => {
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

  it('should render the project initial as an avatar', () => {
    const html = buildProjectHtml(sampleProject, 'us');
    expect(html).toContain('<div class="avatar">M</div>');
  });

  it('should show a connected status indicator', () => {
    const html = buildProjectHtml(sampleProject, 'us');
    expect(html).toContain('Connected');
    expect(html).toContain('status-dot');
  });

  it('should show project ID in the details card', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).toContain('Project ID');
    expect(html).toContain('42');
  });

  it('should include "Open in PostHog" link for valid regions', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).toContain('Open in PostHog');
    expect(html).toContain('openDashboard');
  });

  it('should not include "Open in PostHog" for unknown regions', () => {
    const html = buildProjectHtml(sampleProject, undefined);

    expect(html).not.toContain('Open in PostHog');
  });

  it('should include section labels', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).toContain('Details');
    expect(html).toContain('Actions');
  });

  it('should include switch project and sign out buttons', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).toContain('Switch Project');
    expect(html).toContain('Sign Out');
  });

  it('should use addEventListener instead of inline handlers', () => {
    const html = buildProjectHtml(sampleProject, 'us');

    expect(html).not.toContain('onclick=');
    expect(html).toContain('addEventListener');
  });

  it('should include a footer', () => {
    const html = buildProjectHtml(sampleProject, 'us');
    expect(html).toContain('PostHog IDE Companion');
  });
});

describe('buildEmptyHtml', () => {
  it('should show empty state message', () => {
    const html = buildEmptyHtml();
    expect(html).toContain('No project selected');
  });

  it('should include a Content Security Policy', () => {
    const html = buildEmptyHtml();
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
  });

  it('should include a descriptive subtitle', () => {
    const html = buildEmptyHtml();
    expect(html).toContain('Sign in and select a project to get started');
  });

  it('should not include any script tags', () => {
    const html = buildEmptyHtml();
    expect(html).not.toContain('<script');
  });
});

// ---------------------------------------------------------------------------
// WebviewViewProvider integration
// ---------------------------------------------------------------------------

describe('PostHogSidebarProvider', () => {
  beforeEach(() => {
    mockExecuteCommand.mockReset();
  });

  it('should have the correct static view type', () => {
    expect(PostHogSidebarProvider.viewType).toBe('posthog.sidebar');
  });

  it('should set webview HTML on resolve', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');

    const mockView = createMockWebviewView();
    provider.resolveWebviewView(mockView as unknown as vscode.WebviewView);

    expect(mockView.webview.html).toContain('My App');
  });

  it('should enable scripts in webview options', () => {
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

  it('should update webview when setProject is called after resolve', () => {
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

  it('should execute signOut on signOut message', () => {
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
