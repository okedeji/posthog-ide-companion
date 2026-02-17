import type { ErrorTrackingIssue } from '../../api/schemas';

export type DiscoveryKind = 'error' | 'setup_issue';
// Future: | 'flag_alert' | 'anomaly'

export type DiscoverySeverity = 'info' | 'warning' | 'critical';

export type Discovery<T = unknown> = {
  id: string;
  kind: DiscoveryKind;
  title: string;
  description: string;
  severity: DiscoverySeverity;
  firstSeen: string;
  lastSeen: string;
  source: T;
};

export type ErrorDiscovery = Discovery<ErrorTrackingIssue>;

export type SetupIssueSource = {
  checkId: string;
  evidence: string[];
  remediation: string;
};

export type SetupIssueDiscovery = Discovery<SetupIssueSource>;
