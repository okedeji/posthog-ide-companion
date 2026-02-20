import type {
  ErrorDiscovery,
  SetupIssueDiscovery,
  SetupIssueSource,
  AlertDiscovery,
  ExperimentDiscovery,
  FlagDiscovery,
} from '../features/discoveries/types';
import type {
  ErrorTrackingIssue,
  Alert,
  FeatureFlag,
  Experiment,
} from '../api/schemas';

// Chat-specific additions to the system prompt. The foundation prompt (priority 0)
// covers core behavior and tool usage guidelines. The tools section (priority 5)
// lists available tools from the registry. This section adds chat workflows.
export const CHAT_INSTRUCTIONS = `## Capabilities

You can help with:

- **Analytics** - query event counts, trends, funnels, retention, and run HogQL
- **Error investigation** - analyze production errors, read source code, propose fixes
- **Feature flags** - create flags in PostHog, add the flag check in code, find references, toggle or update existing ones
- **Experiments** - create A/B experiments in PostHog, wrap the feature in code with variant checks, launch, and conclude
- **Insights and dashboards** - save query results as named charts, create dashboards, and attach insights to them
- **Surveys** - create in-app surveys (popover, widget, or API), configure questions, launch and stop them
- **Codebase** - search, read, and understand the project structure
- **Documentation** - search PostHog docs for integration guides and API reference
- **Setup** - check environment configuration and fix PostHog integration issues

---

### Write requests (create, update, launch, conclude, fix)

Write requests touch both PostHog and the codebase. Always treat them as end-to-end tasks.

**Research first — before planning or acting:**
1. **Search docs** (docs-search) — understand the PostHog concept, API, and SDK patterns involved.
2. **Check PostHog** (entity-search, MCP tools) — find existing flags, experiments, events, and dashboards relevant to the request.
3. **Read the codebase** — find where the feature lives, how existing flags or events are used, what naming patterns are followed.

**Plan and confirm — before executing:**
4. **Lay out the full end-to-end plan** — what will be created or changed in PostHog (flag key, variants, targeting), and what code changes are needed (where the flag check goes, what the if/else branches do, which files change).
5. **Ask the user to confirm** — present the plan clearly and wait for approval before doing anything.

**Execute — after confirmation:**
6. **PostHog first** — use the write tools (createFeatureFlag, createExperiment, etc.) to make the PostHog change. These require user consent and will prompt before running.
7. **Then code** — use proposeEdit to show each code change as a diff. The user reviews and accepts each one.
8. **Report** — summarise what was done: PostHog URL, files changed, what to test next.

---

### Read requests (query, investigate, explain, find)

Read requests need research, not action. Match the tools to the question — do not run through every step on every request.

- **Docs question** ("how does X work?", "what operators can I use?") — docs-search is enough. No need to pull live data or open the codebase.
- **Live data question** ("how many users did X last week?", "is this flag enabled?") — reach for the PostHog MCP tools and answer from the data. Only dig into the codebase if the question is also about how the code works.
- **Code question** ("where is this flag used?", "how is this event captured?") — search the codebase. Pull live PostHog data too if it adds useful context.
- **Investigation** ("why is this error happening?") — use all three: docs for context, PostHog for the live details, codebase to find where it breaks.

Give a specific answer — reference file paths, line numbers, event names, flag keys, and PostHog URLs. Not generic advice.

---

### Always
- Explain briefly what you are doing and why as you use tools.
- Ask when the request is ambiguous — clarify rather than guess.
- Never make code changes without going through proposeEdit so the user can review the diff.`;

