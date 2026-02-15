import * as vscode from 'vscode';
import { PostHogAuthProvider } from './auth/provider';
import { PostHogSidebarProvider } from './ui/sidebar/sidebar-provider';
import {
  fetchProjects,
  showProjectPicker,
  getActiveProject,
  setActiveProject,
  clearActiveProject,
} from './auth/project-manager';
import { AUTH_PROVIDER_ID } from './auth/constants';
import {
  showAISetupFlow,
  showAIReconfigureMenu,
  getActiveAISelection,
  getModelLabel,
} from './ai/selection-manager';
import { getAIConfig, hasApiKey, createProvider } from './ai/config';
import {
  detectWorkspace,
  getStoredWorkspaceInfo,
  setStoredWorkspaceInfo,
  isWorkspaceInfoStale,
} from './ai/workspace-detection';
import { createLogger } from './utils/logger';
import type { Logger } from './utils/logger';

/** Extension entry point — wires up auth, sidebar, status bar, and commands. */
export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('PostHog');
  const logger = createLogger(channel);
  logger.info('PostHog IDE Companion activating');

  // Auth provider
  const authProvider = new PostHogAuthProvider(context.secrets);
  context.subscriptions.push(
    vscode.authentication.registerAuthenticationProvider(
      PostHogAuthProvider.id,
      'PostHog',
      authProvider,
      { supportsMultipleAccounts: false },
    ),
  );
  context.subscriptions.push(authProvider);

  // Sidebar
  const sidebarProvider = new PostHogSidebarProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PostHogSidebarProvider.viewType,
      sidebarProvider,
    ),
  );

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('posthog.signIn', () => {
      void handleSignIn(
        context,
        authProvider,
        sidebarProvider,
        statusBar,
        logger,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('posthog.signOut', () => {
      void handleSignOut(
        context,
        authProvider,
        sidebarProvider,
        statusBar,
        logger,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('posthog.selectProject', () => {
      void handleSelectProject(
        context,
        authProvider,
        sidebarProvider,
        statusBar,
        logger,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('posthog.configureAI', () => {
      void handleConfigureAI(context, sidebarProvider, logger);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('posthog.detectWorkspace', () => {
      void triggerWorkspaceDetection(context, sidebarProvider, logger);
    }),
  );

  // Initial state check
  void initializeState(
    context,
    authProvider,
    sidebarProvider,
    statusBar,
    logger,
  );
}

export function deactivate(): void {
  // no-op: lifecycle managed by context.subscriptions
}

// Command handlers

async function handleSignIn(
  context: vscode.ExtensionContext,
  authProvider: PostHogAuthProvider,
  sidebarProvider: PostHogSidebarProvider,
  statusBar: vscode.StatusBarItem,
  logger: Logger,
): Promise<void> {
  try {
    const session = await vscode.authentication.getSession(
      AUTH_PROVIDER_ID,
      [],
      { createIfNone: true },
    );

    if (!session) {
      return;
    }

    logger.info(`Signed in as ${session.account.label}`);
    await setContextKeys(true, false);

    // Immediately prompt for project selection
    await handleSelectProject(
      context,
      authProvider,
      sidebarProvider,
      statusBar,
      logger,
    );
  } catch (err) {
    logger.error('Sign in failed', err);
    void vscode.window.showErrorMessage(
      'PostHog: Sign in failed. Please try again.',
    );
  }
}

async function handleSignOut(
  context: vscode.ExtensionContext,
  authProvider: PostHogAuthProvider,
  sidebarProvider: PostHogSidebarProvider,
  statusBar: vscode.StatusBarItem,
  logger: Logger,
): Promise<void> {
  try {
    await authProvider.removeSession(PostHogAuthProvider.id);
    await clearActiveProject(context);

    sidebarProvider.setProject(undefined);
    sidebarProvider.setAISelection(undefined);
    updateStatusBar(statusBar, 'signedOut');
    await setContextKeys(false, false);

    logger.info('Signed out');
  } catch (err) {
    logger.error('Sign out failed', err);
  }
}

async function handleSelectProject(
  context: vscode.ExtensionContext,
  authProvider: PostHogAuthProvider,
  sidebarProvider: PostHogSidebarProvider,
  statusBar: vscode.StatusBarItem,
  logger: Logger,
): Promise<void> {
  try {
    const credentials = await authProvider.getValidToken();
    if (!credentials) {
      void vscode.window.showWarningMessage('PostHog: Please sign in first.');
      return;
    }

    statusBar.text = '$(loading~spin) PostHog: Loading...';

    const projects = await fetchProjects(credentials.token, credentials.region);

    if (projects.length === 0) {
      void vscode.window.showWarningMessage(
        'PostHog: No projects found for your account.',
      );
      updateStatusBar(statusBar, 'noProject');
      return;
    }

    const selected = await showProjectPicker(projects);
    if (!selected) {
      // User cancelled, restore previous state
      const existing = getActiveProject(context);
      if (existing) {
        updateStatusBar(statusBar, 'project', existing.name);
      } else {
        updateStatusBar(statusBar, 'noProject');
      }
      return;
    }

    await setActiveProject(context, selected);
    sidebarProvider.setProject(selected, credentials.region);
    updateStatusBar(statusBar, 'project', selected.name);
    await setContextKeys(true, true);

    logger.info(`Selected project: ${selected.name} (${selected.id})`);

    // Kick off AI setup if not configured yet (which in turn triggers workspace detection)
    const aiSelection = getActiveAISelection(context);
    if (!aiSelection) {
      await handleConfigureAI(context, sidebarProvider, logger);
    }
  } catch (err) {
    logger.error('Project selection failed', err);
    void vscode.window.showErrorMessage('PostHog: Failed to load projects.');
  }
}

async function handleConfigureAI(
  context: vscode.ExtensionContext,
  sidebarProvider: PostHogSidebarProvider,
  logger: Logger,
): Promise<void> {
  try {
    const existing = getActiveAISelection(context);
    const selection = existing
      ? await showAIReconfigureMenu(context)
      : await showAISetupFlow(context);

    if (selection) {
      const label = getModelLabel(selection);
      sidebarProvider.setAISelection(selection, label);
      logger.info(`AI configured: ${selection.provider} (${label})`);

      // Auto-trigger workspace detection if not yet run
      if (!getStoredWorkspaceInfo(context)) {
        void triggerWorkspaceDetection(context, sidebarProvider, logger);
      }
    } else {
      sidebarProvider.setAISelection(undefined);
    }
  } catch (err) {
    logger.error('AI configuration failed', err);
    void vscode.window.showErrorMessage(
      'PostHog: Failed to configure AI provider.',
    );
  }
}

async function initializeState(
  context: vscode.ExtensionContext,
  authProvider: PostHogAuthProvider,
  sidebarProvider: PostHogSidebarProvider,
  statusBar: vscode.StatusBarItem,
  logger: Logger,
): Promise<void> {
  const credentials = await authProvider.getValidToken();

  if (!credentials) {
    updateStatusBar(statusBar, 'signedOut');
    await setContextKeys(false, false);
    showSignInNotification();
    logger.info('No existing session found');
    return;
  }

  logger.info('Restored existing session');
  await setContextKeys(true, false);

  const project = getActiveProject(context);
  if (project) {
    sidebarProvider.setProject(project, credentials.region);
    updateStatusBar(statusBar, 'project', project.name);
    await setContextKeys(true, true);
    logger.info(`Restored project: ${project.name}`);

    // Restore AI selection
    const aiSelection = getActiveAISelection(context);
    if (aiSelection) {
      const aiConfig = await getAIConfig(context.secrets);
      const label = getModelLabel(aiSelection);
      sidebarProvider.setAISelection(aiSelection, label);
      if (hasApiKey(aiConfig, aiSelection.provider)) {
        logger.info(`Restored AI: ${aiSelection.provider} (${label})`);

        // Auto-detect workspace if not yet run, or prompt if stale
        const workspaceInfo = getStoredWorkspaceInfo(context);
        if (!workspaceInfo) {
          void triggerWorkspaceDetection(context, sidebarProvider, logger);
        } else {
          sidebarProvider.setWorkspaceDetection('complete', workspaceInfo);
          if (isWorkspaceInfoStale(workspaceInfo)) {
            void promptStaleWorkspaceRedetection(
              context,
              sidebarProvider,
              logger,
            );
          }
        }
      } else {
        logger.info(`AI configured as ${label} but API key is missing`);
      }
    }
  } else {
    updateStatusBar(statusBar, 'noProject');
  }
}

/** Runs LLM-powered workspace detection — non-blocking, stores result on success. */
async function triggerWorkspaceDetection(
  context: vscode.ExtensionContext,
  sidebarProvider: PostHogSidebarProvider,
  logger: Logger,
): Promise<void> {
  const aiSelection = getActiveAISelection(context);
  if (!aiSelection) {
    return;
  }

  const aiConfig = await getAIConfig(context.secrets);
  const provider = createProvider(aiConfig, aiSelection);
  if (!provider) {
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;

  // Temporary status bar item, disposed in the finally block below
  const detectionStatus = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    0,
  );
  detectionStatus.text = '$(loading~spin) PostHog: Analyzing workspace…';
  detectionStatus.tooltip = 'Workspace detection in progress';
  detectionStatus.show();
  sidebarProvider.setWorkspaceDetection('running');

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
              const toolName = event.call.name;
              const arg = String(
                event.call.arguments['path'] ??
                  event.call.arguments['pattern'] ??
                  '',
              );
              const message = formatToolProgress(toolName, arg);
              progress.report({ message });
              detectionStatus.text = `$(loading~spin) PostHog: ${message}`;
            }
          },
          onLog: (level, message) => {
            switch (level) {
              case 'error':
                logger.error(`[detection] ${message}`);
                break;
              case 'warn':
              case 'info':
                logger.info(`[detection] ${message}`);
                break;
              case 'debug':
                logger.debug(`[detection] ${message}`);
                break;
            }
          },
        });
      },
    );

    if (info) {
      await setStoredWorkspaceInfo(context, info);
      sidebarProvider.setWorkspaceDetection('complete', info);
      logger.info(
        `Workspace detected: ${info.language} (${info.frameworks.join(', ') || 'no frameworks'})`,
      );
    } else {
      sidebarProvider.setWorkspaceDetection('failed');
      logger.info('Workspace detection returned no results');
      void vscode.window.showWarningMessage(
        'PostHog: Could not analyze workspace. You can retry via Command Palette → "PostHog: Detect Workspace".',
      );
    }
  } catch (err) {
    sidebarProvider.setWorkspaceDetection('failed');
    logger.error('Workspace detection failed', err);
    void vscode.window.showWarningMessage(
      'PostHog: Workspace detection failed. You can retry via Command Palette → "PostHog: Detect Workspace".',
    );
  } finally {
    detectionStatus.dispose();
  }
}

/** Prompts user to re-analyze if workspace info is older than 7 days. */
async function promptStaleWorkspaceRedetection(
  context: vscode.ExtensionContext,
  sidebarProvider: PostHogSidebarProvider,
  logger: Logger,
): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    'PostHog: Workspace info may be outdated. Re-analyze?',
    'Re-analyze',
    'Dismiss',
  );

  if (action === 'Re-analyze') {
    void triggerWorkspaceDetection(context, sidebarProvider, logger);
  }
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

type StatusBarState = 'signedOut' | 'noProject' | 'project';

function updateStatusBar(
  statusBar: vscode.StatusBarItem,
  state: StatusBarState,
  projectName?: string,
): void {
  switch (state) {
    case 'signedOut':
      statusBar.text = '$(sign-in) PostHog: Sign In';
      statusBar.command = 'posthog.signIn';
      statusBar.tooltip = 'Click to sign in to PostHog';
      break;
    case 'noProject':
      statusBar.text = '$(folder) PostHog: Select Project';
      statusBar.command = 'posthog.selectProject';
      statusBar.tooltip = 'Click to select a project';
      break;
    case 'project':
      statusBar.text = `$(pulse) PostHog: ${projectName ?? 'Unknown'}`;
      statusBar.command = 'posthog.selectProject';
      statusBar.tooltip = 'Click to switch project';
      break;
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
