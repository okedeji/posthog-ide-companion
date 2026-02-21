import type * as vscode from 'vscode';
import type { PostHogProject } from '../api/schemas';

const ACTIVE_PROJECT_KEY = 'posthog.activeProject';

export function getActiveProject(
  context: vscode.ExtensionContext,
): PostHogProject | undefined {
  return context.workspaceState.get<PostHogProject>(ACTIVE_PROJECT_KEY);
}

export async function setActiveProject(
  context: vscode.ExtensionContext,
  project: PostHogProject,
): Promise<void> {
  await context.workspaceState.update(ACTIVE_PROJECT_KEY, project);
}

export async function clearActiveProject(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.workspaceState.update(ACTIVE_PROJECT_KEY, undefined);
}
