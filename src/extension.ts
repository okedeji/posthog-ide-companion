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
import { getAIConfig, hasApiKey } from './ai/config';
import { createLogger } from './utils/logger';
import type { Logger } from './utils/logger';

/**
 * Extension entry point. Called by VSCode when the extension activates.
 * Wires up auth, sidebar, status bar, and commands. No business logic here.
 *
 * @param context - The extension context provided by VSCode.
 */
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

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

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
      // User cancelled — restore previous state
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

    logger.info(`Selected project: ${selected.name} (${String(selected.id)})`);

    // Auto-trigger AI setup if not yet configured
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

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

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
      } else {
        logger.info(`AI configured as ${label} but API key is missing`);
      }
    }
  } else {
    updateStatusBar(statusBar, 'noProject');
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

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
