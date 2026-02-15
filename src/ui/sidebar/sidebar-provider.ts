import * as vscode from 'vscode';
import type { PostHogProject } from '../../auth/schemas';
import type {
  AISelection,
  WorkspaceInfo,
  DetectionStatus,
} from '../../ai/types';
import type { CloudRegion } from '../../auth/constants';
import { CLOUD_URLS } from '../../auth/constants';
import { buildProjectHtml, buildEmptyHtml } from './sidebar-html';

type WebviewMessage =
  | { command: 'switchProject' }
  | { command: 'signOut' }
  | { command: 'openDashboard' }
  | { command: 'configureAI' };

/** Sidebar webview — routes button messages to extension commands. */
export class PostHogSidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'posthog.sidebar';

  private _view: vscode.WebviewView | undefined;
  private _project: PostHogProject | undefined;
  private _region: CloudRegion | undefined;
  private _aiSelection: AISelection | undefined;
  private _aiModelLabel: string | undefined;
  private _workspaceInfo: WorkspaceInfo | undefined;
  private _detectionStatus: DetectionStatus | undefined;
  private _disposables: vscode.Disposable[] = [];

  setProject(project: PostHogProject | undefined, region?: CloudRegion): void {
    this._project = project;
    this._region = region;
    this._render();
  }

  setAISelection(
    selection: AISelection | undefined,
    modelLabel?: string,
  ): void {
    this._aiSelection = selection;
    this._aiModelLabel = modelLabel;
    this._render();
  }

  setWorkspaceDetection(
    status: DetectionStatus | undefined,
    info?: WorkspaceInfo,
  ): void {
    this._detectionStatus = status;
    this._workspaceInfo = info;
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
          case 'configureAI':
            void vscode.commands.executeCommand('posthog.configureAI');
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
      ? buildProjectHtml(
          this._project,
          this._region,
          this._aiSelection,
          this._aiModelLabel,
          this._workspaceInfo,
          this._detectionStatus,
        )
      : buildEmptyHtml();
  }

  private _openDashboard(): void {
    if (!this._project || !this._region) {
      return;
    }

    const baseUrl = CLOUD_URLS[this._region];
    if (!baseUrl) {
      return;
    }

    const url = `${baseUrl}/project/${this._project.id}`;
    void vscode.env.openExternal(vscode.Uri.parse(url));
  }
}
