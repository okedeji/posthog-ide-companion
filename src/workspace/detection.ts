import { z } from 'zod';
import { runAgentLoop } from '../ai/agent';
import { createSystemPromptBuilder } from '../ai/prompts';
import { createToolRegistry } from '../ai/tools/registry';
import { ReadFileTool } from '../ai/tools/read-file';
import { ListDirectoryTool } from '../ai/tools/list-directory';
import { SearchCodeTool } from '../ai/tools/search-code';
import { CheckEnvKeysTool } from '../ai/tools/check-env-keys';
import { McpTool } from '../ai/tools/mcp-tool';
import type { Tool } from '../ai/tools/tool';
import type { LLMProvider } from '../ai/provider';
import type { AgentEventCallback } from '../ai/types';
import type { PostHogMcpClient } from '../mcp/client';
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
2. Read config files to identify the language, framework, and tooling (package.json, tsconfig.json, pyproject.toml, Cargo.toml, go.mod, etc.).
3. Check for monorepo markers (pnpm-workspace.yaml, lerna.json, nx.json, turbo.json, packages/ or apps/ directories).
4. Check for test and build config.
5. Identify framework-specific details (e.g., Next.js App Router vs Pages Router, Django settings modules).
6. **Understand what this project does.** Browse main source directories, read key entry points, and write a concise summary for the \`codebaseSummary\` field. This context is critical for the AI assistant that will later help fix issues in this codebase.

### Part 2: PostHog Setup Issue Detection

Search the codebase for any PostHog SDK (posthog-js, posthog-python, posthog-node, posthog-go, etc.).

**If PostHog is NOT found:** report \`posthog_not_integrated\` and skip all other checks. Output the JSON immediately.

**If PostHog IS found:** do ONE \`docs-search\` for the SDK setup guide for this ecosystem. Then run these checks against the codebase:

1. **\`error_capture_not_configured\`** — Verify error capture is configured. No SDK auto-enables it.
2. **\`source_maps_not_configured\`** — JS/TS with bundler only. Check for source map upload setup.
3. **\`no_user_identification\`** — Check for identify calls.
4. **\`no_custom_events\`** — Check for custom event capture (exclude auto-events starting with \`$\`). Informational tone.
5. **\`debug_mode_enabled\`** — Only flag if debug is hardcoded without any conditional guard.
6. **\`spa_pageview_not_configured\`** — Web SPAs only. Check for SPA pageview config.
7. **\`no_feature_flags\`** — Check for feature flag usage. Informational tone.

Only add confirmed issues to \`setupIssues\`. Empty array = no issues.

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

- Be precise with version numbers — read them from config files, do not guess.
- Use lowercase for all values (e.g. "typescript" not "TypeScript").
- If a field cannot be determined, use an empty array [], empty object {}, or null.
- projectStructure must be one of: "monorepo", "single-package", "multi-package", "unknown".
- setupIssues must be an array. Only include issues you actually detected. Empty array if no issues found.
- For setupIssues, always include specific evidence (file paths, package names) so the user understands why the issue was flagged.
- For \`no_custom_events\` and \`no_feature_flags\`, write title and description in an informational/suggestive tone — these are suggestions, not warnings.
- **Detection only.** Report what is missing with clear evidence. Do not give advice on how to fix anything.
- Do NOT include commentary outside the JSON. Your final message must be ONLY the JSON object.`;

function createDetectionRegistry(
  workspaceRoot: string,
  mcpClient?: PostHogMcpClient,
) {
  const tools: Tool[] = [
    new ReadFileTool(workspaceRoot),
    new ListDirectoryTool(workspaceRoot),
    new SearchCodeTool(workspaceRoot),
    new CheckEnvKeysTool(workspaceRoot),
  ];

  if (mcpClient) {
    const docsSearch = mcpClient.tools.find((t) => t.name === 'docs-search');
    if (docsSearch) {
      tools.push(new McpTool(mcpClient, docsSearch));
    }
  }

  return createToolRegistry(tools);
}

export type DetectionLogLevel = 'info' | 'debug' | 'warn' | 'error';

export type DetectionLogCallback = (
  level: DetectionLogLevel,
  message: string,
) => void;

export type DetectWorkspaceOptions = {
  mcpClient?: PostHogMcpClient;
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
  const registry = createDetectionRegistry(workspaceRoot, options?.mcpClient);
  const maxIterations = options?.maxIterations ?? 16;

  const hasDocsSearch = registry.coreDefinitions.some(
    (d) => d.name === 'docs-search',
  );
  log(
    'info',
    `Starting workspace detection (maxIterations=${maxIterations}, docs-search=${hasDocsSearch})`,
  );

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
    registry.coreDefinitions,
    registry.executor,
    {
      systemPrompt: prompt.build(),
      maxIterations,
      temperature: 0,
      maxTokens: 4096,
      maxToolResultLength: 8_000,
      fallbackMessage:
        'You have reached the maximum number of tool calls. ' +
        'Output the JSON object NOW based on everything you have found so far. ' +
        'Use empty arrays or null for fields you could not determine. ' +
        'Your response must be ONLY the JSON object, nothing else.',
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
