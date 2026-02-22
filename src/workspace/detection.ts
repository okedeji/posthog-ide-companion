import { z } from 'zod';
import { runAgentLoop } from '../ai/agent';
import { createSystemPromptBuilder } from '../ai/prompts';
import { createToolRegistry } from '../ai/tools/registry';
import { ReadFileTool } from '../ai/tools/read-file';
import { ListDirectoryTool } from '../ai/tools/list-directory';
import { SearchCodeTool } from '../ai/tools/search-code';
import { CheckEnvKeysTool } from '../ai/tools/check-env-keys';
import type { LLMProvider } from '../ai/provider';
import type { AgentEventCallback } from '../ai/types';
import type { SetupIssue, WorkspaceInfo } from './types';

const PROJECT_STRUCTURE = z.enum([
  'monorepo',
  'single-package',
  'multi-package',
  'unknown',
]);

const SetupIssueSchema = z.object({
  checkId: z.string(),
  title: z.string(),
  description: z.string(),
  evidence: z.array(z.string()),
}) satisfies z.ZodType<SetupIssue>;

// z.coerce.string() on frameworkDetails because LLMs love returning booleans/numbers there
export const WorkspaceInfoSchema = z.object({
  language: z.string(),
  frameworks: z.array(z.string()),
  frameworkVersions: z.record(z.string(), z.string()),
  frameworkDetails: z.record(
    z.string(),
    z.record(z.string(), z.coerce.string()),
  ),
  packageManager: z.string().nullable(),
  testFrameworks: z.array(z.string()),
  buildTools: z.array(z.string()),
  projectStructure: PROJECT_STRUCTURE,
  notablePatterns: z.array(z.string()),
  codebaseSummary: z.string().optional().default(''),
  setupIssues: z.array(SetupIssueSchema).optional().default([]),
});

