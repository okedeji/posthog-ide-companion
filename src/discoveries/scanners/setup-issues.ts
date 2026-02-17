import type { SetupIssue } from '../../ai/types';
import type { SetupIssueDiscovery } from '../types';

/**
 * Converts workspace detection setup issues into discoveries
 * that can be merged into the discovery store.
 */
export function workspaceInfoToSetupDiscoveries(
  issues: SetupIssue[],
): SetupIssueDiscovery[] {
  const now = new Date().toISOString();

  return issues.map((issue) => ({
    id: `setup_issue:${issue.checkId}`,
    kind: 'setup_issue' as const,
    title: issue.title,
    description: issue.description,
    severity: 'warning' as const,
    firstSeen: now,
    lastSeen: now,
    source: {
      checkId: issue.checkId,
      evidence: issue.evidence,
      remediation: issue.remediation,
    },
  }));
}
