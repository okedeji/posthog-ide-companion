import * as vscode from 'vscode';
import type { PostHogApiClient } from '../../../api/client';
import type { Alert } from '../../../api/schemas';
import { AlertListSchema } from '../../../api/schemas';
import type { Logger } from '../../../utils/logger';
import type { AlertDiscovery } from '../types';
import type { DiscoveryStore } from '../store';
import { Poller, DEFAULT_POLL_INTERVAL_MS } from '../poller';

function alertToDiscovery(alert: Alert): AlertDiscovery {
  return {
    id: `firing_alert:${alert.id}`,
    kind: 'firing_alert',
    title: alert.name,
    description: formatDescription(alert.last_checked_at),
    severity: 'critical',
    firstSeen: alert.created_at ?? new Date().toISOString(),
    lastSeen: alert.last_checked_at ?? new Date().toISOString(),
    source: alert,
  };
}

function formatDescription(lastCheckedAt?: string | null): string {
  if (!lastCheckedAt) {
    return 'Firing';
  }
  return `Firing · last checked ${formatRelativeTime(lastCheckedAt)}`;
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

export function createAlertPoller(
  client: PostHogApiClient,
  store: DiscoveryStore,
  logger: Logger,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): Poller<void> {
  return new Poller<void>({
    label: 'alerts',
    intervalMs,
    logger,
    fetchFn: async () => {
      const result = await client.get('/alerts/', AlertListSchema);

      if (!result.ok) {
        logger.error(
          `[alerts] API error (${result.error.code}): ${result.error.message}`,
        );
        return;
      }

      const firing = result.data.results.filter(
        (a) => a.state === 'firing' && a.enabled,
      );
      const discoveries = firing.map(alertToDiscovery);
      const knownIds = new Set(
        store.getByKind('firing_alert').map((d) => d.id),
      );
      store.replaceByKind('firing_alert', discoveries);

      const newCount = discoveries.filter((d) => !knownIds.has(d.id)).length;
      if (newCount > 0) {
        const label = newCount === 1 ? 'alert' : 'alerts';
        void vscode.window.showInformationMessage(
          `PostHog: ${newCount} ${label} firing`,
        );
      }
    },
  });
}
