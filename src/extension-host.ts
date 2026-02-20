import * as vscode from 'vscode';
import { PostHogAuthProvider } from './auth/provider';
import { StatusProvider } from './ui/sidebar/status-provider';
import {
  getActiveProject,
  setActiveProject,
  clearActiveProject,
} from './auth/project-state';
import { showProjectPicker } from './ui/pickers/project';
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

export class ExtensionHost implements vscode.Disposable {
  private readonly authProvider: PostHogAuthProvider;
  private readonly statusProvider: StatusProvider;
  private readonly discoveryStore: DiscoveryStore;
  private readonly chatProvider: ChatViewProvider;
  private readonly statusBar: vscode.StatusBarItem;

  private activeErrorPoller: Poller<void> | undefined;
  private activeAlertPoller: Poller<void> | undefined;
  private activeExperimentPoller: Poller<void> | undefined;
  private activeFlagPoller: Poller<void> | undefined;
  private activeFileAnalysisPoller: Poller<void> | undefined;
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
    context.subscriptions.push(
      vscode.window.createTreeView(DiscoveriesProvider.viewType, {
        treeDataProvider: discoveriesProvider,
      }),
    );
    context.subscriptions.push(discoveriesProvider, this.discoveryStore);

    this.chatProvider = new ChatViewProvider({
      extensionUri: context.extensionUri,
      logger: this.logger,
      getProvider: () => this._resolveAIProvider(),
      getWorkspaceRoot: () =>
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      getMcpClient: () => this.mcpClient,
      getApiClient: () => this.apiClient,
      getWorkspaceInfo: () => getStoredWorkspaceInfo(context),
      chatHistory: new ChatHistory(context.workspaceState),
      onDiscoveryResolved: (id) => this.discoveryStore.remove(id),
    });
    context.subscriptions.push(this.chatProvider);

    // Restore the chat panel if it was open before VSCode restarted
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
      vscode.commands.registerCommand('posthog.detectWorkspace', () => {
        void this.triggerWorkspaceDetection();
      }),
      vscode.commands.registerCommand('posthog.refreshDiscoveries', () => {
        if (this.activeErrorPoller) {
          void this.activeErrorPoller.pollNow();
        }
        if (this.activeAlertPoller) {
          void this.activeAlertPoller.pollNow();
        }
        if (this.activeExperimentPoller) {
          void this.activeExperimentPoller.pollNow();
        }
        if (this.activeFlagPoller) {
          void this.activeFlagPoller.pollNow();
        }
        if (this.activeFileAnalysisPoller) {
          void this.activeFileAnalysisPoller.pollNow();
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
          this.discoveryStore.remove(discovery.id);
        },
      ),
    );
  }

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
    void this.connectMcp(credentials.token, project.id);
    await this.restoreAISelection();
  }

  dispose(): void {
    this.stopDiscoveryPolling();
    this.disconnectMcp();
  }

  private _resolveAIProvider(): LLMProvider | undefined {
    const aiSelection = getActiveAISelection(this.context);
    if (!aiSelection) {
      return undefined;
    }

    // Sync getter. Safe because the provider is only resolved after secrets are loaded.
    if (this._cachedProvider) {
      return this._cachedProvider;
    }
    return undefined;
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

  private async connectMcp(apiKey: string, projectId: number): Promise<void> {
    this.disconnectMcp();
    try {
      this.mcpClient = new PostHogMcpClient({ apiKey, projectId });
      await this.mcpClient.connect();
      this.logger.info(`MCP connected (${this.mcpClient.tools.length} tools)`);
    } catch (err) {
      this.logger.error('MCP connection failed (non-fatal)', err);
      this.mcpClient = undefined;
    }
  }

  private disconnectMcp(): void {
    if (this.mcpClient) {
      this.mcpClient.dispose();
      this.mcpClient = undefined;
    }
  }

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

      this.startDiscoveryPolling(credentials.region, selected.id);
      void this.connectMcp(credentials.token, selected.id);
      this.logger.info(`Selected project: ${selected.name} (${selected.id})`);

      const aiSelection = getActiveAISelection(this.context);
      if (aiSelection) {
        const aiConfig = await getAIConfig(this.context.secrets);
        const label = getModelLabel(aiSelection);
        this.statusProvider.setAISelection(aiSelection, label);
        if (hasApiKey(aiConfig, aiSelection.provider)) {
          await this._refreshCachedProvider();
          const workspaceInfo = getStoredWorkspaceInfo(this.context);
          if (workspaceInfo) {
            this.statusProvider.setWorkspaceDetection(
              'complete',
              workspaceInfo,
            );
          }
        }
      } else {
        await this.configureAI();
      }
    } catch (err) {
      this.logger.error('Project selection failed', err);
      void vscode.window.showErrorMessage('PostHog: Failed to load projects.');
    }
  }

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

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;

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
            onEvent: (event) => {
              if (event.type === 'tool_call_start') {
                const message = formatToolProgress(
                  event.call.name,
                  String(
                    event.call.arguments['path'] ??
                      event.call.arguments['pattern'] ??
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

  private startDiscoveryPolling(region: CloudRegion, projectId: number): void {
    this.stopDiscoveryPolling();
    this.discoveryStore.clear();

    const resolveToken = async () => {
      const credentials = await this.authProvider.getValidToken();
      return credentials?.token;
    };
    const client = new PostHogApiClient(resolveToken, region, projectId);
    this.apiClient = client;
    this.activeErrorPoller = createErrorPoller(
      client,
      this.discoveryStore,
      this.logger,
    );
    this.activeAlertPoller = createAlertPoller(
      client,
      this.discoveryStore,
      this.logger,
    );
    this.activeExperimentPoller = createExperimentPoller(
      client,
      this.discoveryStore,
      this.logger,
    );
    this.activeFlagPoller = createFlagPoller(
      client,
      this.discoveryStore,
      this.logger,
    );

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      this.activeFileAnalysisPoller = createFileAnalysisPoller(
        this.discoveryStore,
        this.logger,
        workspaceRoot,
        () => this._resolveAIProvider(),
        () => getStoredWorkspaceInfo(this.context),
      );
    }

    this.activeErrorPoller.start();
    this.activeAlertPoller.start();
    this.activeExperimentPoller.start();
    this.activeFlagPoller.start();
    this.activeFileAnalysisPoller?.start();
    this.logger.info('Discovery polling started');
  }

  private stopDiscoveryPolling(): void {
    if (this.activeErrorPoller) {
      this.activeErrorPoller.dispose();
      this.activeErrorPoller = undefined;
    }
    if (this.activeAlertPoller) {
      this.activeAlertPoller.dispose();
      this.activeAlertPoller = undefined;
    }
    if (this.activeExperimentPoller) {
      this.activeExperimentPoller.dispose();
      this.activeExperimentPoller = undefined;
    }
    if (this.activeFlagPoller) {
      this.activeFlagPoller.dispose();
      this.activeFlagPoller = undefined;
    }
    if (this.activeFileAnalysisPoller) {
      this.activeFileAnalysisPoller.dispose();
      this.activeFileAnalysisPoller = undefined;
    }
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

  private mergeSetupIssues(setupIssues: WorkspaceInfo['setupIssues']): void {
    const discoveries = workspaceInfoToSetupDiscoveries(setupIssues);
    this.discoveryStore.replaceByKind('setup_issue', discoveries);
    this.logger.info(`Replaced setup issues (${discoveries.length} current)`);
  }

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
