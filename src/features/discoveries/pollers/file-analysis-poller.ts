import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import type { LLMProvider } from '../../../ai/provider';
import type { Logger } from '../../../utils/logger';
import type { WorkspaceInfo } from '../../../workspace/types';
import type { IntegrationSuggestionDiscovery } from '../types';
import type { DiscoveryStore } from '../store';
import { Poller, DEFAULT_POLL_INTERVAL_MS } from '../poller';

const execAsync = promisify(exec);

const MAX_BATCH_SIZE = 5;
const MAX_FILE_LINES = 500;
const GIT_TIMEOUT_MS = 10_000;

// skip binary, generated, test, and build output — let the LLM handle everything else
const SKIP_PATTERNS: RegExp[] = [
  /\.(png|jpe?g|gif|ico|svg|webp|avif)$/i,
  /\.(woff2?|ttf|eot|otf)$/i,
  /\.(pdf|zip|gz|tar|rar|7z)$/i,
  /\.(mp[34]|wav|avi|mov|webm)$/i,
  /\.(exe|dll|so|dylib)$/i,
  /\.(lock|map)$/i,
  /node_modules\//,
  /dist\//,
  /build\//,
  /\.next\//,
  /coverage\//,
  /\.min\./,
  /\.test\./,
  /\.spec\./,
  /\.stories\./,
  /__tests__\//,
  /\.d\.ts$/,
];

const SuggestionSchema = z.object({
  file: z.string(),
  needs_integration: z.boolean(),
  suggestion_type: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  recommended_actions: z.array(z.string()).optional(),
});

const IntegrationAnalysisSchema = z.object({
  suggestions: z.array(SuggestionSchema),
});

async function execGit(cmd: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(`git ${cmd}`, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
  });
  return stdout.trim();
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execGit('rev-parse --is-inside-work-tree', cwd);
    return true;
  } catch {
    return false;
  }
}

async function getNewFiles(
  cwd: string,
  baselineCommit: string,
): Promise<string[]> {
  const results = new Set<string>();

  try {
    const out = await execGit(
      `diff --name-only --diff-filter=A ${baselineCommit}..HEAD`,
      cwd,
    );
    for (const f of out.split('\n').filter(Boolean)) {
      results.add(f);
    }
  } catch {
    // baseline may be gone after rebase/reset
  }

  try {
    const out = await execGit('diff --name-only --diff-filter=A --cached', cwd);
    for (const f of out.split('\n').filter(Boolean)) {
      results.add(f);
    }
  } catch {
    // ignore
  }

  try {
    const out = await execGit('ls-files --others --exclude-standard', cwd);
    for (const f of out.split('\n').filter(Boolean)) {
      results.add(f);
    }
  } catch {
    // ignore
  }

  return [...results];
}

function isRelevantFile(filePath: string): boolean {
  return !SKIP_PATTERNS.some((p) => p.test(filePath));
}

function hasPostHogInstalled(info: WorkspaceInfo): boolean {
  return !info.setupIssues.some(
    (issue) => issue.checkId === 'posthog_not_integrated',
  );
}

function buildAnalysisPrompt(
  info: WorkspaceInfo,
  files: { path: string; content: string }[],
): string {
  const fileBlocks = files
    .map((f) => {
      const ext = path.extname(f.path).slice(1);
      return `### ${f.path}\n\`\`\`${ext}\n${f.content}\n\`\`\``;
    })
    .join('\n\n');

  const issuesList =
    info.setupIssues.length > 0
      ? info.setupIssues.map((i) => `- ${i.title}`).join('\n')
      : 'None — PostHog is fully configured.';

  return `You are analyzing newly created source files in a codebase that uses PostHog.

## Codebase Context
- Language: ${info.language}
- Frameworks: ${info.frameworks.join(', ') || 'none detected'}
- Summary: ${info.codebaseSummary}

## Current PostHog Setup Issues
${issuesList}

## New Files
${fileBlocks}

For each file, determine if PostHog integration would add value. Consider:
- Does this file handle user interactions that should be tracked (clicks, form submissions, purchases)?
- Is this a page or route that needs pageview tracking?
- Does it handle authentication or user identity changes?
- Could feature flags improve this code (gradual rollout, A/B testing)?
- Does it handle errors that should be captured?

Only suggest integration when it genuinely adds analytical value. Do NOT suggest PostHog for:
- Utility functions, helpers, or pure logic with no user interaction
- Internal configuration or setup files
- Type definitions or constants
- Files that already import or use PostHog

Respond with JSON only, no other text:
{
  "suggestions": [
    {
      "file": "src/components/Checkout.tsx",
      "needs_integration": true,
      "suggestion_type": "event_capture",
      "title": "Track checkout events",
      "description": "This checkout form handles purchases and should track conversion events.",
      "recommended_actions": ["capture checkout_started on form render", "capture purchase_completed on success"]
    },
    {
      "file": "src/utils/format.ts",
      "needs_integration": false
    }
  ]
}`;
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // not raw JSON
  }

  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]!);
    } catch {
      // malformed code block
    }
  }

  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // no valid JSON found
    }
  }

  return undefined;
}