const DETECTION_INSTRUCTIONS = `## Detection Task

Explore this project to produce structured JSON describing it and detect PostHog setup issues.

### Part 1: Workspace Analysis

1. List the root directory to see what files and folders exist.
2. Read config files to identify the language, framework, and tooling:
   - package.json, tsconfig.json, next.config.*, vite.config.*, nuxt.config.*
   - pyproject.toml, setup.py, requirements.txt, Pipfile
   - Cargo.toml, go.mod, build.gradle, pom.xml, Gemfile
   - Any other config files you find in the root
3. Check for monorepo markers: pnpm-workspace.yaml, lerna.json, nx.json, turbo.json, packages/ or apps/ directories.
4. Check for test and build config: jest.config.*, vitest.config.*, pytest.ini, .babelrc, webpack.config.*, esbuild.*, rollup.config.*.
5. Identify framework-specific details: For example, if Next.js is detected, check for app/ directory (App Router) vs pages/ directory (Pages Router). For Django, check for settings modules. For React, check if it uses class components vs hooks.
6. **Understand what this project does.** Go beyond config files — browse the main source directories, read key entry points (e.g. pages, routes, main modules), and understand the project's purpose, who it serves, and the core business logic. Write a concise summary for the \`codebaseSummary\` field. This context is critical for the AI assistant that will later help fix issues in this codebase.

### Part 2: PostHog Setup Issue Detection

After analyzing the workspace, check for PostHog integration problems. Add entries to the \`setupIssues\` array ONLY for problems you find. Empty array = everything looks good (or PostHog is not relevant to this project).

#### Check 1: PostHog Integration (\`checkId: "posthog_not_integrated"\`)

Search dependency files for any PostHog SDK package. Known packages by ecosystem:

- **JS/TS**: \`posthog-js\`, \`posthog-node\`, \`posthog-react-native\`, \`@posthog/nextjs\` (in package.json)
- **Python**: \`posthog\` (in requirements.txt, pyproject.toml, Pipfile, setup.py)
- **Ruby**: \`posthog-ruby\`, \`posthog-rails\` (in Gemfile)
- **Go**: \`posthog/posthog-go\` (in go.mod)
- **PHP**: \`posthog/posthog-php\` (in composer.json)
- **Java/Kotlin**: \`com.posthog\` (in pom.xml, build.gradle)
- **.NET**: \`PostHog\` (in *.csproj)
- **Rust**: \`posthog-rs\` (in Cargo.toml)
- **Flutter/Dart**: \`posthog_flutter\` (in pubspec.yaml)
- **iOS**: \`posthog-ios\` (in Package.swift, Podfile)
- **Android**: \`com.posthog\` (in build.gradle)
- **Elixir**: \`posthog\` (in mix.exs)

Also search source code for direct HTTP API usage: URLs containing \`posthog.com/capture\`, \`i.posthog.com\`, or init patterns like \`posthog.init\`, \`PostHog(\`, \`POSTHOG_API_KEY\`.

If NOTHING is found, add this issue. If PostHog is found via any method (SDK or HTTP), skip this check.

#### Check 2: Error Tracking (\`checkId: "error_capture_not_configured"\`)

Only run if PostHog integration was found (Check 1 passed). Search the codebase for any evidence that PostHog error/exception capture is configured. This varies by SDK and integration method - look broadly for patterns like:
- Error capture config flags (e.g. \`captureExceptions\`, \`enableExceptionAutocapture\`, \`auto_capture_exceptions\`, \`capture_exceptions\`)
- Manual exception capture calls (e.g. \`captureException\`, \`capture_exception\`)
- PostHog error tracking middleware or handler setup
- Instrumentation files (e.g. \`instrumentation.ts\`) with PostHog error config

Do NOT assume any SDK auto-enables error capture - all SDKs require explicit configuration. If PostHog is integrated but you find no evidence of error capture being configured, add this issue.

#### Check 3: Source Maps (\`checkId: "source_maps_not_configured"\`)

Only run if PostHog integration was found AND the project uses JS/TS with a bundler (webpack, vite, esbuild, Next.js, Rollup, etc.). PostHog currently only supports JavaScript source map uploads - this check does not apply to other languages.

Look for any source map upload tooling:
- \`@posthog/cli\` or \`posthog-cli\` in package.json
- \`PostHog/upload-source-maps\` in .github/workflows/*.yml
- \`@posthog/nextjs-config\` with \`withPostHogConfig\` in next.config.*
- Any CI/build script that uploads source maps to PostHog

If the project bundles JS/TS with PostHog but has no source map upload configured, add this issue.

#### Check 4: User Identification (\`checkId: "no_user_identification"\`)

Only run if PostHog integration was found (Check 1 passed). Search the codebase for identify() calls that link anonymous activity to a known user. Patterns vary by SDK:

- **JS/TS**: \`posthog.identify(\` or via \`usePostHog\` hook followed by \`.identify(\`
- **Python**: \`posthog.identify(\`
- **Ruby**: \`posthog.identify(\` or \`PostHog.identify(\`
- **Go**: \`posthog.Identify{\`
- **Node.js**: \`posthog.identify(\` or \`client.identify(\`
- **iOS**: \`PostHogSDK.shared.identify(\`
- **Android**: \`PostHog.identify(\` or \`postHog.identify(\`
- **React Native**: \`posthog.identify(\`
- **Flutter**: \`Posthog().identify(\` or \`.identify(userId:\`

If NO identify calls are found anywhere in the source code, add this issue. Include evidence of which SDK is installed and that no identify patterns matched.

#### Check 5: Custom Events (\`checkId: "no_custom_events"\`)

Only run if PostHog integration was found (Check 1 passed). Search for custom event capture calls beyond auto-captured events. Known patterns:

- **JS/TS**: \`posthog.capture(\`
- **Python**: \`posthog.capture(\`
- **Ruby**: \`posthog.capture(\`
- **Go**: \`posthog.Capture{\` or \`client.Enqueue(posthog.Capture\`
- **Node.js**: \`posthog.capture(\` or \`client.capture(\`
- **iOS**: \`PostHogSDK.shared.capture(\`
- **Android**: \`PostHog.capture(\` or \`postHog.capture(\`
- **React Native**: \`posthog.capture(\`
- **Flutter**: \`Posthog().capture(\` or \`.capture(eventName:\`

Exclude auto-events: calls that capture \`$pageview\`, \`$pageleave\`, \`$autocapture\`, or \`$screen\` do NOT count as custom events. Only count capture calls with custom event names (strings not starting with \`$\`).

If NO custom capture calls (with non-auto event names) are found, add this issue. This is an INFORMATIONAL check — use a suggestive tone (e.g. "No custom events tracked") rather than a warning tone. Custom events are a recommendation for richer analytics, not a requirement.

#### Check 6: Debug Mode (\`checkId: "debug_mode_enabled"\`)

Only run if PostHog integration was found (Check 1 passed). Look for unconditional/hardcoded debug mode that would affect production. Patterns by SDK:

- **JS/TS**: \`debug: true\` in posthog.init options, \`posthog.debug()\`, or \`posthog.debug(true)\` — without a surrounding conditional
- **Python**: \`posthog.debug = True\` or \`debug=True\` in the client constructor — without a conditional guard
- **Go**: \`Verbose: true\` in the PostHog config struct
- **Ruby**: \`.logger.level = Logger::DEBUG\`
- **iOS/Android/Flutter**: \`config.debug = true\` or \`debug = true\` in PostHog configuration
- **Node.js**: \`client.debug()\` or \`client.debug(true)\` — without a conditional guard

IMPORTANT: Do NOT flag conditional/environment-aware patterns. These are safe and should be ignored:
- \`debug: __DEV__\`, \`debug: process.env.NODE_ENV !== 'production'\`
- \`debug = BuildConfig.DEBUG\`, \`debug: import.meta.env.DEV\`
- Any pattern wrapped in \`if (isDevelopment)\`, \`if __debug__:\`, or similar conditionals

Read the surrounding code context (a few lines before and after) to determine whether a debug setting is conditional. If you find an UNCONDITIONAL hardcoded debug mode in PostHog configuration, add this issue. Include the file path and line content as evidence.

#### Check 7: SPA Pageview Tracking (\`checkId: "spa_pageview_not_configured"\`)

Only run if PostHog integration was found AND the project is a web-based Single Page Application (SPA). SPA frameworks include: React (CRA, Vite), Next.js, Vue, Nuxt, Angular, Svelte, SvelteKit, Remix, Astro (with client-side routing). If the project is NOT a web SPA (e.g. a Python API, a mobile app, a CLI tool), skip this check entirely.

In SPAs, the default \`capture_pageview: true\` only fires on initial full page load, missing client-side route changes. Check for EITHER of these correct configurations:

- **Modern (recommended)**: \`capture_pageview: 'history_change'\` in posthog.init options, OR \`defaults: '2025-05-24'\` (or any later date string) which enables history_change mode automatically
- **Legacy (manual)**: \`capture_pageview: false\` in posthog.init options combined with manual \`posthog.capture('$pageview')\` calls in a router hook or route-change handler (e.g. \`routeChangeComplete\`, \`afterEach\`, \`NavigationEnd\`, \`afterNavigate\`, \`useEffect\` with pathname dependency)

If posthog.init is found but uses the default \`capture_pageview: true\` (or omits the setting entirely) AND there is no manual pageview tracking on route changes, add this issue.

Do NOT flag this issue for:
- Non-web projects (Python, Go, Ruby, mobile SDKs, etc.)
- Multi-page applications (traditional server-rendered apps without client-side routing)
- Projects already using \`capture_pageview: 'history_change'\` or a \`defaults\` date >= \`'2025-05-24'\`
- Projects using \`capture_pageview: false\` with manual pageview capture on route change

#### Check 8: Feature Flags (\`checkId: "no_feature_flags"\`)

Only run if PostHog integration was found (Check 1 passed). This is an INFORMATIONAL check — not a problem, just a helpful suggestion. Search for feature flag usage in the codebase:

- **JS/TS**: \`isFeatureEnabled(\`, \`getFeatureFlag(\`, \`useFeatureFlagEnabled(\`, \`useFeatureFlagPayload(\`, \`useActiveFeatureFlags(\`, \`PostHogFeature\`, \`getFeatureFlagResult(\`
- **Python**: \`feature_enabled(\`, \`get_feature_flag(\`, \`get_all_flags(\`
- **Ruby**: \`is_feature_enabled(\`, \`get_feature_flag(\`
- **Go**: \`IsFeatureEnabled(\`, \`GetFeatureFlag(\`, \`GetFeatureFlagResult(\`
- **Node.js**: \`isFeatureEnabled(\`, \`getFeatureFlag(\`, \`getAllFlags(\`
- **iOS/Android**: \`isFeatureEnabled(\`, \`getFeatureFlag(\`, \`getFeatureFlagResult(\`
- **Flutter**: \`isFeatureEnabled(\`, \`getFeatureFlag(\`, \`getFeatureFlagResult(\`

If NO feature flag usage is found, add this issue. Use a suggestive tone for the title (e.g. "Feature flags not used yet") and description — this is a recommendation, not a warning about something broken.

### Output Schema

Return ONLY a JSON object matching this exact schema:

\`\`\`json
{
  "language": "typescript",
  "frameworks": ["next.js", "tailwind"],
  "frameworkVersions": { "next.js": "14.2.0", "tailwind": "3.4.1" },
  "frameworkDetails": {
    "next.js": { "router": "app", "srcDir": "true" }
  },
  "packageManager": "pnpm",
  "testFrameworks": ["jest"],
  "buildTools": ["tsc", "esbuild"],
  "projectStructure": "single-package",
  "notablePatterns": ["uses barrel exports", "monorepo with shared packages"],
  "codebaseSummary": "An e-commerce platform built with Next.js that sells handmade crafts. Users can browse products, add to cart, and checkout via Stripe. The admin dashboard at /admin manages inventory and orders. PostHog is used for product analytics and A/B testing checkout flows.",
  "setupIssues": [
    {
      "checkId": "source_maps_not_configured",
      "title": "Source maps not uploaded to PostHog",
      "description": "This Next.js project uses posthog-js but has no source map upload configured. Production error stack traces will show minified code.",
      "evidence": ["posthog-js found in package.json", "next.config.ts uses webpack bundling", "no @posthog/cli or upload-source-maps action found"]
    }
  ]
}
\`\`\`

### Rules

- Be precise with version numbers - read them from config files, do not guess.
- Use lowercase for all values (e.g. "typescript" not "TypeScript").
- If a field cannot be determined, use an empty array [], empty object {}, or null.
- projectStructure must be one of: "monorepo", "single-package", "multi-package", "unknown".
- setupIssues must be an array. Only include issues you actually detected. Empty array if no issues found.
- For setupIssues, always include specific evidence (file paths, package names) so the user understands why the issue was flagged.
- For the \`no_custom_events\` and \`no_feature_flags\` checks, write the title and description in an informational/suggestive tone (e.g. "No custom events tracked", "Feature flags not used yet") rather than a warning tone. These will be shown as suggestions, not problems.
- **Your job is detection only.** Report what is missing with clear evidence. Do not give opinions or advice on how to fix or integrate anything. A separate AI assistant handles that when the user asks.
- Do NOT include commentary outside the JSON. Your final message must be ONLY the JSON object.`;

