import * as vscode from 'vscode';
import type { PostHogApiClient } from '../../../api/client';
import type { ErrorTrackingIssue } from '../../../api/schemas';
import { ErrorTrackingQueryResponseSchema } from '../../../api/schemas';
import type { Logger } from '../../../utils/logger';
import type { ErrorDiscovery, DiscoverySeverity } from '../types';
import type { DiscoveryStore } from '../store';
import { Poller, DEFAULT_POLL_INTERVAL_MS } from '../poller';

const LOOKBACK_DAYS = 7;

function buildErrorTrackingQuery(): Record<string, unknown> {
  const now = new Date();
  const lookback = new Date(
    now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );

  return {
    kind: 'ErrorTrackingQuery',
    dateRange: {
      date_from: lookback.toISOString(),
      date_to: now.toISOString(),
    },
    orderBy: 'last_seen',
    volumeResolution: 0,
    status: 'active',
    limit: 50,
  };
}

function issueToDiscovery(issue: ErrorTrackingIssue): ErrorDiscovery {
  const occurrences = issue.aggregations?.occurrences ?? 0;
  const title =
    issue.description ?? issue.name ?? `Error ${issue.id.slice(0, 8)}`;

  return {
    id: `error:${issue.id}`,
    kind: 'error',
    title,
    description: formatDescription(occurrences, issue.last_seen),
    severity: classifySeverity(occurrences),
    firstSeen: issue.first_seen,
    lastSeen: issue.last_seen,
    source: issue,
  };
}

function classifySeverity(occurrences: number): DiscoverySeverity {
  if (occurrences >= 100) {
    return 'critical';
  }
  if (occurrences >= 10) {
    return 'warning';
  }
  return 'info';
}

function formatDescription(occurrences: number, lastSeen: string): string {
  const ago = formatRelativeTime(lastSeen);
  return `${occurrences}× · ${ago}`;
}

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function createErrorPoller(
  client: PostHogApiClient,
  store: DiscoveryStore,
  logger: Logger,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): Poller<void> {
  const poller = new Poller<void>({
    label: 'errors',
    intervalMs,
    logger,
    fetchFn: async () => {
      const result = await client.post(
        '/query/',
        { query: buildErrorTrackingQuery() },
        ErrorTrackingQueryResponseSchema,
      );

      if (!result.ok) {
        logger.error(
          `[errors] API error (${result.error.code}): ${result.error.message}`,
        );
        return;
      }

      const discoveries = result.data.results.map(issueToDiscovery);
      const newCount = store.merge(discoveries);

      if (newCount > 0) {
        const label = newCount === 1 ? 'error' : 'errors';
        void vscode.window.showInformationMessage(
          `PostHog: ${newCount} new ${label} detected`,
        );
      }
    },
  });

  return poller;
}
