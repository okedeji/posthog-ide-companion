import * as vscode from 'vscode';
import type { PostHogApiClient } from '../../../api/client';
import type { FeatureFlag } from '../../../api/schemas';
import { FeatureFlagListSchema } from '../../../api/schemas';
import type { Logger } from '../../../utils/logger';
import type { FlagDiscovery } from '../types';
import type { DiscoveryStore } from '../store';
import { Poller, DEFAULT_POLL_INTERVAL_MS } from '../poller';

const STALE_THRESHOLD_DAYS = 30;

function isFullRollout(flag: FeatureFlag): boolean {
  const groups = flag.filters?.groups;
  if (!groups || groups.length === 0) {
    return false;
  }
  return groups.every((g) => g.rollout_percentage === 100);
}

function isStale(flag: FeatureFlag): boolean {
  if (!flag.active || flag.deleted) {
    return false;
  }
  if (!isFullRollout(flag)) {
    return false;
  }
  if (!flag.created_at) {
    return false;
  }

  const ageMs = Date.now() - new Date(flag.created_at).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return ageDays >= STALE_THRESHOLD_DAYS;
}

function staleFlagToDiscovery(flag: FeatureFlag): FlagDiscovery {
  return {
    id: `stale_flag:${flag.key}`,
    kind: 'stale_flag',
    title: `Flag "${flag.key}" at 100% for 30+ days`,
    description: `Created ${formatRelativeTime(flag.created_at!)} · consider removing the flag`,
    severity: 'info',
    firstSeen: flag.created_at!,
    lastSeen: new Date().toISOString(),
    source: flag,
  };
}

function rollbackFlagToDiscovery(flag: FeatureFlag): FlagDiscovery {
  return {
    id: `flag_rollback:${flag.key}`,
    kind: 'flag_rollback',
    title: `Flag "${flag.key}" was rolled back`,
    description: 'Automatic rollback triggered',
    severity: 'critical',
    firstSeen: flag.created_at ?? new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    source: flag,
  };
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

export function createFlagPoller(
  client: PostHogApiClient,
  store: DiscoveryStore,
  logger: Logger,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): Poller<void> {
  return new Poller<void>({
    label: 'flags',
    intervalMs,
    logger,
    fetchFn: async () => {
      const result = await client.get(
        '/feature_flags/?active=true',
        FeatureFlagListSchema,
      );

      if (!result.ok) {
        logger.error(
          `[flags] API error (${result.error.code}): ${result.error.message}`,
        );
        return;
      }

      const flags = result.data.results;

      const staleDiscoveries = flags.filter(isStale).map(staleFlagToDiscovery);
      const rollbackDiscoveries = flags
        .filter((f) => f.performed_rollback === true)
        .map(rollbackFlagToDiscovery);

      const knownStaleIds = new Set(
        store.getByKind('stale_flag').map((d) => d.id),
      );
      const knownRollbackIds = new Set(
        store.getByKind('flag_rollback').map((d) => d.id),
      );

      store.replaceByKind('stale_flag', staleDiscoveries);
      store.replaceByKind('flag_rollback', rollbackDiscoveries);

      const newStale = staleDiscoveries.filter(
        (d) => !knownStaleIds.has(d.id),
      ).length;
      const newRollback = rollbackDiscoveries.filter(
        (d) => !knownRollbackIds.has(d.id),
      ).length;
      const totalNew = newStale + newRollback;

      if (totalNew > 0) {
        const label = totalNew === 1 ? 'flag issue' : 'flag issues';
        void vscode.window.showInformationMessage(
          `PostHog: ${totalNew} ${label} detected`,
        );
      }
    },
  });
}