function createDetectionRegistry(workspaceRoot: string) {
  return createToolRegistry([
    new ReadFileTool(workspaceRoot),
    new ListDirectoryTool(workspaceRoot),
    new SearchCodeTool(workspaceRoot),
    new CheckEnvKeysTool(workspaceRoot),
  ]);
}

export type DetectionLogLevel = 'info' | 'debug' | 'warn' | 'error';

export type DetectionLogCallback = (
  level: DetectionLogLevel,
  message: string,
) => void;

export type DetectWorkspaceOptions = {
  maxIterations?: number;
  onEvent?: AgentEventCallback;
  onLog?: DetectionLogCallback;
};

export async function detectWorkspace(
  provider: LLMProvider,
  workspaceRoot: string,
  options?: DetectWorkspaceOptions,
): Promise<WorkspaceInfo | undefined> {
  const log = options?.onLog ?? (() => {});
  const registry = createDetectionRegistry(workspaceRoot);
  const maxIterations = options?.maxIterations ?? 12;

  log('info', `Starting workspace detection (maxIterations=${maxIterations})`);

  const prompt = createSystemPromptBuilder();
  prompt.addSection({
    key: 'tools',
    content: registry.toolsPromptSection,
    priority: 5,
  });
  prompt.addSection({
    key: 'detection-instructions',
    content: DETECTION_INSTRUCTIONS,
    priority: 20,
  });

  const result = await runAgentLoop(
    provider,
    [{ role: 'user', content: 'Analyze this workspace and return the JSON.' }],
    registry.definitions,
    registry.executor,
    {
      systemPrompt: prompt.build(),
      maxIterations,
      temperature: 0,
      maxTokens: 4096,
      onEvent: options?.onEvent,
    },
  );

  log(
    'debug',
    `Agent loop completed (${result.iterations} iterations, ` +
      `${result.totalUsage.inputTokens + result.totalUsage.outputTokens} tokens)`,
  );

  const json = extractJson(result.content);
  if (!json) {
    log('warn', `Failed to extract JSON from LLM response:\n${result.content}`);
    return undefined;
  }

  const parsed = WorkspaceInfoSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    log('error', `Schema validation failed:\n${issues}`);
    return undefined;
  }

  log(
    'info',
    `Workspace detected: ${parsed.data.language} (${parsed.data.frameworks.join(', ') || 'no frameworks'})`,
  );

  return {
    ...parsed.data,
    detectedAt: new Date().toISOString(),
  };
}

// Handles ```json blocks and raw JSON
export function extractJson(text: string): unknown | undefined {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Fall through to raw JSON attempt
    }
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return undefined;
    }
  }

  return undefined;
}
