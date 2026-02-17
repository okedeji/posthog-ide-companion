import * as vscode from 'vscode';
import type { PostHogProject } from '../../api/schemas';

export async function showProjectPicker(
  projects: PostHogProject[],
): Promise<PostHogProject | undefined> {
  const items = projects.map((project) => ({
    label: project.name,
    description: `ID: ${project.id}`,
    project,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a PostHog project',
    ignoreFocusOut: true,
  });

  return picked?.project;
}
