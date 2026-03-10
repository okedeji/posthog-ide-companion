import * as path from 'path';
import * as vscode from 'vscode';
import { PostHogAuthProvider } from './auth/provider';
import { StatusProvider } from './ui/sidebar/status-provider';
import {
  getActiveProject,
  setActiveProject,
  clearActiveProject,
} from './auth/project-state';
import { showProjectPicker } from './ui/pickers/project';
import { showWorkspacePathPicker } from './ui/pickers/workspace-path';
import { AUTH_PROVIDER_ID } from './auth/constants';
import type { CloudRegion } from './auth/constants';
import { fetchProjects } from './api/client';
import { showAISetupFlow, showAIReconfigureMenu } from './ui/pickers/ai-setup';
import { getModelLabel } from './ai/models';
import {
  getAIConfig,
  hasApiKey,
  createProvider,
  getActiveAISelection,
  setActiveAISelection,
} from './ai/config';
import type { WorkspaceInfo } from './workspace/types';
import { detectWorkspace } from './workspace/detection';
import {
  getStoredWorkspaceInfo,
  setStoredWorkspaceInfo,
  clearStoredWorkspaceInfo,
  isWorkspaceInfoStale,
} from './workspace/storage';
import type { Logger } from './utils/logger';
import { PostHogApiClient } from './api/client';
import { DiscoveryStore } from './features/discoveries/store';
import { DiscoveriesProvider } from './ui/sidebar/discoveries-provider';
import { createErrorPoller } from './features/discoveries/pollers/error-poller';
import { createAlertPoller } from './features/discoveries/pollers/alert-poller';
import { createExperimentPoller } from './features/discoveries/pollers/experiment-poller';
import { createFlagPoller } from './features/discoveries/pollers/flag-poller';
import { createFileAnalysisPoller } from './features/discoveries/pollers/file-analysis-poller';
import { workspaceInfoToSetupDiscoveries } from './features/discoveries/scanners/setup-issues';
import type { Poller } from './features/discoveries/poller';
import type { LLMProvider } from './ai/provider';
import { ChatViewProvider } from './ui/chat/chat-provider';
import { ChatHistory } from './chat/history';
import { PostHogMcpClient } from './mcp/client';
import type { Discovery } from './features/discoveries/types';
import { SendToChatCodeLensProvider } from './ui/editor/send-to-chat-lens';

export class ExtensionHost implements vscode.Disposable {
  private readonly authProvider: PostHogAuthProvider;
  private readonly statusProvider: StatusProvider;
  private readonly discoveryStore: DiscoveryStore;
  private readonly chatProvider: ChatViewProvider;
  private readonly statusBar: vscode.StatusBarItem;

