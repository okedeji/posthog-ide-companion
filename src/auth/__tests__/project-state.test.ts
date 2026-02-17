import {
  getActiveProject,
  setActiveProject,
  clearActiveProject,
} from '../project-state';
import type { PostHogProject } from '../../api/schemas';

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

describe('getActiveProject / setActiveProject / clearActiveProject', () => {
  it('returns undefined when no project is set', () => {
    const context = createMockContext();
    expect(getActiveProject(context)).toBeUndefined();
  });

  it('should return the workspace project after setting it', async () => {
    const context = createMockContext();
    await setActiveProject(context, sampleProject);
    expect(getActiveProject(context)).toEqual(sampleProject);
  });

  it('falls back to global default when workspace has no project', async () => {
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
});
