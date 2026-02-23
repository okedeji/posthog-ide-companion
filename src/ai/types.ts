// LLM types - no runtime deps. Import types from here, not SDK packages.

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

export type ToolChoice = 'auto' | 'any' | 'none';

export type LLMGenerateOptions = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type LLMResponse =
  | { type: 'text'; content: string; usage: TokenUsage }
  | { type: 'tool_calls'; calls: ToolCall[]; usage: TokenUsage };

export type LLMStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_calls'; calls: ToolCall[]; usage: TokenUsage }
  | { type: 'done'; content: string; usage: TokenUsage };

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
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
  feedback?: string;
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

export type AgentEventCallback = (event: AgentEvent) => void;

export type ConsentDecision =
  | { action: 'approve' }
  | { action: 'reject' }
  | { action: 'respond'; message: string };

// Agent loop pauses until this resolves.
export type ConsentCallback = (call: ToolCall) => Promise<ConsentDecision>;

export type AgentLoopOptions = {
  maxIterations?: number;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  enableStreaming?: boolean;
  toolChoice?: ToolChoice;
  onEvent?: AgentEventCallback;
  // if not provided, consent-requiring tools are auto-rejected
  onConsent?: ConsentCallback;
  signal?: AbortSignal;
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
  id?: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  executor?: ToolExecutor;
  agentOptions?: Omit<AgentLoopOptions, 'systemPrompt' | 'onEvent'>;
  onEvent?: AgentEventCallback;
  // Pass {} for defaults or provide overrides. Omit to disable.
  compaction?: CompactionOptions;
  initialMessages?: SessionMessage[];
};

export type ToolActivity = {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  durationMs: number;
};

export type MessageBlock =
  | { type: 'text'; content: string }
  | {
      type: 'tool';
      name: string;
      arguments: Record<string, unknown>;
      result: string;
      durationMs: number;
      feedback?: string;
    };

export type SessionMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolActivity?: ToolActivity[]; // assistant messages only (flat list for backward compat)
  blocks?: MessageBlock[]; // chronological interleaving of text + tool activity
};

export type SessionSnapshot = {
  id: string;
  messages: readonly SessionMessage[];
  createdAt: number;
  lastActiveAt: number;
};

export type CompactionOptions = {
  // Should be below the model's context window to leave room for system prompt + tools + response.
  // @default 80_000
  maxTokens?: number;
  // Number of recent user+assistant pairs to keep verbatim. @default 4
  preserveRecentPairs?: number;
};

export type PromptSection = {
  key: string; // last-write-wins for duplicate keys
  content: string;
  priority?: number; // lower = earlier in the prompt. @default 100
};
