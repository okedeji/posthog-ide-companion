import * as vscode from 'vscode';
import { getChatHtml } from './chat-html';
import { ChatController } from '../../chat/chat-controller';
import type { ConsentRequest } from '../../chat/chat-controller';
import type { LLMProvider } from '../../ai/provider';
import type {
  AgentEvent,
  ConsentDecision,
  SessionMessage,
} from '../../ai/types';
import type { PostHogMcpClient } from '../../mcp/client';
import type { PostHogApiClient } from '../../api/client';
import type { WorkspaceInfo } from '../../workspace/types';
import type { PostHogProject } from '../../api/schemas';
import type { Discovery } from '../../features/discoveries/types';
import type { ErrorTrackingIssue } from '../../api/schemas';
import type { ChatHistory, ChatSessionSummary } from '../../chat/history';
import type { Logger } from '../../utils/logger';
import { deriveSessionTitle } from '../../chat/history';

export type CodeSelection = {
  filePath: string;
  relativePath: string;
  language: string;
  startLine: number;
  endLine: number;
  code: string;
};

// Sent from the extension to the webview
type WebviewMessage =
  | { type: 'history'; messages: readonly SessionMessage[] }
  | { type: 'agent_event'; event: AgentEvent }
  | {
      type: 'consent_request';
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: 'state'; isProcessing: boolean }
  | { type: 'error'; message: string }
  | {
      type: 'context_loaded';
      title: string;
      detail: string;
      kind: string;
      severity: string;
    }
  | {
      type: 'session_list';
      sessions: ChatSessionSummary[];
    };

// Sent from the webview to the extension
type IncomingMessage =
  | { type: 'send'; text: string }
  | { type: 'consent_decision'; callId: string; decision: ConsentDecision }
  | { type: 'reset' }
  | { type: 'new_chat' }
  | { type: 'show_history' }
  | { type: 'load_session'; id: string }
  | { type: 'cancel' }
  | { type: 'open_link'; url: string }
  | { type: 'ready' };

// Used getters because these can change mid-session (e.g. user switches llm provider).
export type ChatProviderDeps = {
  extensionUri: vscode.Uri;
  logger: Logger;
  getProvider: () => LLMProvider | undefined;
  getWorkspaceRoot: () => string | undefined;
  getMcpClient: () => PostHogMcpClient | undefined;
  getApiClient: () => PostHogApiClient | undefined;
  getWorkspaceInfo: () => WorkspaceInfo | undefined;
  getProject: () => PostHogProject | undefined;
  chatHistory: ChatHistory;
  onDiscoveryResolved?: (discoveryId: string) => void;
};

export class ChatViewProvider implements vscode.Disposable {
  static readonly viewType = 'posthog.chat';

