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
  MessageBlock,
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
  private _abortController: AbortController | undefined;

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

  cancel(): void {
    this._abortController?.abort();
  }

  async send(message: string, displayContent?: string): Promise<AgentResult> {
    if (this._isRunning) {
      throw new Error('Session is already processing a message');
    }

    this._isRunning = true;
    this._lastActiveAt = Date.now();
    this._abortController = new AbortController();

    const toolActivity: ToolActivity[] = [];
    const blockCollector = createBlockCollector();

    try {
      this._messages.push({
        role: 'user',
        content: displayContent ?? message,
        timestamp: Date.now(),
      });
      this._llmMessages.push({ role: 'user', content: message });

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
          signal: this._abortController.signal,
          onEvent: (event: AgentEvent) => {
            collectToolActivity(event, toolActivity);
            blockCollector.handle(event);
            this._onEvent?.(event);
          },
        },
      );

      this._llmMessages.push({ role: 'assistant', content: result.content });
      const blocks = blockCollector.blocks;
      this._messages.push({
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
        toolActivity: toolActivity.length > 0 ? toolActivity : undefined,
        blocks: blocks.length > 0 ? blocks : undefined,
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

function createBlockCollector(): {
  handle: (event: AgentEvent) => void;
  blocks: MessageBlock[];
} {
  const blocks: MessageBlock[] = [];
  let activeTextIdx = -1;

  return {
    handle(event: AgentEvent) {
      if (event.type === 'iteration_start') {
        activeTextIdx = -1;
      } else if (event.type === 'text_response') {
        if (activeTextIdx >= 0) {
          (blocks[activeTextIdx] as { type: 'text'; content: string }).content =
            event.content;
        } else {
          activeTextIdx = blocks.length;
          blocks.push({ type: 'text', content: event.content });
        }
      } else if (event.type === 'tool_call_start') {
        activeTextIdx = -1;
      } else if (event.type === 'tool_call_result') {
        const block: MessageBlock = {
          type: 'tool',
          name: event.call.name,
          arguments: event.call.arguments,
          result: event.result,
          durationMs: event.durationMs,
        };
        if (event.feedback) {
          block.feedback = event.feedback;
        }
        blocks.push(block);
      }
    },
    blocks,
  };
}

async function defaultExecutor(): Promise<string> {
  return 'Error: no tool executor configured for this session';
}
