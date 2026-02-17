import * as vscode from 'vscode';
import type { Discovery, DiscoveryKind } from '../../discoveries/types';
import type { DiscoveryStore } from '../../discoveries/store';

/** View-model node for a group header in the two-level tree. */
type DiscoveryGroup = {
  readonly __type: 'group';
  readonly kind: DiscoveryKind;
  readonly label: string;
  readonly icon: string;
};

/** A tree node is either a group header or a leaf discovery. */
export type DiscoveryTreeNode = DiscoveryGroup | Discovery;

function isGroup(node: DiscoveryTreeNode): node is DiscoveryGroup {
  return '__type' in node && node.__type === 'group';
}

const GROUP_CONFIG: readonly {
  kind: DiscoveryKind;
  label: string;
  icon: string;
}[] = [
  { kind: 'setup_issue', label: 'Setup Issues', icon: 'gear' },
  { kind: 'error', label: 'Errors', icon: 'bug' },
];

const SEVERITY_STYLE: Record<string, { icon: string; color: string }> = {
  critical: { icon: 'error', color: 'testing.iconFailed' },
  warning: { icon: 'warning', color: 'list.warningForeground' },
  info: { icon: 'info', color: 'notificationsInfoIcon.foreground' },
};

/** Two-level tree view provider for the posthog.discoveries view. */
export class DiscoveriesProvider implements vscode.TreeDataProvider<DiscoveryTreeNode> {
  static readonly viewType = 'posthog.discoveries';

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly storeListener: vscode.Disposable;

  constructor(private readonly store: DiscoveryStore) {
    this.storeListener = store.onDidChange(() => {
      this._onDidChangeTreeData.fire();
    });
  }

  getTreeItem(node: DiscoveryTreeNode): vscode.TreeItem {
    if (isGroup(node)) {
      const count = this.store.getByKind(node.kind).length;
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.description = `${count}`;
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.contextValue = `group:${node.kind}`;
      return item;
    }

    const item = new vscode.TreeItem(node.title);
    item.description = node.description;
    const style = SEVERITY_STYLE[node.severity];
    item.iconPath = style
      ? new vscode.ThemeIcon(style.icon, new vscode.ThemeColor(style.color))
      : new vscode.ThemeIcon('circle-outline');
    item.collapsibleState = vscode.TreeItemCollapsibleState.None;
    item.contextValue = node.kind;
    return item;
  }

  getChildren(element?: DiscoveryTreeNode): DiscoveryTreeNode[] {
    // Root level → return non-empty group headers
    if (!element) {
      return GROUP_CONFIG.filter(
        (g) => this.store.getByKind(g.kind).length > 0,
      ).map((g) => ({ __type: 'group' as const, ...g }));
    }

    // Group level → return discoveries of that kind
    if (isGroup(element)) {
      return this.store.getByKind(element.kind);
    }

    // Leaf level → no children
    return [];
  }

  dispose(): void {
    this.storeListener.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