  private _panel: vscode.WebviewPanel | undefined;
  private _controller: ChatController | undefined;
  private _sessionId: string | undefined;
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly _deps: ChatProviderDeps) {}

  open(): void {
    if (this._panel) {
      this._saveAndReset();
      this._panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ChatViewProvider.viewType,
      'PostHog Companion',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this._initPanel(panel);

    // Lock the editor group so files always open in the code side, not the chat side
    void vscode.commands.executeCommand('workbench.action.lockEditorGroup');
  }

  // Called by WebviewPanelSerializer when VSCode restores a previous session.
  revive(panel: vscode.WebviewPanel): void {
    this._initPanel(panel);

    // Delay reveal so we reclaim focus after other extensions finish restoring
    setTimeout(() => panel.reveal(), 500);
  }

  /** Dispose the current controller so the next message creates a fresh one. */
  resetController(): void {
    this._saveAndReset();
  }

  loadCodeContext(context: CodeSelection): void {
    this._revealOrCreate();

    const controller = this._ensureController();
    if (!controller) {
      return;
    }

    controller.setCodeContext(context);
    this._postMessage({
      type: 'context_loaded',
      title: context.relativePath,
      detail: `Lines ${context.startLine}-${context.endLine}`,
      kind: 'code',
      severity: 'code',
    });
  }

  loadDiscoveryContext(discovery: Discovery): void {
    this._revealOrCreate();

    const controller = this._ensureController();
    if (!controller) {
      return;
    }

    controller.setDiscoveryContext(discovery);
    this._postMessage({
      type: 'context_loaded',
      title: discovery.title,
      detail: buildContextDetail(discovery),
      kind: discovery.kind,
      severity: discovery.severity,
    });
  }

  dispose(): void {
    this._saveCurrentSession();
    this._controller?.dispose();
    this._panel?.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }

  private _revealOrCreate(): void {
    if (this._panel) {
      this._panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ChatViewProvider.viewType,
      'PostHog Companion',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this._initPanel(panel);
    void vscode.commands.executeCommand('workbench.action.lockEditorGroup');
  }

  private _initPanel(panel: vscode.WebviewPanel): void {
    this._panel = panel;

    panel.iconPath = {
      light: vscode.Uri.joinPath(
        this._deps.extensionUri,
        'resources',
        'posthog-icon-light.svg',
      ),
      dark: vscode.Uri.joinPath(
        this._deps.extensionUri,
        'resources',
        'posthog-icon-dark.svg',
      ),
    };

    panel.webview.html = getChatHtml(panel.webview, this._deps.extensionUri);

    panel.onDidDispose(
      () => {
        this._saveCurrentSession();
        this._panel = undefined;
      },
      undefined,
      this._disposables,
    );

    panel.webview.onDidReceiveMessage(
      (msg: IncomingMessage) => this._handleMessage(msg),
      undefined,
      this._disposables,
    );
  }

  private _saveCurrentSession(): void {
    const messages = this._controller?.messages;
    if (!messages || messages.length === 0) {
      return;
    }

    this._deps.chatHistory.save({
      id: this._sessionId ?? crypto.randomUUID(),
      title: deriveSessionTitle(messages),
      messages: [...messages],
      createdAt: messages[0]?.timestamp ?? Date.now(),
      lastActiveAt: messages[messages.length - 1]?.timestamp ?? Date.now(),
    });
  }

  private _saveAndReset(): void {
    this._saveCurrentSession();
    this._controller?.dispose();
    this._controller = undefined;
    this._sessionId = undefined;
    this._postHistory();
    this._postState();
  }

  private _handleMessage(msg: IncomingMessage): void {
    switch (msg.type) {
      case 'ready':
        this._postHistory();
        this._postState();
        break;

      case 'send':
        void this._handleSend(msg.text);
        break;

      case 'consent_decision':
        this._controller?.resolveConsent(msg.callId, msg.decision);
        break;

      case 'reset':
      case 'new_chat':
        this._saveAndReset();
        break;

      case 'show_history':
        this._postMessage({
          type: 'session_list',
          sessions: this._deps.chatHistory.list(),
        });
        break;

      case 'load_session':
        this._loadSession(msg.id);
        break;

      case 'cancel':
        this._controller?.cancel();
        break;

      case 'open_link':
        if (msg.url) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;
    }
  }

  private _loadSession(id: string): void {
    const session = this._deps.chatHistory.get(id);
    if (!session) {
      return;
    }

    this._saveCurrentSession();
    this._controller?.dispose();
    this._controller = undefined;

    this._sessionId = session.id;

    this._postMessage({ type: 'history', messages: session.messages });
    this._postState();
  }

  private async _handleSend(text: string): Promise<void> {
    if (!this._deps.getProvider()) {
      this._postMessage({
        type: 'error',
        message:
          'Not signed in. Use "PostHog: Sign In" from the Command Palette.',
      });
      this._postHistory();
      this._postState();
      return;
    }

    if (!this._deps.getWorkspaceRoot()) {
      this._postMessage({
        type: 'error',
        message: 'No workspace folder open.',
      });
      this._postHistory();
      this._postState();
      return;
    }

    if (!this._deps.getMcpClient()) {
      this._postMessage({
        type: 'error',
        message: 'Connecting to PostHog... Please try again in a moment.',
      });
      this._postHistory();
      this._postState();
      return;
    }

    const controller = this._ensureController();
    if (!controller) {
      this._postMessage({
        type: 'error',
        message: 'Failed to start chat session.',
      });
      this._postHistory();
      this._postState();
      return;
    }

    try {
      await controller.send(text);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      this._postMessage({ type: 'error', message });
    }

    this._saveCurrentSession();
    this._postHistory();
    this._postState();
  }

  private _ensureController(): ChatController | undefined {
    if (this._controller) {
      return this._controller;
    }

    const provider = this._deps.getProvider();
    const workspaceRoot = this._deps.getWorkspaceRoot();

    if (!provider || !workspaceRoot) {
      return undefined;
    }

    this._sessionId = crypto.randomUUID();

    this._controller = new ChatController({
      provider,
      workspaceRoot,
      logger: this._deps.logger,
      mcpClient: this._deps.getMcpClient(),
      apiClient: this._deps.getApiClient(),
      workspaceInfo: this._deps.getWorkspaceInfo(),
      project: this._deps.getProject(),
      onEvent: (event: AgentEvent) => {
        this._postMessage({ type: 'agent_event', event });
      },
      onConsentRequest: (request: ConsentRequest) => {
        this._postMessage({
          type: 'consent_request',
          callId: request.callId,
          toolName: request.toolName,
          args: request.args,
        });
      },
      onDiscoveryResolved: this._deps.onDiscoveryResolved,
    });

    return this._controller;
  }

  private _postMessage(msg: WebviewMessage): void {
    void this._panel?.webview.postMessage(msg);
  }

  private _postHistory(): void {
    this._postMessage({
      type: 'history',
      messages: this._controller?.messages ?? [],
    });
  }

  private _postState(): void {
    this._postMessage({
      type: 'state',
      isProcessing: this._controller?.isRunning ?? false,
    });
  }
}

function buildContextDetail(discovery: Discovery): string {
  const parts: string[] = [];

  if (discovery.kind === 'error') {
    const src = discovery.source as ErrorTrackingIssue;
    if (src.aggregations) {
      parts.push(`${src.aggregations.occurrences} occurrences`);
      parts.push(`${src.aggregations.users} users`);
    }
    if (src.status) {
      parts.push(src.status);
    }
    if (src.function) {
      parts.push(src.function);
    } else if (src.library) {
      parts.push(src.library);
    }
  } else if (discovery.kind === 'setup_issue') {
    if (discovery.description) {
      parts.push(discovery.description);
    }
  }

  return parts.join(' · ');
}
