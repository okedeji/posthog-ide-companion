import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.vscode',
  '.idea',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
  '.turbo',
]);

export async function showWorkspacePathPicker(
  workspaceRoot: string,
): Promise<string | undefined> {
  const dirs = await getTopLevelDirs(workspaceRoot);

  const items: vscode.QuickPickItem[] = [
    {
      label: '$(root-folder) Use full workspace',
      description: path.basename(workspaceRoot),
      detail: 'Analyze the entire workspace folder',
    },
    ...dirs.map((dir) => ({
      label: `$(folder) ${dir}`,
      description: '',
    })),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Which folder should PostHog focus on?',
    ignoreFocusOut: true,
  });

  if (!picked) {
    return undefined;
  }

  if (picked.label.includes('Use full workspace')) {
    return '';
  }

  // strip the $(folder) icon prefix
  return picked.label.replace('$(folder) ', '');
}

async function getTopLevelDirs(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'),
      )
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
