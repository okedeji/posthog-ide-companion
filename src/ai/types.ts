// LLM types shared across providers, the agent loop, and features.
// No runtime dependencies. Import types from here, not from SDK packages.

export type LLMRole = 'user' | 'assistant';

export type LLMContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: 'tool_result'; toolUseId: string; content: string };

export type LLMMessage = {
  role: LLMRole;
  content: string | LLMContentBlock[];
};

export type LLMGenerateOptions = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: ToolDefinition[];
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

/**
 * Either the model returned text (done) or it wants to call tools (continue).
 */
export type LLMResponse =
  | { type: 'text'; content: string; usage: TokenUsage }
  | { type: 'tool_calls'; calls: ToolCall[]; usage: TokenUsage };

export type LLMStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; content: string; usage: TokenUsage };

/** JSON Schema definition for a tool the LLM can call. */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** When true, the agent loop requests user consent before executing. */
  requiresConsent?: boolean;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolExecutor = (call: ToolCall) => Promise<string>;

export type AgentIterationStartEvent = {
  type: 'iteration_start';
  iteration: number;
  maxIterations: number;
};

export type AgentToolCallStartEvent = {
  type: 'tool_call_start';
  call: ToolCall;
};

export type AgentToolCallResultEvent = {
  type: 'tool_call_result';
  call: ToolCall;
  result: string;
  durationMs: number;
};

export type AgentTextResponseEvent = {
  type: 'text_response';
  content: string;
  isFinal: boolean;
};

export type AgentCompleteEvent = {
  type: 'complete';
  result: AgentResult;
};

export type AgentErrorEvent = {
  type: 'error';
  error: string;
};

export type AgentEvent =
  | AgentIterationStartEvent
  | AgentToolCallStartEvent
  | AgentToolCallResultEvent
  | AgentTextResponseEvent
  | AgentCompleteEvent
  | AgentErrorEvent;

/** Non-blocking, fire-and-forget callback for agent loop events. */
export type AgentEventCallback = (event: AgentEvent) => void;

/** User's decision when a tool requires consent before execution. */
export type ConsentDecision =
  | { action: 'approve' }
  | { action: 'reject' }
  | { action: 'respond'; message: string };

/** The agent loop pauses until this resolves. */
export type ConsentCallback = (call: ToolCall) => Promise<ConsentDecision>;

export type AgentLoopOptions = {
  maxIterations?: number;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** Callback for agent loop events (tool calls, results, progress). */
  onEvent?: AgentEventCallback;
  /** If not provided, consent-requiring tools are auto-rejected. */
  onConsent?: ConsentCallback;
};

export type AgentResult = {
  content: string;
  totalUsage: TokenUsage;
  iterations: number;
};

export type AIProviderName = 'anthropic' | 'openai';

export type AISelection = {
  provider: AIProviderName;
  model: string;
};

export type ModelOption = {
  id: string;
  label: string;
  description: string;
  default?: boolean;
};

export type SessionOptions = {
  /** Auto-generated if omitted. */
  id?: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  executor?: ToolExecutor;
  agentOptions?: Omit<AgentLoopOptions, 'systemPrompt' | 'onEvent'>;
  /** Forwarded to the agent loop. */
  onEvent?: AgentEventCallback;
  /**
   * Conversation compaction configuration.
   * When set, the session automatically summarizes older messages
   * when the conversation exceeds the token threshold.
   * Disabled by default — set to `{}` for defaults or provide overrides.
   */
  compaction?: CompactionOptions;
};

export type ToolActivity = {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  durationMs: number;
};

/**
 * Assistant messages may include `toolActivity` — the tools that were
 * called to produce the response — so the UI can render them inline.
 */
export type SessionMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Present on assistant messages only. */
  toolActivity?: ToolActivity[];
};

export type SessionSnapshot = {
  id: string;
  messages: readonly SessionMessage[];
  createdAt: number;
  lastActiveAt: number;
};

/**
 * When the total token count exceeds `maxTokens`, older messages are
 * summarized to free context window space.
 */
export type CompactionOptions = {
  /**
   * Maximum total tokens before compaction triggers.
   * Should be set below the model's context window to leave room for
   * the system prompt, tools, and the next response.
   * @default 80_000
   */
  maxTokens?: number;
  /**
   * Number of recent message pairs (user + assistant) to preserve verbatim.
   * @default 4
   */
  preserveRecentPairs?: number;
};

export type DetectionStatus = 'idle' | 'running' | 'complete' | 'failed';

export type SetupIssue = {
  /** Machine-readable identifier (e.g. "posthog_not_integrated"). */
  checkId: string;
  /** Displayed in the tree view. */
  title: string;
  description: string;
  /** Files, config entries, or patterns that led to this conclusion. */
  evidence: string[];
  /** Actionable suggestion for resolving the issue. */
  remediation: string;
};

/**
 * Structured workspace information produced by LLM-powered detection.
 * Stored in workspace state and injected into session prompts.
 */
export type WorkspaceInfo = {
  language: string;
  frameworks: string[];
  frameworkVersions: Record<string, string>;
  /**
   * Granular per-framework details the flat `frameworks` array cannot express.
   * E.g. `{ "next.js": { "router": "app", "version": "14.2.0" } }`.
   */
  frameworkDetails: Record<string, Record<string, string>>;
  packageManager: string | null;
  testFrameworks: string[];
  buildTools: string[];
  projectStructure: 'monorepo' | 'single-package' | 'multi-package' | 'unknown';
  /** E.g. "uses barrel exports", "co-locates tests with source". */
  notablePatterns: string[];
  setupIssues: SetupIssue[];
  /** ISO 8601 timestamp. */
  detectedAt: string;
};

export type PromptSection = {
  /** Later registrations with the same key overwrite earlier ones. */
  key: string;
  /** Joined with double newlines when building the prompt. */
  content: string;
  /** Lower numbers appear first. @default 100 */
  priority?: number;
};
