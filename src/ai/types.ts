// LLM types shared across providers, the agent loop, and features.
// No runtime dependencies. Import types from here, not from SDK packages.

/** Role for LLM conversation messages. */
export type LLMRole = 'user' | 'assistant';

/** A single block of content within a message. */
export type LLMContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: 'tool_result'; toolUseId: string; content: string };

/** A message in the LLM conversation. */
export type LLMMessage = {
  role: LLMRole;
  content: string | LLMContentBlock[];
};

/** Options for a single LLM generate/stream call. */
export type LLMGenerateOptions = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: ToolDefinition[];
};

/** Token usage from a single LLM call. */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

/**
 * Response from a single LLM call.
 * Either the model returned text (done) or it wants to call tools (continue).
 */
export type LLMResponse =
  | { type: 'text'; content: string; usage: TokenUsage }
  | { type: 'tool_calls'; calls: ToolCall[]; usage: TokenUsage };

/** Streaming event from an LLM call. */
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

/** A tool invocation requested by the LLM. */
export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/** Executes a tool call and returns the result as a string. */
export type ToolExecutor = (call: ToolCall) => Promise<string>;

/** Emitted when the agent loop starts a new iteration. */
export type AgentIterationStartEvent = {
  type: 'iteration_start';
  iteration: number;
  maxIterations: number;
};

/** Emitted when the LLM requests a tool call. */
export type AgentToolCallStartEvent = {
  type: 'tool_call_start';
  call: ToolCall;
};

/** Emitted when a tool call completes. */
export type AgentToolCallResultEvent = {
  type: 'tool_call_result';
  call: ToolCall;
  result: string;
  durationMs: number;
};

/** Emitted when the LLM produces a text response. */
export type AgentTextResponseEvent = {
  type: 'text_response';
  content: string;
  isFinal: boolean;
};

/** Emitted when the agent loop completes. */
export type AgentCompleteEvent = {
  type: 'complete';
  result: AgentResult;
};

/** Emitted when the agent loop encounters an error. */
export type AgentErrorEvent = {
  type: 'error';
  error: string;
};

/** Union of all events the agent loop can emit. */
export type AgentEvent =
  | AgentIterationStartEvent
  | AgentToolCallStartEvent
  | AgentToolCallResultEvent
  | AgentTextResponseEvent
  | AgentCompleteEvent
  | AgentErrorEvent;

/** Callback for receiving agent events. Non-blocking, fire-and-forget. */
export type AgentEventCallback = (event: AgentEvent) => void;

/** User's decision when a tool requires consent before execution. */
export type ConsentDecision =
  | { action: 'approve' }
  | { action: 'reject' }
  | { action: 'respond'; message: string };

/** Called when a tool with `requiresConsent` is invoked. The loop pauses until resolved. */
export type ConsentCallback = (call: ToolCall) => Promise<ConsentDecision>;

/** Options for the agent loop. */
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

/** Result from a completed agent loop. */
export type AgentResult = {
  content: string;
  totalUsage: TokenUsage;
  iterations: number;
};

/** Provider identifier. */
export type AIProviderName = 'anthropic' | 'openai';

/** Per-workspace AI provider and model selection. */
export type AISelection = {
  provider: AIProviderName;
  model: string;
};

/** A model option shown in the quick pick UI. */
export type ModelOption = {
  id: string;
  label: string;
  description: string;
  default?: boolean;
};

/** Configuration for creating a new session. */
export type SessionOptions = {
  /** Unique session identifier. Auto-generated if omitted. */
  id?: string;
  /** System prompt for the session. */
  systemPrompt?: string;
  /** Tools available in this session. */
  tools?: ToolDefinition[];
  /** Tool executor for this session. */
  executor?: ToolExecutor;
  /** Agent loop options (max iterations, model, temperature, etc.). */
  agentOptions?: Omit<AgentLoopOptions, 'systemPrompt' | 'onEvent'>;
  /** Event callback forwarded to the agent loop. */
  onEvent?: AgentEventCallback;
  /**
   * Conversation compaction configuration.
   * When set, the session will automatically summarize older messages
   * when the conversation exceeds the token threshold.
   * Disabled by default — set to `{}` for defaults or provide overrides.
   */
  compaction?: CompactionOptions;
};

/** A record of a single tool call that was executed during a turn. */
export type ToolActivity = {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  durationMs: number;
};

/**
 * A message in the session's conversation history.
 * Assistant messages may include `toolActivity` — the tools that were
 * called to produce the response. This allows the UI to render tool
 * calls inline when displaying conversation history.
 */
export type SessionMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Tool calls executed during this turn (assistant messages only). */
  toolActivity?: ToolActivity[];
};

/** Read-only snapshot of session state. */
export type SessionSnapshot = {
  id: string;
  messages: readonly SessionMessage[];
  createdAt: number;
  lastActiveAt: number;
};

/**
 * Configuration for conversation history compaction.
 * When the total token count of LLM messages exceeds `maxTokens`,
 * older messages are summarized to free context window space.
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
   * Number of recent message pairs (user + assistant) to preserve.
   * These are kept verbatim so the LLM has immediate context.
   * @default 4
   */
  preserveRecentPairs?: number;
};

/** Status of the workspace detection process. */
export type DetectionStatus = 'idle' | 'running' | 'complete' | 'failed';

/**
 * Structured information about the workspace, produced by LLM-powered detection.
 * Stored in workspace state and injected into session prompts.
 */
export type WorkspaceInfo = {
  /** Primary language (e.g. "typescript", "python", "rust"). */
  language: string;
  /** Detected frameworks (e.g. ["next.js", "tailwind"]). */
  frameworks: string[];
  /** Version of each framework, keyed by framework name. */
  frameworkVersions: Record<string, string>;
  /**
   * Granular per-framework details the flat `frameworks` array cannot express.
   * E.g. `{ "next.js": { "router": "app", "version": "14.2.0" } }`.
   */
  frameworkDetails: Record<string, Record<string, string>>;
  /** Package manager (e.g. "pnpm", "npm", "yarn", "pip", "cargo"). */
  packageManager: string | null;
  /** Test frameworks (e.g. ["jest", "vitest", "pytest"]). */
  testFrameworks: string[];
  /** Build tools (e.g. ["esbuild", "tsc", "webpack"]). */
  buildTools: string[];
  /** Project structure classification. */
  projectStructure: 'monorepo' | 'single-package' | 'multi-package' | 'unknown';
  /** Notable patterns or conventions worth knowing (e.g. "uses barrel exports"). */
  notablePatterns: string[];
  /** ISO timestamp when detection was last run. */
  detectedAt: string;
};

/** A named section of a composable system prompt. */
export type PromptSection = {
  /** Unique key. Later registrations with the same key overwrite earlier ones. */
  key: string;
  /** Section content (plain text, joined with double newlines). */
  content: string;
  /** Sort priority. Lower numbers appear first. Default: 100. */
  priority?: number;
};
