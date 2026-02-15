import type * as vscode from 'vscode';
import { z } from 'zod';
import { runAgentLoop } from './agent';
import { WORKSPACE_TOOLS, createWorkspaceExecutor } from './tools/workspace';
import type { LLMProvider } from './provider';
import type {
  WorkspaceInfo,
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
});

const DETECTION_SYSTEM_PROMPT = `You are a workspace analyzer. Your job is to explore a software project and produce structured JSON describing the project.

## Instructions

1. **List the root directory** to see what files and folders exist.
2. **Read config files** to identify the language, framework, and tooling:
   - package.json, tsconfig.json, next.config.*, vite.config.*, nuxt.config.*
   - pyproject.toml, setup.py, requirements.txt, Pipfile
   - Cargo.toml, go.mod, build.gradle, pom.xml, Gemfile
   - Any other config files you find in the root
3. **Check for monorepo markers**: pnpm-workspace.yaml, lerna.json, nx.json, turbo.json, packages/ or apps/ directories.
4. **Check for test and build config**: jest.config.*, vitest.config.*, pytest.ini, .babelrc, webpack.config.*, esbuild.*, rollup.config.*.
5. **Identify framework-specific details**: For example, if Next.js is detected, check for app/ directory (App Router) vs pages/ directory (Pages Router). For Django, check for settings modules. For React, check if it uses class components vs hooks.
6. **Return ONLY a JSON object** matching this exact schema:

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
  "notablePatterns": ["uses barrel exports", "monorepo with shared packages"]
}
\`\`\`

## Rules

- Be precise with version numbers — read them from config files, do not guess.
- Use lowercase for all values (e.g. "typescript" not "TypeScript").
- If a field cannot be determined, use an empty array [], empty object {}, or null.
- projectStructure must be one of: "monorepo", "single-package", "multi-package", "unknown".
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
  // Enough to ls root + read a few config files + respond
  const maxIterations = options?.maxIterations ?? 8;

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
