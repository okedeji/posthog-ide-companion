import * as vscode from 'vscode';
import type { Discovery } from '../../discoveries/types';
import type { DiscoveryStore } from '../../discoveries/store';

const SEVERITY_ICONS: Record<string, string> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
};

/** Tree view provider for the posthog.discoveries view. */
export class DiscoveriesProvider implements vscode.TreeDataProvider<Discovery> {
  static readonly viewType = 'posthog.discoveries';

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly storeListener: vscode.Disposable;

  constructor(private readonly store: DiscoveryStore) {
    this.storeListener = store.onDidChange(() => {
      this._onDidChangeTreeData.fire();
    });
  }

  getTreeItem(discovery: Discovery): vscode.TreeItem {
    const item = new vscode.TreeItem(discovery.title);
    item.description = discovery.description;
    item.iconPath = new vscode.ThemeIcon(
      SEVERITY_ICONS[discovery.severity] ?? 'circle-outline',
    );
    item.collapsibleState = vscode.TreeItemCollapsibleState.None;
    item.contextValue = discovery.kind;
    return item;
  }

  getChildren(): Discovery[] {
    return this.store.getAll();
  }

  dispose(): void {
    this.storeListener.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
