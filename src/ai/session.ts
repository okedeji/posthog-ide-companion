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

// Multi-turn conversation. Keeps two histories: _messages for the UI (with
// timestamps + tool activity) and _llmMessages for the API (with content blocks).
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

  async send(message: string): Promise<AgentResult> {
    if (this._isRunning) {
      throw new Error('Session is already processing a message');
    }

    this._isRunning = true;
    this._lastActiveAt = Date.now();

    const toolActivity: ToolActivity[] = [];

    try {
      this._messages.push({
        role: 'user',
        content: message,
        timestamp: Date.now(),
      });
      this._llmMessages.push({ role: 'user', content: message });

      // Compact old messages into a summary when the conversation gets too long
      if (this._compaction) {
        this._llmMessages = await compactIfNeeded(
          this._provider,
          this._llmMessages,
          this._tokenCounter,
          this._compaction,
        );
      }

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

async function defaultExecutor(): Promise<string> {
  return 'Error: no tool executor configured for this session';
}
