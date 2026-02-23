import type {
  ErrorDiscovery,
  SetupIssueDiscovery,
  SetupIssueSource,
  AlertDiscovery,
  ExperimentDiscovery,
  FlagDiscovery,
  IntegrationSuggestionDiscovery,
  IntegrationSuggestionSource,
} from '../features/discoveries/types';
import type {
  ErrorTrackingIssue,
  Alert,
  FeatureFlag,
  Experiment,
} from '../api/schemas';

// Chat-specific additions to the system prompt. The foundation prompt (priority 0)
// covers hard rules and tool philosophy. The tools section (priority 5) lists
// available tools from the registry. This section adds chat identity, workflows,
// and PostHog-specific behavioral rules.
export const CHAT_INSTRUCTIONS = `## Identity

You are a PostHog team member helping a developer from inside their IDE. Speak as an insider — use "we", "our", and "us" when referring to PostHog. You know the product deeply and care about getting the developer's integration right.

Note: error status cannot be changed from chat — tell the user to resolve errors in the PostHog web UI after fixing code.

## How to Search Docs

- **Search for the latest approach.** PostHog evolves fast. Include the current date in your query to bias toward the latest docs. Don't settle for any approach that works; find the current recommended way.
- **Be specific.** Include the error message, SDK name, framework, and feature. Search with facts you actually have, not guessed method names.
- **Refine when needed.** If the first result is generic, search again with different terms.

## Handling Requests

### Write requests (create, update, fix, launch, conclude)

Write requests change PostHog state and/or the codebase. Treat them as end-to-end tasks.

**1. Research** — before planning:
- Search docs (\`docs-search\`) for the latest recommended approach. Include the current date.
- Check PostHog (\`entity-search\`, MCP tools) for existing flags, experiments, events, dashboards.
- Read the codebase for where the feature lives, what patterns and naming conventions exist.

**2. Plan** — before executing:
- Present the full plan: what changes in PostHog (flag key, variants, targeting) and what code changes are needed (files and diffs).
- Wait for user confirmation. Do not execute until approved.

**3. Execute** — after confirmation:
- PostHog first: use write tools (\`createFeatureFlag\`, \`createExperiment\`, etc.). These prompt for consent.
- Code second: use \`proposeEdit\` for each file change. The user reviews each diff.
- Report: summarize what was done — PostHog URL, files changed, what to test next.

### Read requests (query, investigate, explain, find)

Match tools to the question type:

| Question | Approach |
|---|---|
| "How does X work?" | \`docs-search\` for the latest docs |
| "How many users did X?" / "Is this flag enabled?" | PostHog MCP tools |
| "Where is this flag used?" / "How is this event captured?" | Search the codebase; pull PostHog data if useful |
| "Why is this error happening?" | All three: docs, PostHog data, codebase |

Give specific answers — file paths, line numbers, event names, flag keys, URLs. Not generic advice.

## Environment Variables

Use \`checkEnvKeys\` and \`setEnvValues\` to check and set env vars directly — don't ask the user to edit env files manually. Pick the right file for the framework (Next.js = \`.env.local\`, Vite = \`.env\`). No secret values are exposed in tool results.`;

