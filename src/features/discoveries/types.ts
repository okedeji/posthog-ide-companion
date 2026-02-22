import type {
  ErrorTrackingIssue,
  Alert,
  FeatureFlag,
  Experiment,
} from '../../api/schemas';

export type DiscoveryKind =
  | 'error'
  | 'setup_issue'
  | 'firing_alert'
  | 'experiment_result'
  | 'stale_flag'
  | 'flag_rollback'
  | 'integration_suggestion';

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
};

export type SetupIssueDiscovery = Discovery<SetupIssueSource>;

export type AlertDiscovery = Discovery<Alert>;
export type ExperimentDiscovery = Discovery<Experiment>;
export type FlagDiscovery = Discovery<FeatureFlag>;

export type IntegrationSuggestionSource = {
  file: string;
  suggestionType: string;
};

export type IntegrationSuggestionDiscovery =
  Discovery<IntegrationSuggestionSource>;
