import type * as vscode from 'vscode';
import type { WorkspaceInfo } from './types';

const WORKSPACE_INFO_KEY = 'posthog.workspaceInfo';
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export function getStoredWorkspaceInfo(
  context: vscode.ExtensionContext,
): WorkspaceInfo | undefined {
  return context.workspaceState.get<WorkspaceInfo>(WORKSPACE_INFO_KEY);
}

export async function setStoredWorkspaceInfo(
  context: vscode.ExtensionContext,
  info: WorkspaceInfo,
): Promise<void> {
  await context.workspaceState.update(WORKSPACE_INFO_KEY, info);
}

export async function clearStoredWorkspaceInfo(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.workspaceState.update(WORKSPACE_INFO_KEY, undefined);
}

export function isWorkspaceInfoStale(
  info: WorkspaceInfo,
  thresholdMs: number = STALE_THRESHOLD_MS,
): boolean {
  const detectedAt = new Date(info.detectedAt).getTime();
  if (isNaN(detectedAt)) {
    return true;
  }
  return Date.now() - detectedAt > thresholdMs;
}