export function buildErrorDiscoveryContext(discovery: ErrorDiscovery): string {
  const source = discovery.source as ErrorTrackingIssue;

  const lines: string[] = [
    `## Task: Investigate Production Error`,
    '',
    `**${discovery.title}**`,
    '',
  ];

  const details: string[] = [];
  details.push(`Error ID: \`${source.id}\``);
  if (source.status) {
    details.push(`Status: ${source.status}`);
  }
  if (source.aggregations) {
    details.push(
      `Occurrences: ${source.aggregations.occurrences} | Users: ${source.aggregations.users} | Sessions: ${source.aggregations.sessions}`,
    );
  }
  if (source.library) {
    details.push(`Library: \`${source.library}\``);
  }
  if (source.function) {
    details.push(`Function: \`${source.function}\``);
  }
  if (source.source) {
    details.push(`Source: \`${source.source}\``);
  }
  details.push(
    `First seen: ${source.first_seen} | Last seen: ${source.last_seen}`,
  );

  for (const detail of details) {
    lines.push(`- ${detail}`);
  }

  const errorMessage = source.description ?? source.name;
  if (errorMessage) {
    lines.push('');
    lines.push('Error message:');
    lines.push(`\`\`\`\n${errorMessage}\n\`\`\``);
  }

  const stackTrace = extractStackTrace(source);
  if (stackTrace) {
    lines.push('');
    lines.push('Stack trace:');
    lines.push(`\`\`\`\n${stackTrace}\n\`\`\``);
  }

  lines.push('');
  lines.push('### Steps');
  lines.push('');
  lines.push(
    '1. **Search docs** — call `docs-search` with the error type, library/SDK name, ' +
      'and relevant keywords. Include the current date to get the latest docs. ' +
      'Look for the most current guidance on this error type.',
  );
  lines.push(
    `2. **Fetch error from PostHog** — use the PostHog MCP tools to look up error ID ` +
      `\`${source.id}\`. Get the full error details, recent stack traces, and event properties.`,
  );

  if (source.function || source.library) {
    lines.push(
      '3. **Search the codebase** — find the function or library mentioned above, ' +
        'read the surrounding code, and determine how it could fail.',
    );
  } else if (errorMessage) {
    lines.push(
      '3. **Search the codebase** — search for the error message text ' +
        'or related error handling patterns to find where this originates.',
    );
  } else {
    lines.push(
      '3. **Gather more context** — ask the user for more details, or search the codebase ' +
        'for related error patterns to narrow things down.',
    );
  }

  lines.push(
    '4. **Explain and fix** — synthesize what you learned from docs, PostHog data, and code. ' +
      'Explain the root cause, then propose a fix with `proposeEdit` if you have enough context.',
  );

  return lines.join('\n');
}

function extractStackTrace(source: ErrorTrackingIssue): string | undefined {
  const event = source.last_event ?? source.first_event;
  if (!event?.properties) {
    return undefined;
  }

  try {
    const props = JSON.parse(event.properties) as Record<string, unknown>;

    const exceptionList = props['$exception_list'] as
      | Array<{
          type?: string;
          value?: string;
          stacktrace?: {
            frames?: Array<{
              filename?: string;
              lineno?: number;
              colno?: number;
              function?: string;
            }>;
          };
        }>
      | undefined;

    if (!exceptionList?.length) {
      return undefined;
    }

    const parts: string[] = [];
    for (const exception of exceptionList) {
      if (exception.type || exception.value) {
        parts.push(`${exception.type ?? 'Error'}: ${exception.value ?? ''}`);
      }

      const frames = exception.stacktrace?.frames;
      if (frames?.length) {
        for (const frame of frames.slice(-10)) {
          const loc = [frame.filename, frame.lineno, frame.colno]
            .filter(Boolean)
            .join(':');
          parts.push(`  at ${frame.function ?? '<anonymous>'} (${loc})`);
        }
      }
    }

    return parts.length > 0 ? parts.join('\n') : undefined;
  } catch {
    return undefined;
  }
}

export function buildSetupIssueDiscoveryContext(
  discovery: SetupIssueDiscovery,
): string {
  const source = discovery.source as SetupIssueSource;

  const lines: string[] = [
    `## Task: Fix Setup Issue`,
    '',
    `**${discovery.title}**`,
    '',
    `Discovery ID: \`${discovery.id}\``,
    '',
    discovery.description,
  ];

  if (source.evidence.length > 0) {
    lines.push('');
    lines.push('Evidence:');
    for (const file of source.evidence) {
      lines.push(`- ${file}`);
    }
  }

  lines.push('');
  lines.push('### Steps');
  lines.push('');
  lines.push(
    '1. **Search docs** — call `docs-search` for the relevant setup topic and SDK configuration. ' +
      'Include the current date to get the latest recommended setup approach.',
  );
  lines.push(
    '2. **Read the evidence files** — examine the files listed above to understand ' +
      'the current state of the configuration.',
  );
  lines.push(
    '3. **Explain and fix** — explain what needs to change based on the latest docs and the code, ' +
      'then propose the fix using `proposeEdit`.',
  );
  lines.push(
    `4. **Dismiss** — once all fixes are applied and accepted, call \`dismissDiscovery\` ` +
      `with id \`${discovery.id}\` to remove it from the discoveries panel.`,
  );

  return lines.join('\n');
}

