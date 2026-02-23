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

Now that you know the ecosystem, use \`docs-search\` to find the latest PostHog SDK and setup guide for this project's language and framework. **Include the current date in your queries** to get the most current documentation.

Based on what you learn from the docs, run these checks against the codebase. Add entries to \`setupIssues\` ONLY for confirmed problems. Empty array = no issues found.

**Dependency chain:** Check 1 is the gate. If PostHog is NOT found, skip Checks 2–8 entirely.

1. **\`posthog_not_integrated\`** — Search docs to learn which PostHog SDK applies to this ecosystem. Then search the codebase for it. If no PostHog integration found at all, report this and stop here.
2. **\`error_capture_not_configured\`** — Search docs for how to configure error capture for this SDK. Then verify the codebase has it. No SDK auto-enables error capture.
3. **\`source_maps_not_configured\`** — JS/TS with bundler only. Search docs for source map upload setup. Skip for non-JS projects.
4. **\`no_user_identification\`** — Search docs for how to identify users with this SDK. Check if identify calls exist in the codebase.
5. **\`no_custom_events\`** — Search for custom event capture calls (exclude PostHog auto-events starting with \`$\`). Informational — use suggestive tone.
6. **\`debug_mode_enabled\`** — Look for unconditional hardcoded debug mode in PostHog config. Ignore environment-conditional patterns — only flag if debug is hardcoded without any conditional guard. Read surrounding code context before deciding.
7. **\`spa_pageview_not_configured\`** — Web SPAs only. Search docs for the latest SPA pageview tracking approach. Skip for non-web/non-SPA projects.
8. **\`no_feature_flags\`** — Search for feature flag usage. Informational — use suggestive tone.

**For every check:** search docs for the latest PostHog guidance on that topic for this specific ecosystem. Include the current date in queries.

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
