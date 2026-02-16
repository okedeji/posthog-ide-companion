import type { ErrorTrackingIssue } from '../api/schemas';

export type DiscoveryKind = 'error';
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