export function buildAlertDiscoveryContext(discovery: AlertDiscovery): string {
  const source = discovery.source as Alert;

  const lines: string[] = [
    `## Task: Investigate Firing Alert`,
    '',
    `**${discovery.title}**`,
    '',
  ];

  const details: string[] = [];
  details.push(`Alert ID: ${source.id}`);
  details.push(`State: ${source.state}`);
  if (source.condition) {
    details.push(`Condition: ${source.condition.type}`);
  }
  if (source.threshold?.configuration?.bounds) {
    const bounds = source.threshold.configuration.bounds;
    if (bounds.upper != null) {
      details.push(`Upper threshold: ${bounds.upper}`);
    }
    if (bounds.lower != null) {
      details.push(`Lower threshold: ${bounds.lower}`);
    }
  }
  if (source.last_checked_at) {
    details.push(`Last checked: ${source.last_checked_at}`);
  }
  if (source.last_notified_at) {
    details.push(`Last notified: ${source.last_notified_at}`);
  }

  for (const detail of details) {
    lines.push(`- ${detail}`);
  }

  lines.push('');
  lines.push('### Steps');
  lines.push('');
  lines.push(
    '1. **Check the insight** — use the PostHog MCP tools to look up the insight ' +
      'associated with this alert and understand what metric is being tracked.',
  );
  lines.push(
    '2. **Review recent data** — query the relevant events or trends to understand ' +
      'why the threshold was crossed.',
  );
  lines.push(
    '3. **Search the codebase** — if the alert relates to errors or specific features, ' +
      'search the code for the relevant event names or functions.',
  );
  lines.push(
    '4. **Explain and recommend** — explain what triggered the alert and suggest ' +
      'next steps: fix the root cause, adjust the threshold, or snooze the alert.',
  );
  lines.push(
    `5. **Resolve** — once addressed, use \`updateAlert\` to disable or snooze the alert ` +
      `(ID: ${source.id}), or \`deleteAlert\` to remove it. This clears it from the discoveries panel.`,
  );

  return lines.join('\n');
}

export function buildExperimentDiscoveryContext(
  discovery: ExperimentDiscovery,
): string {
  const source = discovery.source as Experiment;

  const lines: string[] = [
    `## Task: Review Experiment Result`,
    '',
    `**${discovery.title}**`,
    '',
  ];

  const details: string[] = [];
  details.push(`Experiment ID: ${source.id}`);
  details.push(`Feature flag key: \`${source.feature_flag_key}\``);
  if (source.start_date) {
    details.push(`Started: ${source.start_date}`);
  }
  if (source.end_date) {
    details.push(`Ended: ${source.end_date}`);
  }
  if (source.conclusion) {
    details.push(`Conclusion: ${source.conclusion}`);
  }
  if (source.conclusion_comment) {
    details.push(`Comment: ${source.conclusion_comment}`);
  }

  const variants = source.parameters?.feature_flag_variants;
  if (variants?.length) {
    details.push(
      `Variants: ${variants.map((v) => `${v.key} (${v.rollout_percentage}%)`).join(', ')}`,
    );
  }

  for (const detail of details) {
    lines.push(`- ${detail}`);
  }

  lines.push('');
  lines.push('### Steps');
  lines.push('');
  lines.push(
    '1. **Review the experiment** — use the PostHog MCP tools to get full experiment ' +
      'details, including statistical significance and results per variant.',
  );
  lines.push(
    `2. **Find flag usage in code** — search the codebase for \`${source.feature_flag_key}\` ` +
      'to understand what the experiment controls and which code paths are affected.',
  );
  lines.push(
    '3. **Search docs** — call `docs-search` for the latest best practices on concluding experiments ' +
      'and shipping variants. Include the current date in your query.',
  );
  lines.push(
    '4. **Recommend next steps** — based on the results, conclusion, and current best practices, suggest whether to ' +
      'ship the winning variant, roll back, or extend the experiment.',
  );
  lines.push(
    `5. **Resolve** — after shipping or rolling back, use \`updateExperiment\` to conclude the ` +
      `experiment (ID: ${source.id}). This clears it from the discoveries panel.`,
  );

  return lines.join('\n');
}

