import * as vscode from 'vscode';
import type { CloudRegion } from './constants';
import type { PostHogProject } from './schemas';
import { CLOUD_URLS } from './constants';
import { ProjectListSchema } from './schemas';

/** Workspace state key for the active project. */
const ACTIVE_PROJECT_KEY = 'posthog.activeProject';

/** Global state key for the default project (fallback). */
const DEFAULT_PROJECT_KEY = 'posthog.defaultProject';

/**
 * Fetches all projects the authenticated user has access to.
 *
 * @param token - OAuth access token.
 * @param region - PostHog cloud region.
 * @returns Array of projects.
 */
export async function fetchProjects(
  token: string,
  region: CloudRegion,
): Promise<PostHogProject[]> {
  const cloudUrl = CLOUD_URLS[region];

  const response = await fetch(`${cloudUrl}/api/projects/`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch projects: ${String(response.status)}`);
  }

  const data: unknown = await response.json();
  const parsed = ProjectListSchema.parse(data);
  return parsed.results;
}

/**
 * Shows a quick pick for the user to select a project.
 *
 * @param projects - Available projects to choose from.
 * @returns The selected project, or undefined if cancelled.
 */
export async function showProjectPicker(
  projects: PostHogProject[],
): Promise<PostHogProject | undefined> {
  const items = projects.map((project) => ({
    label: project.name,
    description: `ID: ${String(project.id)}`,
    project,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a PostHog project',
    ignoreFocusOut: true,
  });

  return picked?.project;
}

/**
 * Returns the active project for the current workspace.
 * Falls back to the global default if no workspace selection.
 *
 * @param context - Extension context for state access.
 * @returns The active project, or undefined.
 */
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

/**
 * Sets the active project for the current workspace.
 * Also updates the global default.
 *
 * @param context - Extension context for state access.
 * @param project - The project to set as active.
 */
export async function setActiveProject(
  context: vscode.ExtensionContext,
  project: PostHogProject,
): Promise<void> {
  await context.workspaceState.update(ACTIVE_PROJECT_KEY, project);
  await context.globalState.update(DEFAULT_PROJECT_KEY, project);
}

/**
 * Clears the active project for the current workspace.
 *
 * @param context - Extension context for state access.
 */
export async function clearActiveProject(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.workspaceState.update(ACTIVE_PROJECT_KEY, undefined);
}
