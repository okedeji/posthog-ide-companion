import type * as vscode from 'vscode';
import type { PostHogProject } from '../api/schemas';

const ACTIVE_PROJECT_KEY = 'posthog.activeProject';
const DEFAULT_PROJECT_KEY = 'posthog.defaultProject';

// Falls back to global default if no workspace-specific selection
export function getActiveProject(
  context: vscode.ExtensionContext,
): PostHogProject | undefined {
  const workspace =
    context.workspaceState.get<PostHogProject>(ACTIVE_PROJECT_KEY);
  if (workspace) {
    return workspace;
  }
  return context.globalState.get<PostHogProject>(DEFAULT_PROJECT_KEY);
}

// Also sets global default so new workspaces inherit the choice
export async function setActiveProject(
  context: vscode.ExtensionContext,
  project: PostHogProject,
): Promise<void> {
  await context.workspaceState.update(ACTIVE_PROJECT_KEY, project);
  await context.globalState.update(DEFAULT_PROJECT_KEY, project);
}

export async function clearActiveProject(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.workspaceState.update(ACTIVE_PROJECT_KEY, undefined);
}
