import * as vscode from 'vscode';
import { PostHogSidebarProvider } from '../sidebar/sidebar-provider';
import type { PostHogProject } from '../../auth/schemas';
import type { WorkspaceInfo } from '../../ai/types';

const sampleProject: PostHogProject = {
  id: 42,
  name: 'My App',
  api_token: 'phc_test',
  organization: 'Test Org',
  uuid: 'uuid-42',
};

const sampleWorkspaceInfo: WorkspaceInfo = {
  language: 'typescript',
  frameworks: ['next.js', 'tailwind'],
  frameworkVersions: { 'next.js': '14.2.0', tailwind: '3.4.1' },
  frameworkDetails: { 'next.js': { router: 'app' } },
  packageManager: 'pnpm',
  testFrameworks: ['jest'],
  buildTools: ['tsc', 'esbuild'],
  projectStructure: 'single-package',
  notablePatterns: [],
  detectedAt: new Date().toISOString(),
};

/** Resolves root items from the provider as TreeItems. */
function getItems(provider: PostHogSidebarProvider): vscode.TreeItem[] {
  return provider.getChildren().map((c) => provider.getTreeItem(c));
}

/** Finds an item by label text. */
function findItem(
  items: vscode.TreeItem[],
  label: string,
): vscode.TreeItem | undefined {
  return items.find((i) => i.label === label);
}

describe('PostHogSidebarProvider', () => {
  it('has the correct static view type', () => {
    expect(PostHogSidebarProvider.viewType).toBe('posthog.sidebar');
  });

  it('returns no items when no project is set', () => {
    const provider = new PostHogSidebarProvider();
    expect(provider.getChildren()).toEqual([]);
  });

  it('returns five items when a project is set', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');

    const items = getItems(provider);
    expect(items).toHaveLength(5);
  });

  it('shows project name and organization', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');

    const items = getItems(provider);
    const project = findItem(items, 'My App');

    expect(project).toBeDefined();
    expect(project!.description).toBe('Test Org');
  });

  it('shows region in uppercase', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'eu');

    const items = getItems(provider);
    const region = findItem(items, 'Region');

    expect(region?.description).toBe('EU');
  });

  it('shows "Unknown" when region is undefined', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, undefined);

    const items = getItems(provider);
    const region = findItem(items, 'Region');

    expect(region?.description).toBe('Unknown');
  });

  it('shows project ID as a string', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');

    const items = getItems(provider);
    const pid = findItem(items, 'Project ID');

    expect(pid?.description).toBe('42');
  });

  it('shows "Not configured" when AI is not set', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');

    const items = getItems(provider);
    const ai = findItem(items, 'AI Model');

    expect(ai?.description).toBe('Not configured');
  });

  it('shows model label when AI is configured', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');
    provider.setAISelection(
      { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
      'Claude Sonnet 4.5',
    );

    const items = getItems(provider);
    const ai = findItem(items, 'AI Model');

    expect(ai?.description).toBe('Claude Sonnet 4.5');
  });

  it('shows language and frameworks in workspace row', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');
    provider.setWorkspaceDetection('complete', sampleWorkspaceInfo);

    const items = getItems(provider);
    const ws = findItem(items, 'Workspace');

    expect(ws?.description).toBe('typescript, next.js, tailwind');
  });

  it('shows only language when no frameworks detected', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');
    provider.setWorkspaceDetection('complete', {
      ...sampleWorkspaceInfo,
      frameworks: [],
    });

    const items = getItems(provider);
    const ws = findItem(items, 'Workspace');

    expect(ws?.description).toBe('typescript');
  });

  it('assigns ThemeIcon to each item', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');

    const items = getItems(provider);

    for (const item of items) {
      expect(item.iconPath).toBeInstanceOf(vscode.ThemeIcon);
    }
  });

  it('sets all items to non-collapsible', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');

    const items = getItems(provider);

    for (const item of items) {
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
    }
  });

  it('appends workspace detail rows when detection is complete', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');
    provider.setWorkspaceDetection('complete', sampleWorkspaceInfo);

    const items = getItems(provider);
    const labels = items.map((i) => i.label);

    expect(labels).toContain('Language');
    expect(labels).toContain('Frameworks');
    expect(labels).toContain('Package Mgr');
    expect(labels).toContain('Build');
    expect(labels).toContain('Structure');
  });

  it('shows correct descriptions in workspace detail rows', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');
    provider.setWorkspaceDetection('complete', sampleWorkspaceInfo);

    const items = getItems(provider);

    expect(findItem(items, 'Language')?.description).toBe('typescript');
    expect(findItem(items, 'Frameworks')?.description).toBe(
      'next.js, tailwind',
    );
    expect(findItem(items, 'Package Mgr')?.description).toBe('pnpm');
    expect(findItem(items, 'Build')?.description).toBe('tsc, esbuild');
    expect(findItem(items, 'Structure')?.description).toBe('single-package');
  });

  it('does not append detail rows when detection has not run', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');

    const items = getItems(provider);
    const labels = items.map((i) => i.label);

    expect(labels).not.toContain('Language');
    expect(labels).not.toContain('Frameworks');
    expect(labels).not.toContain('Package Mgr');
    expect(labels).not.toContain('Build');
    expect(labels).not.toContain('Structure');
  });

  it('fires onDidChangeTreeData when setProject is called', () => {
    const provider = new PostHogSidebarProvider();
    const listener = jest.fn();
    provider.onDidChangeTreeData(listener);

    provider.setProject(sampleProject, 'us');

    expect(listener).toHaveBeenCalled();
  });

  it('fires onDidChangeTreeData when setAISelection is called', () => {
    const provider = new PostHogSidebarProvider();
    const listener = jest.fn();
    provider.onDidChangeTreeData(listener);

    provider.setAISelection({ provider: 'openai', model: 'gpt-4o' });

    expect(listener).toHaveBeenCalled();
  });

  it('returns dashboard URL for valid project and region', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');

    expect(provider.getDashboardUrl()).toBe(
      'https://us.posthog.com/project/42',
    );
  });

  it('returns undefined dashboard URL when no project is set', () => {
    const provider = new PostHogSidebarProvider();
    expect(provider.getDashboardUrl()).toBeUndefined();
  });

  it('returns undefined dashboard URL when region is missing', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, undefined);

    expect(provider.getDashboardUrl()).toBeUndefined();
  });

  it('includes detail rows in total count when detected', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');
    provider.setWorkspaceDetection('complete', sampleWorkspaceInfo);

    expect(provider.getChildren()).toHaveLength(10);
  });

  it('clears items when project is set to undefined', () => {
    const provider = new PostHogSidebarProvider();
    provider.setProject(sampleProject, 'us');
    expect(provider.getChildren()).toHaveLength(5);

    provider.setProject(undefined);
    expect(provider.getChildren()).toHaveLength(0);
  });
});
