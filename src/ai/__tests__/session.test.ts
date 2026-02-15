import { Session } from '../session';
import type { LLMProvider } from '../provider';
import type {
  LLMMessage,
  LLMResponse,
  LLMGenerateOptions,
  ToolDefinition,
  ToolCall,
  AgentEvent,
} from '../types';

const USAGE = { inputTokens: 10, outputTokens: 5 };

function createMockProvider(
  responses: LLMResponse[],
): LLMProvider & { callCount: number } {
  let callIndex = 0;

  return {
    name: 'mock',
    get callCount() {
      return callIndex;
    },
    generate: async (
      _messages: LLMMessage[],
      _options?: LLMGenerateOptions,
    ): Promise<LLMResponse> => {
      const response = responses[callIndex];
      if (!response) {
        throw new Error('Mock provider ran out of responses');
      }
      callIndex++;
      return response;
    },
    async *stream() {
      yield { type: 'done', content: '', usage: USAGE };
    },
  };
}

const SAMPLE_TOOLS: ToolDefinition[] = [
  {
    name: 'readFile',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

const mockExecutor = async (call: ToolCall): Promise<string> => {
  if (call.name === 'readFile') {
    return `Contents of ${String(call.arguments['path'])}`;
  }
  return 'Unknown tool';
};

describe('Session', () => {
  it('should maintain conversation history across turns', async () => {
    const provider = createMockProvider([
      { type: 'text', content: 'Hello!', usage: USAGE },
      { type: 'text', content: 'Sure, what do you need?', usage: USAGE },
    ]);

    const session = new Session(provider, {
      tools: SAMPLE_TOOLS,
      executor: mockExecutor,
    });

    await session.send('Hi');
    await session.send('Help me');

    expect(session.messages).toHaveLength(4);
    expect(session.messages[0]?.role).toBe('user');
    expect(session.messages[0]?.content).toBe('Hi');
    expect(session.messages[1]?.role).toBe('assistant');
    expect(session.messages[1]?.content).toBe('Hello!');
    expect(session.messages[2]?.role).toBe('user');
    expect(session.messages[2]?.content).toBe('Help me');
    expect(session.messages[3]?.role).toBe('assistant');
    expect(session.messages[3]?.content).toBe('Sure, what do you need?');
  });

  it('returns agent result from send', async () => {
    const provider = createMockProvider([
      { type: 'text', content: 'Done!', usage: USAGE },
    ]);

    const session = new Session(provider);
    const result = await session.send('Go');

    expect(result.content).toBe('Done!');
    expect(result.iterations).toBe(1);
    expect(result.totalUsage).toEqual(USAGE);
  });

  it('should reject concurrent sends', async () => {
    // Provider that takes time to respond
    const provider: LLMProvider = {
      name: 'slow',
      generate: async (): Promise<LLMResponse> => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { type: 'text', content: 'Done', usage: USAGE };
      },
      async *stream() {
        yield { type: 'done', content: '', usage: USAGE };
      },
    };

    const session = new Session(provider);
    const p1 = session.send('First');

    await expect(session.send('Second')).rejects.toThrow('already processing');

    await p1;
    expect(session.isRunning).toBe(false);
  });

  it('clears history on reset', async () => {
    const provider = createMockProvider([
      { type: 'text', content: 'Hello', usage: USAGE },
    ]);

    const session = new Session(provider);
    await session.send('Hi');

    expect(session.messages).toHaveLength(2);

    session.reset();

    expect(session.messages).toHaveLength(0);
  });

  it('should reject reset while processing', async () => {
    const provider: LLMProvider = {
      name: 'slow',
      generate: async (): Promise<LLMResponse> => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { type: 'text', content: 'Done', usage: USAGE };
      },
      async *stream() {
        yield { type: 'done', content: '', usage: USAGE };
      },
    };

    const session = new Session(provider);
    const p1 = session.send('Go');

    expect(() => session.reset()).toThrow(
      'Cannot reset session while processing',
    );

    await p1;
  });

  it('returns a snapshot with correct state', async () => {
    const provider = createMockProvider([
      { type: 'text', content: 'Hi!', usage: USAGE },
    ]);

    const session = new Session(provider, { id: 'test-session' });
    await session.send('Hello');

    const snap = session.snapshot();

    expect(snap.id).toBe('test-session');
    expect(snap.messages).toHaveLength(2);
    expect(snap.createdAt).toBeLessThanOrEqual(snap.lastActiveAt);
  });

  it('should auto-generate session ID when not provided', () => {
    const provider = createMockProvider([]);
    const session = new Session(provider);

    expect(session.id).toBeTruthy();
    expect(session.id.length).toBeGreaterThan(0);
  });

  it('forwards events to the callback', async () => {
    const events: AgentEvent[] = [];
    const provider = createMockProvider([
      { type: 'text', content: 'Hello', usage: USAGE },
    ]);

    const session = new Session(provider, {
      onEvent: (e) => events.push(e),
    });

    await session.send('Hi');

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.type).toBe('iteration_start');
  });

  it('should attach tool activity to assistant messages', async () => {
    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [
          { id: 'tc1', name: 'readFile', arguments: { path: 'index.ts' } },
        ],
        usage: USAGE,
      },
      { type: 'text', content: 'Found the file!', usage: USAGE },
    ]);

    const session = new Session(provider, {
      tools: SAMPLE_TOOLS,
      executor: mockExecutor,
    });

    await session.send('Read index.ts');

    const assistantMsg = session.messages[1];
    expect(assistantMsg?.role).toBe('assistant');
    expect(assistantMsg?.toolActivity).toBeDefined();
    expect(assistantMsg?.toolActivity).toHaveLength(1);
    expect(assistantMsg?.toolActivity?.[0]?.name).toBe('readFile');
    expect(assistantMsg?.toolActivity?.[0]?.result).toContain('index.ts');
    expect(assistantMsg?.toolActivity?.[0]?.durationMs).toBeGreaterThanOrEqual(
      0,
    );
  });

  it('does not include toolActivity when no tools were called', async () => {
    const provider = createMockProvider([
      { type: 'text', content: 'No tools needed', usage: USAGE },
    ]);

    const session = new Session(provider);
    await session.send('Just a question');

    const assistantMsg = session.messages[1];
    expect(assistantMsg?.toolActivity).toBeUndefined();
  });

  it('should have timestamps on all messages', async () => {
    const provider = createMockProvider([
      { type: 'text', content: 'Hello', usage: USAGE },
    ]);

    const session = new Session(provider);
    const before = Date.now();
    await session.send('Hi');
    const after = Date.now();

    for (const msg of session.messages) {
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    }
  });

  describe('compaction', () => {
    it('does not compact when compaction is not configured', async () => {
      // Build enough responses for many turns
      const responses = Array.from({ length: 10 }, (_, i) => ({
        type: 'text' as const,
        content: `Response ${i + 1}`,
        usage: USAGE,
      }));

      const provider = createMockProvider(responses);
      const session = new Session(provider);

      // No compaction configured, all messages should be kept
      for (let i = 0; i < 10; i++) {
        await session.send(`Message ${i + 1}`);
      }

      expect(session.messages).toHaveLength(20); // 10 user + 10 assistant
    });

    it('should compact LLM messages when over token limit', async () => {
      // Provide plenty of responses since some are consumed by compaction
      // summary calls, some by the agent loop. Use generous count to
      // avoid "ran out of responses" regardless of exact compaction timing.
      const responses: LLMResponse[] = Array.from({ length: 20 }, () => ({
        type: 'text' as const,
        content: 'R'.repeat(2000),
        usage: USAGE,
      }));

      const provider = createMockProvider(responses);
      const session = new Session(provider, {
        compaction: {
          maxTokens: 2000, // Very low threshold to trigger compaction early
          preserveRecentPairs: 2,
        },
      });

      // Build up enough conversation to trigger compaction
      for (let i = 0; i < 6; i++) {
        await session.send('M'.repeat(2000));
      }

      // UI messages should have ALL messages regardless of LLM compaction.
      // Compaction only affects _llmMessages, not _messages.
      expect(session.messages).toHaveLength(12); // 6 user + 6 assistant
    });

    it('preserves UI message history even after LLM compaction', async () => {
      const responses: LLMResponse[] = Array.from({ length: 20 }, () => ({
        type: 'text' as const,
        content: 'A'.repeat(5000),
        usage: USAGE,
      }));

      const provider = createMockProvider(responses);
      const session = new Session(provider, {
        compaction: {
          maxTokens: 1000, // low enough to trigger compaction immediately
          preserveRecentPairs: 1,
        },
      });

      await session.send('X'.repeat(5000));
      await session.send('Y'.repeat(5000));
      await session.send('Z'.repeat(5000));
      await session.send('Final');

      // UI messages should have ALL messages (compaction is transparent)
      expect(session.messages).toHaveLength(8); // 4 user + 4 assistant
      expect(session.messages[0]?.role).toBe('user');
      expect(session.messages[0]?.content).toBe('X'.repeat(5000));
      expect(session.messages[7]?.role).toBe('assistant');
    });
  });
});