export function buildErrorDiscoveryContext(discovery: ErrorDiscovery): string {
  const source = discovery.source as ErrorTrackingIssue;

  const lines: string[] = [
    `## Investigating: ${discovery.title}`,
    '',
    'The user wants help with this production error.',
    '',
  ];

  const details: string[] = [];
  details.push(`Error ID: ${source.id}`);
  if (source.status) {
    details.push(`Status: ${source.status}`);
  }
  if (source.aggregations) {
    details.push(`Occurrences: ${source.aggregations.occurrences}`);
    details.push(`Affected users: ${source.aggregations.users}`);
    details.push(`Sessions: ${source.aggregations.sessions}`);
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
  details.push(`First seen: ${source.first_seen}`);
  details.push(`Last seen: ${source.last_seen}`);

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

  lines.push('### Investigation steps');
  lines.push('');
  lines.push(
    '1. **Search PostHog docs** - use docs-search to look up the error type, ' +
      'the library or SDK involved, and any relevant integration guides. ' +
      'This gives you the PostHog context needed to understand how this error relates to the project.',
  );
  lines.push(
    `2. **Fetch error details from PostHog** - use the PostHog MCP tools to look up this error ` +
      `by its ID (\`${source.id}\`). Get the full error details, stack traces, and any additional ` +
      'context that PostHog has. This is live data — use it.',
  );

  if (source.function || source.library) {
    lines.push(
      '3. **Search the codebase** - find the function or library mentioned above, ' +
        'read the surrounding code, and figure out how it could fail.',
    );
  } else if (errorMessage) {
    lines.push(
      '3. **Search the codebase** - search for the error message text ' +
        'or related error handling patterns to find where this originates.',
    );
  } else {
    lines.push(
      '3. **Gather more context** - ask the user for more details, or search the codebase ' +
        'for related error patterns to narrow things down.',
    );
  }

  lines.push(
    '4. **Explain and fix** - explain the root cause using what you learned from the docs, ' +
      'the PostHog data, and the code, then propose a fix if you have enough context.',
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
    `## Setup Issue: ${discovery.title}`,
    '',
    `Discovery ID: \`${discovery.id}\``,
    '',
    discovery.description,
  ];

  if (source.evidence.length > 0) {
    lines.push('');
    lines.push('Evidence files:');
    for (const file of source.evidence) {
      lines.push(`- ${file}`);
    }
  }

  if (source.remediation) {
    lines.push('');
    lines.push(`Suggested fix: ${source.remediation}`);
  }

  lines.push('');
  lines.push('### Investigation steps');
  lines.push('');
  lines.push(
    '1. **Search PostHog docs** - use docs-search to look up the relevant setup topic, ' +
      'SDK configuration, or integration guide. Understand the correct setup before suggesting changes.',
  );
  lines.push(
    '2. **Read the evidence files** - examine the files listed above to understand ' +
      'the current state of the configuration.',
  );
  lines.push(
    '3. **Explain and fix** - explain what needs to change based on the docs and the code, ' +
      'then propose the fix using proposeEdit.',
  );
  lines.push(
    '4. **Dismiss** - once all fixes have been applied, call dismissDiscovery ' +
      `with id \`${discovery.id}\` to remove it from the discoveries panel.`,
  );

  return lines.join('\n');
}

export function buildAlertDiscoveryContext(discovery: AlertDiscovery): string {
  const source = discovery.source as Alert;

  const lines: string[] = [
    `## Alert Firing: ${discovery.title}`,
    '',
    'This PostHog alert is currently in a FIRING state.',
    '',
  ];

  const details: string[] = [];
  details.push(`Alert ID: ${source.id}`);
  details.push(`State: ${source.state}`);
  if (source.condition) {
    details.push(`Condition type: ${source.condition.type}`);
    if (source.condition.threshold != null) {
      details.push(`Threshold: ${source.condition.threshold}`);
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
  lines.push('### Investigation steps');
  lines.push('');
  lines.push(
    '1. **Check the insight** - use the PostHog MCP tools to look up the insight ' +
      'associated with this alert and understand what metric is being tracked.',
  );
  lines.push(
    '2. **Review recent data** - query the relevant events or trends to understand ' +
      'why the threshold was crossed.',
  );
  lines.push(
    '3. **Search the codebase** - if the alert relates to errors or specific features, ' +
      'search the code for the relevant event names or functions.',
  );
  lines.push(
    '4. **Explain and recommend** - explain what triggered the alert and suggest ' +
      'actions: fix the root cause, adjust the threshold, or snooze the alert.',
  );

  return lines.join('\n');
}

export function buildExperimentDiscoveryContext(
  discovery: ExperimentDiscovery,
): string {
  const source = discovery.source as Experiment;

  const lines: string[] = [
    `## Experiment Result: ${discovery.title}`,
    '',
    'This experiment has reached a conclusion.',
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
  lines.push('### Investigation steps');
  lines.push('');
  lines.push(
    '1. **Review the experiment** - use the PostHog MCP tools to get full experiment ' +
      'details and results data.',
  );
  lines.push(
    `2. **Find flag usage in code** - search the codebase for the feature flag key ` +
      `\`${source.feature_flag_key}\` to understand what the experiment controls.`,
  );
  lines.push(
    '3. **Recommend next steps** - based on the conclusion, suggest whether to ' +
      'ship the winning variant, roll back, or extend the experiment.',
  );

  return lines.join('\n');
}

export function buildFlagDiscoveryContext(discovery: FlagDiscovery): string {
  const source = discovery.source as FeatureFlag;
  const isRollback = discovery.kind === 'flag_rollback';

  const heading = isRollback
    ? `## Flag Rolled Back: ${source.key}`
    : `## Stale Flag: ${source.key}`;

  const intro = isRollback
    ? 'This feature flag was automatically rolled back. This usually means rollback conditions were triggered.'
    : 'This feature flag has been at 100% rollout for over 30 days and may be ready for cleanup.';

  const lines: string[] = [heading, '', intro, ''];

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
  lines.push('### Investigation steps');
  lines.push('');
  lines.push(
    `1. **Find flag usage in code** - search the codebase for \`${source.key}\` ` +
      'to find all places where this flag is checked.',
  );

  if (isRollback) {
    lines.push(
      '2. **Investigate the rollback** - use PostHog MCP tools to check the flag details ' +
        'and understand what rollback conditions were set.',
    );
    lines.push(
      '3. **Check for issues** - look at error tracking and relevant events around the time ' +
        'of the rollback to understand what went wrong.',
    );
    lines.push(
      '4. **Recommend action** - suggest whether to fix the underlying issue and re-enable, ' +
        'or fully revert the feature.',
    );
  } else {
    lines.push(
      '2. **Assess removability** - determine if the flag check can be safely removed ' +
        'by shipping the code path unconditionally.',
    );
    lines.push(
      '3. **Propose cleanup** - if safe, use proposeEdit to remove the flag checks ' +
        'and keep only the enabled code path.',
    );
  }

  return lines.join('\n');
}
