import * as vscode from 'vscode';
import type { PostHogProject } from './schemas';
import type { CloudRegion } from './constants';
import { CLOUD_URLS } from './constants';
import { buildProjectHtml, buildEmptyHtml } from './sidebar-html';

type WebviewMessage =
  | { command: 'switchProject' }
  | { command: 'signOut' }
  | { command: 'openDashboard' };

/**
 * Webview provider for the PostHog sidebar panel.
 *
 * Manages the webview lifecycle and routes messages from the
 * webview buttons to extension commands. All HTML rendering
 * is delegated to sidebar-html.ts.
 */
export class PostHogSidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'posthog.sidebar';

  private _view: vscode.WebviewView | undefined;
  private _project: PostHogProject | undefined;
  private _region: string | undefined;
  private _disposables: vscode.Disposable[] = [];

  /**
   * Updates the sidebar with new project info and re-renders.
   *
   * @param project - The active project, or undefined to clear.
   * @param region - The cloud region (e.g. "us", "eu").
   */
  setProject(project: PostHogProject | undefined, region?: string): void {
    this._project = project;
    this._region = region;
    this._render();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    const subscription = webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        switch (message.command) {
          case 'switchProject':
            void vscode.commands.executeCommand('posthog.selectProject');
            break;
          case 'signOut':
            void vscode.commands.executeCommand('posthog.signOut');
            break;
          case 'openDashboard':
            this._openDashboard();
            break;
        }
      },
    );

    webviewView.onDidDispose(() => {
      subscription.dispose();
      this._view = undefined;
    });

    this._disposables.push(subscription);
    this._render();
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }

  private _render(): void {
    if (!this._view) {
      return;
    }

    this._view.webview.html = this._project
      ? buildProjectHtml(this._project, this._region)
      : buildEmptyHtml();
  }

  private _openDashboard(): void {
    if (!this._project || !this._region) {
      return;
    }

    const baseUrl = CLOUD_URLS[this._region as CloudRegion];
    if (!baseUrl) {
      return;
    }

    const url = `${baseUrl}/project/${String(this._project.id)}`;
    void vscode.env.openExternal(vscode.Uri.parse(url));
  }
}
