import * as vscode from 'vscode';
import type { PostHogApiClient } from '../../../api/client';
import type { Experiment } from '../../../api/schemas';
import { ExperimentListSchema } from '../../../api/schemas';
import type { Logger } from '../../../utils/logger';
import type { ExperimentDiscovery } from '../types';
import type { DiscoveryStore } from '../store';
import { Poller, DEFAULT_POLL_INTERVAL_MS } from '../poller';

const MAX_CONCLUSION_LENGTH = 80;

function experimentToDiscovery(experiment: Experiment): ExperimentDiscovery {
  const conclusion = truncate(
    experiment.conclusion ?? '',
    MAX_CONCLUSION_LENGTH,
  );
  const ended = experiment.end_date
    ? ` · ended ${formatRelativeTime(experiment.end_date)}`
    : '';

  return {
    id: `experiment_result:${experiment.id}`,
    kind: 'experiment_result',
    title: experiment.name,
    description: `${conclusion}${ended}`,
    severity: 'info',
    firstSeen: experiment.created_at ?? new Date().toISOString(),
    lastSeen: experiment.end_date ?? new Date().toISOString(),
    source: experiment,
  };
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + '…';
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

export function createExperimentPoller(
  client: PostHogApiClient,
  store: DiscoveryStore,
  logger: Logger,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): Poller<void> {
  return new Poller<void>({
    label: 'experiments',
    intervalMs,
    logger,
    fetchFn: async () => {
      const result = await client.get('/experiments/', ExperimentListSchema);

      if (!result.ok) {
        logger.error(
          `[experiments] API error (${result.error.code}): ${result.error.message}`,
        );
        return;
      }

      const concluded = result.data.results.filter(
        (e) => e.conclusion != null && !e.archived,
      );
      const discoveries = concluded.map(experimentToDiscovery);
      const knownIds = new Set(
        store.getByKind('experiment_result').map((d) => d.id),
      );
      store.replaceByKind('experiment_result', discoveries);

      const newCount = discoveries.filter((d) => !knownIds.has(d.id)).length;
      if (newCount > 0) {
        const label = newCount === 1 ? 'experiment has' : 'experiments have';
        void vscode.window.showInformationMessage(
          `PostHog: ${newCount} ${label} results`,
        );
      }
    },
  });
}
