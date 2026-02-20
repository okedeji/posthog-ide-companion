import * as vscode from 'vscode';
import { ExtensionHost } from '../extension-host';
import type { Logger } from '../utils/logger';

jest.mock('../auth/provider');
jest.mock('../ui/sidebar/status-provider');
jest.mock('../features/discoveries/store');
jest.mock('../ui/sidebar/discoveries-provider');
jest.mock('../features/discoveries/pollers/error-poller');
jest.mock('../features/discoveries/scanners/setup-issues');
jest.mock('../auth/project-state');
jest.mock('../api/client');
jest.mock('../ui/pickers/project');
jest.mock('../ui/pickers/ai-setup');
jest.mock('../ai/models');
jest.mock('../ai/config');
jest.mock('../workspace/detection');
jest.mock('../workspace/storage');

import { PostHogAuthProvider } from '../auth/provider';
import { StatusProvider } from '../ui/sidebar/status-provider';
import { DiscoveryStore } from '../features/discoveries/store';
import { DiscoveriesProvider } from '../ui/sidebar/discoveries-provider';
import { createErrorPoller } from '../features/discoveries/pollers/error-poller';
import {
  getActiveProject,
  setActiveProject,
  clearActiveProject,
} from '../auth/project-state';
import { fetchProjects } from '../api/client';
import { showProjectPicker } from '../ui/pickers/project';
import { getModelLabel } from '../ai/models';
import {
  getAIConfig,
  hasApiKey,
  createProvider,
  getActiveAISelection,
  setActiveAISelection,
} from '../ai/config';
import {
  getStoredWorkspaceInfo,
  isWorkspaceInfoStale,
} from '../workspace/storage';

// Cast module-level mocks
const mockRegisterCommand = vscode.commands.registerCommand as jest.Mock;
const mockExecuteCommand = vscode.commands.executeCommand as jest.Mock;
const mockShowInfoMessage = vscode.window.showInformationMessage as jest.Mock;

const mockGetActiveProject = getActiveProject as jest.Mock;
const mockSetActiveProject = setActiveProject as jest.Mock;
const mockFetchProjects = fetchProjects as jest.Mock;
const mockShowProjectPicker = showProjectPicker as jest.Mock;
const mockClearActiveProject = clearActiveProject as jest.Mock;

const mockGetActiveAISelection = getActiveAISelection as jest.Mock;
const mockSetActiveAISelection = setActiveAISelection as jest.Mock;
const mockGetModelLabel = getModelLabel as jest.Mock;

const mockGetAIConfig = getAIConfig as jest.Mock;
const mockHasApiKey = hasApiKey as jest.Mock;
const mockCreateProvider = createProvider as jest.Mock;

const mockGetStoredWorkspaceInfo = getStoredWorkspaceInfo as jest.Mock;
const mockIsWorkspaceInfoStale = isWorkspaceInfoStale as jest.Mock;

const mockCreateErrorPoller = createErrorPoller as jest.Mock;

// Helpers

function createMockLogger(): Logger {
  return { info: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function createMockContext(): vscode.ExtensionContext {
  const stateStore = new Map<string, unknown>();
  return {
    subscriptions: [],
    secrets: {
      get: jest.fn(),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: () => undefined })),
    },
    workspaceState: {
      get: jest.fn((key: string) => stateStore.get(key)),
      update: jest.fn(async (key: string, value: unknown) => {
        stateStore.set(key, value);
      }),
      keys: jest.fn(() => []),
    },
    globalState: {
      get: jest.fn((key: string) => stateStore.get(key)),
      update: jest.fn(async (key: string, value: unknown) => {
        stateStore.set(key, value);
      }),
      keys: jest.fn(() => []),
      setKeysForSync: jest.fn(),
    },
  } as unknown as vscode.ExtensionContext;
}

const sampleProject = { id: 123, name: 'Test Project', organization: 'Org' };
const sampleCredentials = { token: 'phx_test', region: 'us' as const };

