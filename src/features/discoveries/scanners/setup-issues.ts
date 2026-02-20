import type { SetupIssue } from '../../../workspace/types';
import type { DiscoverySeverity, SetupIssueDiscovery } from '../types';

const INFO_CHECK_IDS: ReadonlySet<string> = new Set([
  'no_custom_events',
  'no_feature_flags',
]);

function getSeverity(checkId: string): DiscoverySeverity {
  return INFO_CHECK_IDS.has(checkId) ? 'info' : 'warning';
}

export function workspaceInfoToSetupDiscoveries(
  issues: SetupIssue[],
): SetupIssueDiscovery[] {
  const now = new Date().toISOString();

  return issues.map((issue) => ({
    id: `setup_issue:${issue.checkId}`,
    kind: 'setup_issue' as const,
    title: issue.title,
    description: issue.description,
    severity: getSeverity(issue.checkId),
    firstSeen: now,
    lastSeen: now,
    source: {
      checkId: issue.checkId,
      evidence: issue.evidence,
      remediation: issue.remediation,
    },
  }));
}
