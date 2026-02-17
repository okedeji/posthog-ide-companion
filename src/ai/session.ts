import { randomUUID } from 'crypto';
import { runAgentLoop } from './agent';
import { compactIfNeeded } from './compaction';
import { createTokenCounter } from './tokenizer';
import type { TokenCounter } from './tokenizer';
import type { LLMProvider } from './provider';
import type {
  LLMMessage,
  CompactionOptions,
  ToolDefinition,
  ToolExecutor,
  AgentEvent,
  AgentEventCallback,
  SessionOptions,
  SessionMessage,
  SessionSnapshot,
  AgentResult,
  ToolActivity,
} from './types';

/**
 * A multi-turn conversation session.
 *
 * Wraps the agent loop with persistent conversation history.
 * Each call to `send()` appends the user message, runs the agent loop
 * with full history, and appends the assistant response.
 *
 * Maintains two message lists:
 * - `_messages` (SessionMessage[]) — display history for the UI.
 *   Has timestamps, text content, and tool activity attached to each
 *   assistant message so the UI can render tool calls inline.
 * - `_llmMessages` (LLMMessage[]) — full conversation for the LLM API.
 *   Uses the LLM's message format (content can be string or content
 *   blocks including tool_use and tool_result).
 *
 * The session is a pure logic layer — it does not handle UI, streaming,
 * or persistence. Features build on top of it.
 */
export class Session {
  readonly id: string;
  private readonly _provider: LLMProvider;
  private readonly _tools: ToolDefinition[];
  private readonly _executor: ToolExecutor;
  private readonly _systemPrompt: string | undefined;
  private readonly _agentOptions: SessionOptions['agentOptions'];
  private readonly _onEvent: AgentEventCallback | undefined;
  private readonly _compaction: CompactionOptions | undefined;
  private readonly _tokenCounter: TokenCounter;

  private _messages: SessionMessage[] = [];
  private _llmMessages: LLMMessage[] = [];
  private readonly _createdAt: number;
  private _lastActiveAt: number;
  private _isRunning = false;

  constructor(provider: LLMProvider, options?: SessionOptions) {
    this.id = options?.id ?? randomUUID();
    this._provider = provider;
    this._tools = options?.tools ?? [];
    this._executor = options?.executor ?? defaultExecutor;
    this._systemPrompt = options?.systemPrompt;
    this._agentOptions = options?.agentOptions ?? {};
    this._onEvent = options?.onEvent;
    this._compaction = options?.compaction;
    this._tokenCounter = createTokenCounter();
    this._createdAt = Date.now();
    this._lastActiveAt = this._createdAt;
  }

  get messages(): readonly SessionMessage[] {
    return this._messages;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Sends a user message and returns the assistant's response.
   *
   * Appends the user message to both histories, runs the agent loop
   * with the full LLM conversation, and appends the assistant's final
   * text response to both histories. Tool activity from the agent loop
   * is collected and attached to the assistant message.
   *
   * @param message - The user's message text.
   * @returns The agent result containing the assistant's response.
   * @throws If a send is already in progress (sessions are single-threaded).
   */
  async send(message: string): Promise<AgentResult> {
    if (this._isRunning) {
      throw new Error('Session is already processing a message');
    }

    this._isRunning = true;
    this._lastActiveAt = Date.now();

    // Collect tool activity during this turn
    const toolActivity: ToolActivity[] = [];

    try {
      this._messages.push({
        role: 'user',
        content: message,
        timestamp: Date.now(),
      });
      this._llmMessages.push({ role: 'user', content: message });

      // Compact conversation history if enabled and over the token limit.
      // This replaces older messages with a summary, keeping recent turns
      // intact so the LLM has immediate context.
      if (this._compaction) {
        this._llmMessages = await compactIfNeeded(
          this._provider,
          this._llmMessages,
          this._tokenCounter,
          this._compaction,
        );
      }

      // Intercept events to collect tool activity, then forward to external callback
      const result = await runAgentLoop(
        this._provider,
        this._llmMessages,
        this._tools,
        this._executor,
        {
          ...this._agentOptions,
          systemPrompt: this._systemPrompt,
          onEvent: (event: AgentEvent) => {
            collectToolActivity(event, toolActivity);
            this._onEvent?.(event);
          },
        },
      );

      this._llmMessages.push({ role: 'assistant', content: result.content });
      this._messages.push({
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
        toolActivity: toolActivity.length > 0 ? toolActivity : undefined,
      });

      return result;
    } finally {
      this._isRunning = false;
    }
  }

  snapshot(): SessionSnapshot {
    return {
      id: this.id,
      messages: [...this._messages],
      createdAt: this._createdAt,
      lastActiveAt: this._lastActiveAt,
    };
  }

  reset(): void {
    if (this._isRunning) {
      throw new Error('Cannot reset session while processing');
    }
    this._messages = [];
    this._llmMessages = [];
    this._lastActiveAt = Date.now();
  }
}

/**
 * Collects tool call results from agent events into a ToolActivity array.
 * Only `tool_call_result` events produce activity records.
 */
function collectToolActivity(
  event: AgentEvent,
  activity: ToolActivity[],
): void {
  if (event.type === 'tool_call_result') {
    activity.push({
      name: event.call.name,
      arguments: event.call.arguments,
      result: event.result,
      durationMs: event.durationMs,
    });
  }
}

/** Default executor that returns an error for any tool call. */
async function defaultExecutor(): Promise<string> {
  return 'Error: no tool executor configured for this session';
}