describe('ExtensionHost', () => {
  let context: vscode.ExtensionContext;
  let logger: Logger;
  let host: ExtensionHost;

  // Stored references to mock instances (mockImplementation returns these)
  let authInstance: Record<string, jest.Mock>;
  let statusInstance: Record<string, jest.Mock>;
  let storeInstance: Record<string, jest.Mock | number>;
  let pollerInstance: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.clearAllMocks();

    authInstance = {
      getValidToken: jest.fn(async () => undefined),
      removeSession: jest.fn(),
      dispose: jest.fn(),
    };
    (PostHogAuthProvider as unknown as jest.Mock).mockImplementation(
      () => authInstance,
    );

    statusInstance = {
      setProject: jest.fn(),
      setAISelection: jest.fn(),
      setWorkspaceDetection: jest.fn(),
      getDashboardUrl: jest.fn(() => undefined),
    };
    (StatusProvider as unknown as jest.Mock).mockImplementation(
      () => statusInstance,
    );
    (StatusProvider as unknown as Record<string, string>).viewType =
      'posthog.status';

    storeInstance = {
      merge: jest.fn(() => 0),
      clear: jest.fn(),
      dispose: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
      count: 0,
    };
    (DiscoveryStore as unknown as jest.Mock).mockImplementation(
      () => storeInstance,
    );

    (DiscoveriesProvider as unknown as jest.Mock).mockImplementation(
      () => ({}),
    );
    (DiscoveriesProvider as unknown as Record<string, string>).viewType =
      'posthog.discoveries';

    pollerInstance = {
      start: jest.fn(),
      pollNow: jest.fn(),
      dispose: jest.fn(),
    };
    mockCreateErrorPoller.mockReturnValue(pollerInstance);

    mockGetActiveProject.mockReturnValue(undefined);
    mockGetActiveAISelection.mockReturnValue(undefined);
    mockGetModelLabel.mockReturnValue('claude-sonnet');
    mockGetAIConfig.mockResolvedValue({});
    mockHasApiKey.mockReturnValue(false);
    mockGetStoredWorkspaceInfo.mockReturnValue(undefined);
    mockIsWorkspaceInfoStale.mockReturnValue(false);
    mockCreateProvider.mockReturnValue(undefined);

    context = createMockContext();
    logger = createMockLogger();
    host = new ExtensionHost(context, logger);
  });

  afterEach(() => {
    host.dispose();
  });

  describe('constructor', () => {
    it('should register the auth provider', () => {
      expect(
        vscode.authentication.registerAuthenticationProvider,
      ).toHaveBeenCalledWith(
        PostHogAuthProvider.id,
        'PostHog',
        expect.anything(),
        { supportsMultipleAccounts: false },
      );
    });

    it('should create tree views for status and discoveries', () => {
      const createTreeView = vscode.window.createTreeView as jest.Mock;
      expect(createTreeView).toHaveBeenCalledWith('posthog.status', {
        treeDataProvider: expect.anything(),
      });
      expect(createTreeView).toHaveBeenCalledWith('posthog.discoveries', {
        treeDataProvider: expect.anything(),
      });
    });

    it('should create and show the status bar item', () => {
      expect(vscode.window.createStatusBarItem).toHaveBeenCalled();
    });
  });

  describe('registerCommands', () => {
    it('should register all expected commands', () => {
      host.registerCommands();

      const registered = mockRegisterCommand.mock.calls.map(
        (c: unknown[]) => c[0],
      );
      expect(registered).toContain('posthog.signIn');
      expect(registered).toContain('posthog.signOut');
      expect(registered).toContain('posthog.selectProject');
      expect(registered).toContain('posthog.configureAI');
      expect(registered).toContain('posthog.openDashboard');
      expect(registered).toContain('posthog.detectWorkspace');
      expect(registered).toContain('posthog.refreshDiscoveries');
    });
  });

  describe('initialize', () => {
    it('should show sign-in notification when no session exists', async () => {
      await host.initialize();

      expect(mockShowInfoMessage).toHaveBeenCalledWith(
        expect.stringContaining('Sign in'),
        'Sign In',
      );
      expect(logger.info).toHaveBeenCalledWith('No existing session found');
    });

    it('should set context keys to false when no session', async () => {
      await host.initialize();

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'setContext',
        'posthog.authenticated',
        false,
      );
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'setContext',
        'posthog.projectSelected',
        false,
      );
    });

    it('should restore project and start polling when session + project exist', async () => {
      authInstance.getValidToken.mockResolvedValue(sampleCredentials);
      mockGetActiveProject.mockReturnValue(sampleProject);

      await host.initialize();

      expect(logger.info).toHaveBeenCalledWith('Restored existing session');
      expect(logger.info).toHaveBeenCalledWith(
        `Restored project: ${sampleProject.name}`,
      );
      expect(statusInstance.setProject).toHaveBeenCalledWith(
        sampleProject,
        'us',
      );
      expect(mockCreateErrorPoller).toHaveBeenCalled();
      expect(pollerInstance.start).toHaveBeenCalled();
    });

    it('should restore AI selection when configured', async () => {
      const aiSelection = { provider: 'anthropic', model: 'claude-sonnet' };
      authInstance.getValidToken.mockResolvedValue(sampleCredentials);
      mockGetActiveProject.mockReturnValue(sampleProject);
      mockGetActiveAISelection.mockReturnValue(aiSelection);
      mockHasApiKey.mockReturnValue(true);

      await host.initialize();

      expect(mockSetActiveAISelection).toHaveBeenCalledWith(
        context,
        aiSelection,
      );
      expect(statusInstance.setAISelection).toHaveBeenCalledWith(
        aiSelection,
        'claude-sonnet',
      );
    });

    it('should show noProject status when session exists but no project', async () => {
      authInstance.getValidToken.mockResolvedValue(sampleCredentials);
      mockGetActiveProject.mockReturnValue(undefined);

      await host.initialize();

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'setContext',
        'posthog.projectSelected',
        false,
      );
    });
  });

  describe('signOut (via command)', () => {
    it('should clear all state and stop polling', async () => {
      authInstance.getValidToken.mockResolvedValue(sampleCredentials);
      mockGetActiveProject.mockReturnValue(sampleProject);
      await host.initialize();

      host.registerCommands();
      const signOutCall = mockRegisterCommand.mock.calls.find(
        (c: unknown[]) => c[0] === 'posthog.signOut',
      );
      const signOutHandler = signOutCall[1] as () => void;
      signOutHandler();

      await tick();

      expect(authInstance.removeSession).toHaveBeenCalled();
      expect(mockClearActiveProject).toHaveBeenCalledWith(context);
      expect(storeInstance.clear).toHaveBeenCalled();
      expect(statusInstance.setProject).toHaveBeenCalledWith(undefined);
      expect(statusInstance.setAISelection).toHaveBeenCalledWith(undefined);
    });
  });

  describe('selectProject (via command)', () => {
    it('should fetch projects and update state on selection', async () => {
      authInstance.getValidToken.mockResolvedValue(sampleCredentials);
      mockFetchProjects.mockResolvedValue([sampleProject]);
      mockShowProjectPicker.mockResolvedValue(sampleProject);
      mockGetActiveAISelection.mockReturnValue(undefined);

      host.registerCommands();
      const selectCall = mockRegisterCommand.mock.calls.find(
        (c: unknown[]) => c[0] === 'posthog.selectProject',
      );
      const selectHandler = selectCall[1] as () => void;
      selectHandler();

      await tick();

      expect(mockSetActiveProject).toHaveBeenCalledWith(context, sampleProject);
      expect(statusInstance.setProject).toHaveBeenCalledWith(
        sampleProject,
        'us',
      );
      expect(mockCreateErrorPoller).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should stop discovery polling', async () => {
      authInstance.getValidToken.mockResolvedValue(sampleCredentials);
      mockGetActiveProject.mockReturnValue(sampleProject);
      await host.initialize();

      host.dispose();

      expect(pollerInstance.dispose).toHaveBeenCalled();
    });
  });
});

/** Flush microtask queue so void-launched async handlers complete. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
