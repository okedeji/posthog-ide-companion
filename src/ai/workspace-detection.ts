import type * as vscode from 'vscode';
import { z } from 'zod';
import { runAgentLoop } from './agent';
import { WORKSPACE_TOOLS, createWorkspaceExecutor } from './tools/workspace';
import type { LLMProvider } from './provider';
import type {
  WorkspaceInfo,
  SetupIssue,
  ToolDefinition,
  AgentEventCallback,
} from './types';

const WORKSPACE_INFO_KEY = 'posthog.workspaceInfo';

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
  remediation: z.string(),
}) satisfies z.ZodType<SetupIssue>;

/**
 * Schema for validating the LLM's structured workspace detection output.
 * Uses `z.coerce.string()` in frameworkDetails because LLMs naturally
 * produce booleans/numbers for values like `"multiWindow": true`.
 */
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
  setupIssues: z.array(SetupIssueSchema).optional().default([]),
});

const DETECTION_SYSTEM_PROMPT = `You are a workspace analyzer. Your job is to explore a software project, produce structured JSON describing it, and detect PostHog setup issues.

## Part 1: Workspace Analysis

1. **List the root directory** to see what files and folders exist.
2. **Read config files** to identify the language, framework, and tooling:
   - package.json, tsconfig.json, next.config.*, vite.config.*, nuxt.config.*
   - pyproject.toml, setup.py, requirements.txt, Pipfile
   - Cargo.toml, go.mod, build.gradle, pom.xml, Gemfile
   - Any other config files you find in the root
3. **Check for monorepo markers**: pnpm-workspace.yaml, lerna.json, nx.json, turbo.json, packages/ or apps/ directories.
4. **Check for test and build config**: jest.config.*, vitest.config.*, pytest.ini, .babelrc, webpack.config.*, esbuild.*, rollup.config.*.
5. **Identify framework-specific details**: For example, if Next.js is detected, check for app/ directory (App Router) vs pages/ directory (Pages Router). For Django, check for settings modules. For React, check if it uses class components vs hooks.

## Part 2: PostHog Setup Issue Detection

After analyzing the workspace, check for PostHog integration problems. Add entries to the \`setupIssues\` array ONLY for problems you find. Empty array = everything looks good (or PostHog is not relevant to this project).

### Check 1: PostHog Integration (\`checkId: "posthog_not_integrated"\`)

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

If NOTHING is found → add this issue. If PostHog is found via any method (SDK or HTTP), skip this check.

### Check 2: Error Tracking (\`checkId: "error_capture_not_configured"\`)

Only run if PostHog integration was found (Check 1 passed). Search the codebase for any evidence that PostHog error/exception capture is configured. This varies by SDK and integration method — look broadly for patterns like:
- Error capture config flags (e.g. \`captureExceptions\`, \`enableExceptionAutocapture\`, \`auto_capture_exceptions\`, \`capture_exceptions\`)
- Manual exception capture calls (e.g. \`captureException\`, \`capture_exception\`)
- PostHog error tracking middleware or handler setup
- Instrumentation files (e.g. \`instrumentation.ts\`) with PostHog error config

Do NOT assume any SDK auto-enables error capture — all SDKs require explicit configuration. If PostHog is integrated but you find no evidence of error capture being configured → add this issue.

### Check 3: Source Maps (\`checkId: "source_maps_not_configured"\`)

Only run if PostHog integration was found AND the project uses JS/TS with a bundler (webpack, vite, esbuild, Next.js, Rollup, etc.). PostHog currently only supports JavaScript source map uploads — this check does not apply to other languages.

Look for any source map upload tooling:
- \`@posthog/cli\` or \`posthog-cli\` in package.json
- \`PostHog/upload-source-maps\` in .github/workflows/*.yml
- \`@posthog/nextjs-config\` with \`withPostHogConfig\` in next.config.*
- Any CI/build script that uploads source maps to PostHog

If the project bundles JS/TS with PostHog but has no source map upload configured → add this issue.

## Output Schema

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
  "setupIssues": [
    {
      "checkId": "source_maps_not_configured",
      "title": "Source maps not uploaded to PostHog",
      "description": "This Next.js project uses posthog-js but has no source map upload configured. Production error stack traces will show minified code.",
      "evidence": ["posthog-js found in package.json", "next.config.ts uses webpack bundling", "no @posthog/cli or upload-source-maps action found"],
      "remediation": "Install @posthog/cli and add a source map upload step to your build pipeline, or use @posthog/nextjs-config with withPostHogConfig() in next.config."
    }
  ]
}
\`\`\`

## Rules

- Be precise with version numbers — read them from config files, do not guess.
- Use lowercase for all values (e.g. "typescript" not "TypeScript").
- If a field cannot be determined, use an empty array [], empty object {}, or null.
- projectStructure must be one of: "monorepo", "single-package", "multi-package", "unknown".
- setupIssues must be an array. Only include issues you actually detected. Empty array if no issues found.
- For setupIssues, always include specific evidence (file paths, package names) so the user understands why the issue was flagged.
- Do NOT include commentary outside the JSON. Your final message must be ONLY the JSON object.`;

/** Detection uses read-only tools only — it must not modify the workspace. */
export const DETECTION_TOOLS: ToolDefinition[] = WORKSPACE_TOOLS.filter(
  (t) => t.name !== 'setEnvValues',
);

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

/**
 * Runs the LLM through the workspace to detect project information.
 * Uses read-only tools to explore config files and directory structure,
 * then validates the structured JSON output with Zod.
 */
export async function detectWorkspace(
  provider: LLMProvider,
  workspaceRoot: string,
  options?: DetectWorkspaceOptions,
): Promise<WorkspaceInfo | undefined> {
  const log = options?.onLog ?? (() => {});
  const executor = createWorkspaceExecutor(workspaceRoot);
  // ls root + read configs + search for PostHog patterns + respond
  const maxIterations = options?.maxIterations ?? 12;

  log('info', `Starting workspace detection (maxIterations=${maxIterations})`);

  const result = await runAgentLoop(
    provider,
    [{ role: 'user', content: 'Analyze this workspace and return the JSON.' }],
    DETECTION_TOOLS,
    executor,
    {
      systemPrompt: DETECTION_SYSTEM_PROMPT,
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

/** Extracts JSON from LLM output — handles ```json blocks and raw JSON. */
export function extractJson(text: string): unknown | undefined {
  // Try markdown code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Fall through to raw JSON attempt
    }
  }

  // Try raw JSON (find the first { and last })
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

export function getStoredWorkspaceInfo(
  context: vscode.ExtensionContext,
): WorkspaceInfo | undefined {
  return context.workspaceState.get<WorkspaceInfo>(WORKSPACE_INFO_KEY);
}

export async function setStoredWorkspaceInfo(
  context: vscode.ExtensionContext,
  info: WorkspaceInfo,
): Promise<void> {
  await context.workspaceState.update(WORKSPACE_INFO_KEY, info);
}

export async function clearStoredWorkspaceInfo(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.workspaceState.update(WORKSPACE_INFO_KEY, undefined);
}

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export function isWorkspaceInfoStale(
  info: WorkspaceInfo,
  thresholdMs: number = STALE_THRESHOLD_MS,
): boolean {
  const detectedAt = new Date(info.detectedAt).getTime();
  if (isNaN(detectedAt)) {
    return true;
  }
  return Date.now() - detectedAt > thresholdMs;
}