  private activePollers: Poller<void>[] = [];
  private mcpClient: PostHogMcpClient | undefined;
  private apiClient: PostHogApiClient | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
  ) {
    this.authProvider = new PostHogAuthProvider(context.secrets);
    context.subscriptions.push(
      vscode.authentication.registerAuthenticationProvider(
        PostHogAuthProvider.id,
        'PostHog',
        this.authProvider,
        { supportsMultipleAccounts: false },
      ),
    );
    context.subscriptions.push(this.authProvider);

    this.statusProvider = new StatusProvider();
    context.subscriptions.push(
      vscode.window.createTreeView(StatusProvider.viewType, {
        treeDataProvider: this.statusProvider,
      }),
    );

    this.discoveryStore = new DiscoveryStore();
    const discoveriesProvider = new DiscoveriesProvider(this.discoveryStore);
    const discoveriesView = vscode.window.createTreeView(
      DiscoveriesProvider.viewType,
      { treeDataProvider: discoveriesProvider },
    );
    context.subscriptions.push(discoveriesView);
    context.subscriptions.push(
      this.discoveryStore.onDidChange(() => {
        const count = this.discoveryStore.count;
        discoveriesView.badge =
          count > 0
            ? { value: count, tooltip: `${count} discoveries` }
            : undefined;
      }),
    );
    context.subscriptions.push(discoveriesProvider, this.discoveryStore);

    this.chatProvider = new ChatViewProvider({
      extensionUri: context.extensionUri,
      logger: this.logger,
      getProvider: () => this._resolveAIProvider(),
      getWorkspaceRoot: () => this._getWorkspaceRoot(),
      getMcpClient: () => this.mcpClient,
      getApiClient: () => this.apiClient,
      getWorkspaceInfo: () => getStoredWorkspaceInfo(context),
      getProject: () => getActiveProject(context),
      chatHistory: new ChatHistory(context.workspaceState),
      onDiscoveryResolved: (id) => this.dismissDiscovery(id),
    });
    context.subscriptions.push(this.chatProvider);

    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer(ChatViewProvider.viewType, {
        deserializeWebviewPanel: async (panel: vscode.WebviewPanel) => {
          this.chatProvider.revive(panel);
        },
      }),
    );

    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBar.show();
    context.subscriptions.push(this.statusBar);
  }

  // --- commands ---

  registerCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('posthog.signIn', () => {
        void this.signIn();
      }),
      vscode.commands.registerCommand('posthog.signOut', () => {
        void this.signOut();
      }),
      vscode.commands.registerCommand('posthog.selectProject', () => {
        void this.selectProject();
      }),
      vscode.commands.registerCommand('posthog.configureAI', () => {
        void this.configureAI();
      }),
      vscode.commands.registerCommand('posthog.openDashboard', () => {
        const url = this.statusProvider.getDashboardUrl();
        if (url) {
          void vscode.env.openExternal(vscode.Uri.parse(url));
        }
      }),
      vscode.commands.registerCommand('posthog.switchWorkspacePath', () => {
        void this.switchWorkspacePath();
      }),
      vscode.commands.registerCommand('posthog.detectWorkspace', () => {
        void this.triggerWorkspaceDetection();
      }),
      vscode.commands.registerCommand('posthog.refreshDiscoveries', () => {
        for (const poller of this.activePollers) {
          void poller.pollNow();
        }
      }),
      vscode.commands.registerCommand('posthog.openChat', () => {
        this.chatProvider.open();
      }),
      vscode.commands.registerCommand(
        'posthog.investigateDiscovery',
        (discovery: Discovery) => {
          this.chatProvider.loadDiscoveryContext(discovery);
        },
      ),
      vscode.commands.registerCommand(
        'posthog.dismissDiscovery',
        (discovery: Discovery) => {
          this.dismissDiscovery(discovery.id);
        },
      ),
      vscode.commands.registerCommand('posthog.sendToChat', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
          return;
        }

        const { selection, document } = editor;
        const workspaceRoot = this._getWorkspaceRoot();
        const filePath = document.uri.fsPath;
        const relativePath = workspaceRoot
          ? filePath.replace(workspaceRoot + '/', '')
          : filePath;

        this.chatProvider.loadCodeContext({
          filePath,
          relativePath,
          language: document.languageId,
          startLine: selection.start.line + 1,
          endLine: selection.end.line + 1,
          code: document.getText(selection),
        });
      }),
    );

    const codeLensProvider = new SendToChatCodeLensProvider();
    this.context.subscriptions.push(
      vscode.languages.registerCodeLensProvider('*', codeLensProvider),
      vscode.window.onDidChangeTextEditorSelection(() =>
        codeLensProvider.refresh(),
      ),
      codeLensProvider,
    );
  }

  // --- lifecycle ---

  async initialize(): Promise<void> {
    const credentials = await this.authProvider.getValidToken();

    if (!credentials) {
      this.updateStatusBar('signedOut');
      await setContextKeys(false, false);
      showSignInNotification();
      this.logger.info('No existing session found');
      return;
    }

    this.logger.info('Restored existing session');
    await setContextKeys(true, false);

    const project = getActiveProject(this.context);
    if (!project) {
      this.updateStatusBar('noProject');
      return;
    }

    this.statusProvider.setProject(project, credentials.region);
    this.updateStatusBar('project', project.name);
    await setContextKeys(true, true);
    this.logger.info(`Restored project: ${project.name}`);

    this.startDiscoveryPolling(credentials.region, project.id);
    await this.connectMcp(credentials.token, project.id, credentials.region);
    await this.restoreAISelection();
  }

  dispose(): void {
    this.stopDiscoveryPolling();
    this.disconnectMcp();
  }

  private _getWorkspaceRoot(): string | undefined {
    const base = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!base) {
      return undefined;
    }

    const sub = vscode.workspace
      .getConfiguration('posthog')
      .get<string>('workspacePath', '')
      .trim();

    return sub ? path.join(base, sub) : base;
  }

  // --- ai provider ---

  private async _resolveAIProvider(): Promise<LLMProvider | undefined> {
    const aiSelection = getActiveAISelection(this.context);
    if (!aiSelection) {
      return undefined;
    }

    if (this._cachedProvider) {
      return this._cachedProvider;
    }

    await this._refreshCachedProvider();
    return this._cachedProvider;
  }

  private _cachedProvider: LLMProvider | undefined;

  private async _refreshCachedProvider(): Promise<void> {
    const aiSelection = getActiveAISelection(this.context);
    if (!aiSelection) {
      this._cachedProvider = undefined;
      return;
    }
    const aiConfig = await getAIConfig(this.context.secrets);
    this._cachedProvider = createProvider(aiConfig, aiSelection);
  }

  // --- mcp ---

  private async connectMcp(
    apiKey: string,
    projectId: number,
    region: CloudRegion,
  ): Promise<void> {
    this.disconnectMcp();
    const client = new PostHogMcpClient({ apiKey, projectId, region });
    try {
      await client.connect();
      this.mcpClient = client;
      this.logger.info(`MCP connected (${client.tools.length} tools)`);
    } catch (err) {
      this.logger.error('MCP connection failed (non-fatal)', err);
      client.dispose();
    }
  }

  private disconnectMcp(): void {
    if (this.mcpClient) {
      this.mcpClient.dispose();
      this.mcpClient = undefined;
    }
  }

  // --- auth and project ---

  private async signIn(): Promise<void> {
    try {
      const session = await vscode.authentication.getSession(
        AUTH_PROVIDER_ID,
        [],
        { createIfNone: true },
      );

      if (!session) {
        return;
      }

      this.logger.info(`Signed in as ${session.account.label}`);
      await setContextKeys(true, false);
      await this.selectProject();
    } catch (err) {
      this.logger.error('Sign in failed', err);
      void vscode.window.showErrorMessage(
        'PostHog: Sign in failed. Please try again.',
      );
    }
  }

  private async signOut(): Promise<void> {
    try {
      await this.authProvider.removeSession(PostHogAuthProvider.id);
      await clearActiveProject(this.context);

      this.stopDiscoveryPolling();
      this.disconnectMcp();
      this._cachedProvider = undefined;
      this.apiClient = undefined;
      this.discoveryStore.clear();
      this.chatProvider.resetController();

      this.statusProvider.setProject(undefined);
      this.statusProvider.setAISelection(undefined);
      this.updateStatusBar('signedOut');
      await setContextKeys(false, false);

      this.logger.info('Signed out');
    } catch (err) {
      this.logger.error('Sign out failed', err);
    }
  }

  private async selectProject(): Promise<void> {
    try {
      const credentials = await this.authProvider.getValidToken();
      if (!credentials) {
        void vscode.window.showWarningMessage('PostHog: Please sign in first.');
        return;
      }

      this.statusBar.text = '$(loading~spin) PostHog: Loading...';

      const projects = await fetchProjects(
        credentials.token,
        credentials.region,
      );

      if (projects.length === 0) {
        void vscode.window.showWarningMessage(
          'PostHog: No projects found for your account.',
        );
        this.updateStatusBar('noProject');
        return;
      }

      const selected = await showProjectPicker(projects);
      if (!selected) {
        const existing = getActiveProject(this.context);
        this.updateStatusBar(
          existing ? 'project' : 'noProject',
          existing?.name,
        );
        return;
      }

      await setActiveProject(this.context, selected);
      this.statusProvider.setProject(selected, credentials.region);
      this.updateStatusBar('project', selected.name);
      await setContextKeys(true, true);

      this.chatProvider.resetController();
      this.startDiscoveryPolling(credentials.region, selected.id);
      await this.connectMcp(credentials.token, selected.id, credentials.region);
      this.logger.info(`Selected project: ${selected.name} (${selected.id})`);

      await this.switchWorkspacePath();
    } catch (err) {
      this.logger.error('Project selection failed', err);
      void vscode.window.showErrorMessage('PostHog: Failed to load projects.');
    }
  }

  // --- workspace path ---

  private async switchWorkspacePath(): Promise<void> {
    const baseRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!baseRoot) {
      return;
    }

    const sub = await showWorkspacePathPicker(baseRoot);
    if (sub === undefined) {
      return;
    }

    await vscode.workspace
      .getConfiguration('posthog')
      .update('workspacePath', sub, vscode.ConfigurationTarget.Workspace);
    await clearStoredWorkspaceInfo(this.context);
    if (sub) {
      this.logger.info(`Workspace path set to: ${sub}`);
    }

    const aiSelection = getActiveAISelection(this.context);
    if (aiSelection) {
      const aiConfig = await getAIConfig(this.context.secrets);
      const label = getModelLabel(aiSelection);
      this.statusProvider.setAISelection(aiSelection, label);
      if (hasApiKey(aiConfig, aiSelection.provider)) {
        await this._refreshCachedProvider();
        void this.triggerWorkspaceDetection();
      }
    } else {
      await this.configureAI();
    }
  }

  // --- ai config ---

  private async configureAI(): Promise<void> {
    try {
      const existing = getActiveAISelection(this.context);
      const selection = existing
        ? await showAIReconfigureMenu(this.context)
        : await showAISetupFlow(this.context);

      if (selection) {
        const label = getModelLabel(selection);
        this.statusProvider.setAISelection(selection, label);
        this.logger.info(`AI configured: ${selection.provider} (${label})`);
        await this._refreshCachedProvider();
        this.chatProvider.resetController();

        if (!getStoredWorkspaceInfo(this.context)) {
          void this.triggerWorkspaceDetection();
        }
      } else {
        this.statusProvider.setAISelection(undefined);
        this._cachedProvider = undefined;
      }
    } catch (err) {
      this.logger.error('AI configuration failed', err);
      void vscode.window.showErrorMessage(
        'PostHog: Failed to configure AI provider.',
      );
    }
  }

  // --- workspace detection ---

  private async triggerWorkspaceDetection(): Promise<void> {
    const aiSelection = getActiveAISelection(this.context);
    if (!aiSelection) {
      return;
    }

    const aiConfig = await getAIConfig(this.context.secrets);
    const provider = createProvider(aiConfig, aiSelection);
    if (!provider) {
      return;
    }

    const workspaceRoot = this._getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    const detectionStatus = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      0,
    );
    detectionStatus.text = '$(loading~spin) PostHog: Analyzing workspace…';
    detectionStatus.tooltip = 'Workspace detection in progress';
    detectionStatus.show();
    this.statusProvider.setWorkspaceDetection('running');

    try {
      const info = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'PostHog: Analyzing workspace',
          cancellable: false,
        },
        async (progress) => {
          return detectWorkspace(provider, workspaceRoot, {
            mcpClient: this.mcpClient,
            onEvent: (event) => {
              if (event.type === 'tool_call_start') {
                const message = formatToolProgress(
                  event.call.name,
                  String(
                    event.call.arguments['path'] ??
                      event.call.arguments['pattern'] ??
                      event.call.arguments['query'] ??
                      '',
                  ),
                );
                progress.report({ message });
                detectionStatus.text = `$(loading~spin) PostHog: ${message}`;
              }
            },
            onLog: (level, message) => {
              switch (level) {
                case 'error':
                  this.logger.error(`[detection] ${message}`);
                  break;
                case 'warn':
                case 'info':
                  this.logger.info(`[detection] ${message}`);
                  break;
                case 'debug':
                  this.logger.debug(`[detection] ${message}`);
                  break;
              }
            },
          });
        },
      );

      if (info) {
        await setStoredWorkspaceInfo(this.context, info);
        this.statusProvider.setWorkspaceDetection('complete', info);
        this.mergeSetupIssues(info.setupIssues);
        this.logger.info(
          `Workspace detected: ${info.language} (${info.frameworks.join(', ') || 'no frameworks'})`,
        );
      } else {
        this.statusProvider.setWorkspaceDetection('failed');
        this.logger.info('Workspace detection returned no results');
        void vscode.window.showWarningMessage(
          'PostHog: Could not analyze workspace. You can retry via Command Palette -> "PostHog: Detect Workspace".',
        );
      }
    } catch (err) {
      this.statusProvider.setWorkspaceDetection('failed');
      this.logger.error('Workspace detection failed', err);
      void vscode.window.showWarningMessage(
        'PostHog: Workspace detection failed. You can retry via Command Palette -> "PostHog: Detect Workspace".',
      );
    } finally {
      detectionStatus.dispose();
    }
  }

  private async promptStaleWorkspaceRedetection(): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      'PostHog: Workspace info may be outdated. Re-analyze?',
      'Re-analyze',
      'Dismiss',
    );

    if (action === 'Re-analyze') {
      void this.triggerWorkspaceDetection();
    }
  }

  // --- discovery polling ---

  private startDiscoveryPolling(region: CloudRegion, projectId: number): void {
    this.stopDiscoveryPolling();
    this.discoveryStore.clear();

    const resolveToken = async () => {
      const credentials = await this.authProvider.getValidToken();
      return credentials?.token;
    };
    const client = new PostHogApiClient(resolveToken, region, projectId);
    this.apiClient = client;

    this.activePollers = [
      createErrorPoller(client, this.discoveryStore, this.logger),
      createAlertPoller(client, this.discoveryStore, this.logger),
      createExperimentPoller(client, this.discoveryStore, this.logger),
      createFlagPoller(client, this.discoveryStore, this.logger),
    ];

    const workspaceRoot = this._getWorkspaceRoot();
    if (workspaceRoot) {
      this.activePollers.push(
        createFileAnalysisPoller(
          this.discoveryStore,
          this.logger,
          workspaceRoot,
          () => this._resolveAIProvider(),
          () => getStoredWorkspaceInfo(this.context),
        ),
      );
    }

    for (const poller of this.activePollers) {
      poller.start();
    }
    this.logger.info('Discovery polling started');
  }

  private stopDiscoveryPolling(): void {
    for (const poller of this.activePollers) {
      poller.dispose();
    }
    this.activePollers = [];
  }

  private async restoreAISelection(): Promise<void> {
    const aiSelection = getActiveAISelection(this.context);
    if (!aiSelection) {
      return;
    }

    await setActiveAISelection(this.context, aiSelection);
    const aiConfig = await getAIConfig(this.context.secrets);
    const label = getModelLabel(aiSelection);
    this.statusProvider.setAISelection(aiSelection, label);

    if (!hasApiKey(aiConfig, aiSelection.provider)) {
      this.logger.info(`AI configured as ${label} but API key is missing`);
      return;
    }

    this.logger.info(`Restored AI: ${aiSelection.provider} (${label})`);
    await this._refreshCachedProvider();

    const workspaceInfo = getStoredWorkspaceInfo(this.context);
    if (!workspaceInfo) {
      void this.triggerWorkspaceDetection();
      return;
    }

    this.statusProvider.setWorkspaceDetection('complete', workspaceInfo);
    this.mergeSetupIssues(workspaceInfo.setupIssues);
    if (isWorkspaceInfoStale(workspaceInfo)) {
      void this.promptStaleWorkspaceRedetection();
    }
  }

  private dismissDiscovery(id: string): void {
    this.discoveryStore.remove(id);

    // Persist setup issue dismissals so they survive reload.
    if (id.startsWith('setup_issue:')) {
      const checkId = id.slice('setup_issue:'.length);
      const info = getStoredWorkspaceInfo(this.context);
      if (info?.setupIssues?.length) {
        const filtered = info.setupIssues.filter((i) => i.checkId !== checkId);
        if (filtered.length !== info.setupIssues.length) {
          void setStoredWorkspaceInfo(this.context, {
            ...info,
            setupIssues: filtered,
          });
        }
      }
    }
  }

  private mergeSetupIssues(setupIssues: WorkspaceInfo['setupIssues']): void {
    const discoveries = workspaceInfoToSetupDiscoveries(setupIssues);
    this.discoveryStore.replaceByKind('setup_issue', discoveries);
    this.logger.info(`Replaced setup issues (${discoveries.length} current)`);
  }

  // --- status bar ---

  private updateStatusBar(
    state: 'signedOut' | 'noProject' | 'project',
    projectName?: string,
  ): void {
    switch (state) {
      case 'signedOut':
        this.statusBar.text = '$(sign-in) PostHog: Sign In';
        this.statusBar.command = 'posthog.signIn';
        this.statusBar.tooltip = 'Click to sign in to PostHog';
        break;
      case 'noProject':
        this.statusBar.text = '$(folder) PostHog: Select Project';
        this.statusBar.command = 'posthog.selectProject';
        this.statusBar.tooltip = 'Click to select a project';
        break;
      case 'project':
        this.statusBar.text = '$(comment-discussion) Ask PostHog';
        this.statusBar.command = 'posthog.openChat';
        this.statusBar.tooltip = `Ask about errors, analytics, and flags in ${projectName ?? 'your project'}`;
        break;
    }
  }
}

async function setContextKeys(
  authenticated: boolean,
  projectSelected: boolean,
): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    'posthog.authenticated',
    authenticated,
  );
  await vscode.commands.executeCommand(
    'setContext',
    'posthog.projectSelected',
    projectSelected,
  );
}

function formatToolProgress(toolName: string, arg: string): string {
  switch (toolName) {
    case 'readFile':
      return arg ? `Reading ${arg}` : 'Reading file';
    case 'listDirectory':
      return arg === '.' ? 'Listing root directory' : `Listing ${arg}`;
    case 'searchCode':
      return arg ? `Searching for "${arg}"` : 'Searching code';
    case 'checkEnvKeys':
      return 'Checking environment';
    case 'docs-search':
      return arg ? `Searching docs for "${arg}"` : 'Searching docs';
    default:
      return `Running ${toolName}`;
  }
}

function showSignInNotification(): void {
  void vscode.window
    .showInformationMessage(
      'Sign in to PostHog to monitor errors and get AI-powered fixes.',
      'Sign In',
    )
    .then((action) => {
      if (action === 'Sign In') {
        void vscode.commands.executeCommand('posthog.signIn');
      }
    });
}