export function buildFlagDiscoveryContext(discovery: FlagDiscovery): string {
  const source = discovery.source as FeatureFlag;
  const isRollback = discovery.kind === 'flag_rollback';

  const heading = isRollback
    ? `## Task: Investigate Flag Rollback`
    : `## Task: Clean Up Stale Flag`;

  const subtitle = isRollback
    ? `**Flag \`${source.key}\` was automatically rolled back**`
    : `**Flag \`${source.key}\` has been at 100% rollout for over 30 days**`;

  const intro = isRollback
    ? 'Rollback conditions were triggered. Investigate what went wrong.'
    : 'This flag may be ready for cleanup — the code path can likely be shipped unconditionally.';

  const lines: string[] = [heading, '', subtitle, '', intro, ''];

  const details: string[] = [];
  details.push(`Flag ID: ${source.id}`);
  details.push(`Key: \`${source.key}\``);
  if (source.name) {
    details.push(`Name: ${source.name}`);
  }
  details.push(`Active: ${source.active}`);
  if (source.created_at) {
    details.push(`Created: ${source.created_at}`);
  }
  if (source.tags?.length) {
    details.push(`Tags: ${source.tags.join(', ')}`);
  }

  for (const detail of details) {
    lines.push(`- ${detail}`);
  }

  lines.push('');
  lines.push('### Steps');
  lines.push('');
  lines.push(
    `1. **Find flag usage in code** — search the codebase for \`${source.key}\` ` +
      'to find all places where this flag is checked.',
  );

  if (isRollback) {
    lines.push(
      '2. **Investigate the rollback** — use PostHog MCP tools to check the flag details ' +
        'and understand what rollback conditions were set.',
    );
    lines.push(
      '3. **Check for issues** — look at error tracking and relevant events around the time ' +
        'of the rollback to understand what went wrong.',
    );
    lines.push(
      '4. **Search docs** — call `docs-search` for the latest guidance on feature flag rollbacks ' +
        'and recovery. Include the current date in your query.',
    );
    lines.push(
      '5. **Recommend action** — suggest whether to fix the underlying issue and re-enable, ' +
        'or fully revert the feature.',
    );
    lines.push(
      `6. **Resolve** — once reverted or fixed, use \`updateFeatureFlag\` to deactivate the flag ` +
        `(ID: ${source.id}). This clears it from the discoveries panel.`,
    );
  } else {
    lines.push(
      '2. **Assess removability** — determine if the flag check can be safely removed ' +
        'by shipping the code path unconditionally.',
    );
    lines.push(
      '3. **Search docs** — call `docs-search` for the latest guidance on cleaning up feature flags. ' +
        'Include the current date in your query.',
    );
    lines.push(
      '4. **Propose cleanup** — if safe, use `proposeEdit` to remove the flag checks ' +
        'and keep only the enabled code path.',
    );
    lines.push(
      `5. **Resolve** — after cleanup, use \`updateFeatureFlag\` to deactivate the flag ` +
        `(ID: ${source.id}). This clears it from the discoveries panel.`,
    );
  }

  return lines.join('\n');
}

export function buildIntegrationSuggestionContext(
  discovery: IntegrationSuggestionDiscovery,
): string {
  const source = discovery.source as IntegrationSuggestionSource;

  const lines: string[] = [
    `## Task: Add PostHog Integration`,
    '',
    `**${discovery.title}**`,
    '',
    discovery.description,
    '',
    `- File: \`${source.file}\``,
    `- Type: ${source.suggestionType}`,
  ];

  lines.push('');
  lines.push('### Steps');
  lines.push('');
  lines.push(
    `1. **Read the file** — open \`${source.file}\` and understand its purpose ` +
      'and how users interact with it.',
  );
  lines.push(
    '2. **Check existing patterns** — search the codebase for how PostHog is used ' +
      'in similar files to keep the integration consistent.',
  );
  lines.push(
    '3. **Search docs** — call `docs-search` for the latest recommended integration pattern ' +
      'for this type of file. Include the current date to get up-to-date guidance.',
  );
  lines.push(
    '4. **Propose changes** — use `proposeEdit` to add the PostHog integration, ' +
      'following both the latest docs and the patterns already established in the codebase.',
  );
  lines.push(
    `5. **Dismiss** — once the integration is applied and accepted, call \`dismissDiscovery\` ` +
      `with id \`${discovery.id}\` to remove it from the discoveries panel.`,
  );

  return lines.join('\n');
}