export function createFileAnalysisPoller(
  store: DiscoveryStore,
  logger: Logger,
  workspaceRoot: string,
  getProvider: () => LLMProvider | undefined,
  getWorkspaceInfo: () => WorkspaceInfo | undefined,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): Poller<void> {
  const analyzedFiles = new Set<string>();
  let baselineCommit: string | undefined;

  const poller = new Poller<void>({
    label: 'file-analysis',
    intervalMs,
    logger,
    fetchFn: async () => {
      const provider = getProvider();
      if (!provider) {
        return;
      }

      const workspaceInfo = getWorkspaceInfo();
      if (!workspaceInfo) {
        return;
      }

      if (!hasPostHogInstalled(workspaceInfo)) {
        return;
      }

      if (!(await isGitRepo(workspaceRoot))) {
        return;
      }

      // first poll just records HEAD as the baseline
      if (!baselineCommit) {
        try {
          baselineCommit = await execGit('rev-parse HEAD', workspaceRoot);
        } catch {
          return;
        }
        logger.info('[file-analysis] baseline captured');
        return;
      }

      const allNew = await getNewFiles(workspaceRoot, baselineCommit);
      const candidates = allNew
        .filter((f) => !analyzedFiles.has(f))
        .filter(isRelevantFile);

      if (candidates.length === 0) {
        return;
      }

      const batch = candidates.slice(0, MAX_BATCH_SIZE);

      const fileContents: { path: string; content: string }[] = [];
      for (const filePath of batch) {
        try {
          const fullPath = path.join(workspaceRoot, filePath);
          const raw = await fs.readFile(fullPath, 'utf-8');
          const lines = raw.split('\n');
          if (lines.length > MAX_FILE_LINES) {
            analyzedFiles.add(filePath);
            continue;
          }
          if (raw.trim().length === 0) {
            // empty file — might get content on a later poll
            continue;
          }
          fileContents.push({ path: filePath, content: raw });
        } catch {
          analyzedFiles.add(filePath);
        }
      }

      if (fileContents.length === 0) {
        return;
      }

      const label =
        fileContents.length === 1
          ? '1 new file'
          : `${fileContents.length} new files`;

      const discoveries = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `PostHog: Analyzing ${label} for integration opportunities`,
          cancellable: false,
        },
        async () => {
          const prompt = buildAnalysisPrompt(workspaceInfo, fileContents);

          let response;
          try {
            response = await provider.generate(
              [{ role: 'user', content: prompt }],
              { temperature: 0, maxTokens: 2048 },
            );
          } catch (err) {
            logger.error('[file-analysis] LLM call failed', err);
            return [];
          }

          if (response.type !== 'text') {
            logger.error('[file-analysis] unexpected LLM response type');
            return [];
          }

          const parsed = extractJson(response.content);
          if (!parsed) {
            logger.error('[file-analysis] failed to parse LLM JSON response');
            return [];
          }

          const result = IntegrationAnalysisSchema.safeParse(parsed);
          if (!result.success) {
            logger.error(
              '[file-analysis] invalid LLM response schema',
              result.error,
            );
            return [];
          }

          const now = new Date().toISOString();
          const items: IntegrationSuggestionDiscovery[] = [];

          for (const suggestion of result.data.suggestions) {
            if (
              !suggestion.needs_integration ||
              !suggestion.title ||
              !suggestion.description
            ) {
              continue;
            }

            items.push({
              id: `integration_suggestion:${suggestion.file}`,
              kind: 'integration_suggestion',
              title: suggestion.title,
              description: suggestion.description,
              severity: 'info',
              firstSeen: now,
              lastSeen: now,
              source: {
                file: suggestion.file,
                suggestionType: suggestion.suggestion_type ?? 'general',
                recommendedActions: suggestion.recommended_actions ?? [],
              },
            });
          }

          return items;
        },
      );

      for (const f of fileContents) {
        analyzedFiles.add(f.path);
      }

      if (discoveries.length > 0) {
        const knownIds = new Set(
          store.getByKind('integration_suggestion').map((d) => d.id),
        );
        store.merge(discoveries);

        const newCount = discoveries.filter((d) => !knownIds.has(d.id)).length;
        if (newCount > 0) {
          const noun =
            newCount === 1
              ? 'integration suggestion'
              : 'integration suggestions';
          void vscode.window.showInformationMessage(
            `PostHog: ${newCount} new ${noun} for recent files`,
          );
        }
      }
    },
  });

  return poller;
}
