import * as vscode from 'vscode';
import type { PostHogProject } from '../../auth/schemas';
import type {
  AISelection,
  WorkspaceInfo,
  DetectionStatus,
} from '../../ai/types';
import type { CloudRegion } from '../../auth/constants';
import { CLOUD_URLS } from '../../auth/constants';

type StatusItem = {
  label: string;
  description?: string;
  icon: string;
};

/** Native tree view showing project info, AI config, and workspace status. */
export class StatusProvider implements vscode.TreeDataProvider<StatusItem> {
  static readonly viewType = 'posthog.sidebar';

  private _project: PostHogProject | undefined;
  private _region: CloudRegion | undefined;
  private _aiSelection: AISelection | undefined;
  private _aiModelLabel: string | undefined;
  private _workspaceInfo: WorkspaceInfo | undefined;
  private _detectionStatus: DetectionStatus | undefined;

  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  setProject(project: PostHogProject | undefined, region?: CloudRegion): void {
    this._project = project;
    this._region = region;
    this._onDidChangeTreeData.fire();
  }

  setAISelection(
    selection: AISelection | undefined,
    modelLabel?: string,
  ): void {
    this._aiSelection = selection;
    this._aiModelLabel = modelLabel;
    this._onDidChangeTreeData.fire();
  }

  setWorkspaceDetection(
    status: DetectionStatus | undefined,
    info?: WorkspaceInfo,
  ): void {
    this._detectionStatus = status;
    this._workspaceInfo = info;
    this._onDidChangeTreeData.fire();
  }

  getDashboardUrl(): string | undefined {
    if (!this._project || !this._region) {
      return undefined;
    }
    const baseUrl = CLOUD_URLS[this._region];
    if (!baseUrl) {
      return undefined;
    }
    return `${baseUrl}/project/${this._project.id}`;
  }

  getTreeItem(item: StatusItem): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(item.label);
    treeItem.description = item.description;
    treeItem.iconPath = new vscode.ThemeIcon(item.icon);
    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
    return treeItem;
  }

  getChildren(): StatusItem[] {
    if (!this._project) {
      return [];
    }

    const items: StatusItem[] = [
      {
        label: this._project.name,
        description: this._project.organization,
        icon: 'project',
      },
      {
        label: 'Project ID',
        description: String(this._project.id),
        icon: 'key',
      },
      {
        label: 'Region',
        description: this._region?.toUpperCase() ?? 'Unknown',
        icon: 'globe',
      },
      {
        label: 'AI Model',
        description: this._aiSelection
          ? (this._aiModelLabel ?? this._aiSelection.model)
          : 'Not configured',
        icon: 'sparkle',
      },
      {
        label: 'Workspace',
        description: this._formatWorkspaceSummary(),
        icon: 'code',
      },
      ...this._buildWorkspaceDetails(),
    ];

    return items;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  private _formatWorkspaceSummary(): string {
    switch (this._detectionStatus) {
      case 'running':
        return 'Analyzing\u2026';
      case 'failed':
        return 'Detection failed';
      case 'complete': {
        if (!this._workspaceInfo) {
          return 'Detected';
        }
        const { language, frameworks } = this._workspaceInfo;
        if (frameworks.length === 0) {
          return language;
        }
        return `${language}, ${frameworks.join(', ')}`;
      }
      default:
        return 'Not detected';
    }
  }

  private _buildWorkspaceDetails(): StatusItem[] {
    if (this._detectionStatus !== 'complete' || !this._workspaceInfo) {
      return [];
    }

    const info = this._workspaceInfo;
    const details: StatusItem[] = [
      {
        label: 'Language',
        description: info.language,
        icon: 'symbol-keyword',
      },
    ];

    if (info.frameworks.length > 0) {
      details.push({
        label: 'Frameworks',
        description: info.frameworks.join(', '),
        icon: 'library',
      });
    }

    if (info.packageManager) {
      details.push({
        label: 'Package Mgr',
        description: info.packageManager,
        icon: 'package',
      });
    }

    if (info.buildTools.length > 0) {
      details.push({
        label: 'Build',
        description: info.buildTools.join(', '),
        icon: 'tools',
      });
    }

    if (info.projectStructure) {
      details.push({
        label: 'Structure',
        description: info.projectStructure,
        icon: 'layers',
      });
    }

    return details;
  }
}
