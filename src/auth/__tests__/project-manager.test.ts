import * as vscode from 'vscode';
import {
  fetchProjects,
  showProjectPicker,
  getActiveProject,
  setActiveProject,
  clearActiveProject,
} from '../project-manager';
import type { PostHogProject } from '../schemas';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch;

/** Creates a minimal mock of ExtensionContext with in-memory state. */
function createMockContext() {
  const workspaceState = new Map<string, unknown>();
  const globalState = new Map<string, unknown>();

  return {
    workspaceState: {
      get: <T>(key: string): T | undefined =>
        workspaceState.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        if (value === undefined) {
          workspaceState.delete(key);
        } else {
          workspaceState.set(key, value);
        }
      },
    },
    globalState: {
      get: <T>(key: string): T | undefined =>
        globalState.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        if (value === undefined) {
          globalState.delete(key);
        } else {
          globalState.set(key, value);
        }
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const sampleProject: PostHogProject = {
  id: 1,
  name: 'Test Project',
  api_token: 'phc_test',
  organization: 'Test Org',
  uuid: 'uuid-1',
};

const sampleProject2: PostHogProject = {
  id: 2,
  name: 'Other Project',
  api_token: 'phc_other',
  organization: 'Test Org',
  uuid: 'uuid-2',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchProjects', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should return parsed projects from the API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        count: 2,
        results: [
          {
            id: 1,
            name: 'Project A',
            api_token: 'phc_a',
            organization: 'Org',
            uuid: 'uuid-a',
          },
          {
            id: 2,
            name: 'Project B',
            api_token: 'phc_b',
            organization: 'Org',
            uuid: 'uuid-b',
          },
        ],
      }),
    });

    const projects = await fetchProjects('token', 'us');

    expect(projects).toHaveLength(2);
    expect(projects[0]?.name).toBe('Project A');
    expect(projects[1]?.name).toBe('Project B');
  });

  it('should call the correct URL for US region', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0, results: [] }),
    });

    await fetchProjects('my-token', 'us');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://us.posthog.com/api/projects/',
      {
        headers: { Authorization: 'Bearer my-token' },
      },
    );
  });

  it('should call the correct URL for EU region', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0, results: [] }),
    });

    await fetchProjects('my-token', 'eu');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://eu.posthog.com/api/projects/',
      {
        headers: { Authorization: 'Bearer my-token' },
      },
    );
  });

  it('should throw on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });

    await expect(fetchProjects('bad-token', 'us')).rejects.toThrow(
      'Failed to fetch projects: 401',
    );
  });

  it('should throw on malformed response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: 'shape' }),
    });

    await expect(fetchProjects('token', 'us')).rejects.toThrow();
  });
});

describe('getActiveProject / setActiveProject / clearActiveProject', () => {
  it('should return undefined when no project is set', () => {
    const context = createMockContext();
    expect(getActiveProject(context)).toBeUndefined();
  });

  it('should return the workspace project after setting it', async () => {
    const context = createMockContext();
    await setActiveProject(context, sampleProject);
    expect(getActiveProject(context)).toEqual(sampleProject);
  });

  it('should fall back to global default when workspace has no project', async () => {
    const context = createMockContext();

    // Set a project (writes to both workspace and global)
    await setActiveProject(context, sampleProject);

    // Clear workspace-level project
    await clearActiveProject(context);

    // Should fall back to global
    expect(getActiveProject(context)).toEqual(sampleProject);
  });

  it('should prefer workspace project over global default', async () => {
    const context = createMockContext();

    // Set first project (writes to global)
    await setActiveProject(context, sampleProject);

    // Set second project (overwrites workspace + global)
    await setActiveProject(context, sampleProject2);

    expect(getActiveProject(context)?.name).toBe('Other Project');
  });

  it('should return undefined after clearing when no global default exists', () => {
    const context = createMockContext();
    // Never set anything — both workspace and global are empty
    expect(getActiveProject(context)).toBeUndefined();
  });
});

describe('showProjectPicker', () => {
  const mockShowQuickPick = vscode.window.showQuickPick as jest.Mock;

  beforeEach(() => {
    mockShowQuickPick.mockReset();
  });

  it('should return the selected project', async () => {
    mockShowQuickPick.mockResolvedValue({
      label: 'Test Project',
      description: 'ID: 1',
      project: sampleProject,
    });

    const result = await showProjectPicker([sampleProject, sampleProject2]);

    expect(result).toEqual(sampleProject);
  });

  it('should return undefined when user cancels', async () => {
    mockShowQuickPick.mockResolvedValue(undefined);

    const result = await showProjectPicker([sampleProject]);

    expect(result).toBeUndefined();
  });

  it('should pass projects as quick pick items', async () => {
    mockShowQuickPick.mockResolvedValue(undefined);

    await showProjectPicker([sampleProject, sampleProject2]);

    const items = mockShowQuickPick.mock.calls[0][0] as {
      label: string;
      description: string;
    }[];
    expect(items).toHaveLength(2);
    expect(items[0]?.label).toBe('Test Project');
    expect(items[0]?.description).toBe('ID: 1');
    expect(items[1]?.label).toBe('Other Project');
    expect(items[1]?.description).toBe('ID: 2');
  });
});
