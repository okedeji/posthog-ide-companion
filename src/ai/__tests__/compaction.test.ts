import { compactIfNeeded } from '../compaction';
import type { LLMProvider } from '../provider';
import type { LLMMessage, LLMResponse, LLMGenerateOptions } from '../types';
import type { TokenCounter } from '../tokenizer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USAGE = { inputTokens: 10, outputTokens: 5 };

function createMockProvider(summaryText: string): LLMProvider {
  return {
    name: 'mock',
    generate: async (
      _messages: LLMMessage[],
      _options?: LLMGenerateOptions,
    ): Promise<LLMResponse> => {
      return { type: 'text', content: summaryText, usage: USAGE };
    },
    async *stream() {
      yield { type: 'done', content: '', usage: USAGE };
    },
  };
}

/**
 * Creates a mock token counter that returns a fixed count per message.
 * This makes tests deterministic without depending on the real tokenizer.
 */
function createMockTokenCounter(tokensPerMessage: number): TokenCounter {
  return {
    countText: (text: string) => Math.ceil(text.length / 4),
    countMessages: (messages: readonly LLMMessage[]) =>
      messages.length * tokensPerMessage,
  };
}

/** Builds a conversation with N pairs of user/assistant messages. */
function buildConversation(pairs: number): LLMMessage[] {
  const messages: LLMMessage[] = [];
  for (let i = 0; i < pairs; i++) {
    messages.push({ role: 'user', content: `User message ${i + 1}` });
    messages.push({
      role: 'assistant',
      content: `Assistant response ${i + 1}`,
    });
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compactIfNeeded', () => {
  it('should return messages unchanged when under token limit', async () => {
    const messages = buildConversation(3);
    const counter = createMockTokenCounter(100); // 6 msgs × 100 = 600 tokens
    const provider = createMockProvider('Should not be called');

    const result = await compactIfNeeded(provider, messages, counter, {
      maxTokens: 1000,
    });

    expect(result).toEqual(messages);
    expect(result).toHaveLength(messages.length);
  });

  it('should compact when over token limit', async () => {
    const messages = buildConversation(10); // 20 messages
    const counter = createMockTokenCounter(5000); // 20 × 5000 = 100K tokens
    const provider = createMockProvider('Summary of earlier conversation');

    const result = await compactIfNeeded(provider, messages, counter, {
      maxTokens: 80_000,
      preserveRecentPairs: 4,
    });

    // Should have: summary + ack + 8 recent messages = 10
    expect(result).toHaveLength(10);
    expect(result[0]?.role).toBe('user');
    expect(result[0]?.content).toContain('[Conversation Summary]');
    expect(result[1]?.role).toBe('assistant');
    expect(result[1]?.content).toContain('Understood');
  });

  it('should preserve the correct number of recent message pairs', async () => {
    const messages = buildConversation(8); // 16 messages
    const counter = createMockTokenCounter(10_000);
    const provider = createMockProvider('Summary');

    const result = await compactIfNeeded(provider, messages, counter, {
      maxTokens: 50_000,
      preserveRecentPairs: 2,
    });

    // summary + ack + 4 recent messages = 6
    expect(result).toHaveLength(6);
    // Last messages should be the most recent ones
    expect(result[result.length - 1]?.content).toBe('Assistant response 8');
    expect(result[result.length - 2]?.content).toBe('User message 8');
  });

  it('should not compact when not enough messages to split', async () => {
    const messages = buildConversation(2); // 4 messages
    const counter = createMockTokenCounter(50_000); // Over limit
    const provider = createMockProvider('Should not be called');

    const result = await compactIfNeeded(provider, messages, counter, {
      maxTokens: 80_000,
      preserveRecentPairs: 4, // 8 messages to preserve > 4 total
    });

    expect(result).toEqual(messages);
    expect(result).toHaveLength(messages.length);
  });

  it('should use default thresholds when options are omitted', async () => {
    const messages = buildConversation(3); // 6 messages
    const counter = createMockTokenCounter(100); // 600 tokens total
    const provider = createMockProvider('Summary');

    // Default maxTokens is 80K, so 600 tokens should not trigger compaction
    const result = await compactIfNeeded(provider, messages, counter);

    expect(result).toEqual(messages);
    expect(result).toHaveLength(messages.length);
  });

  it('should maintain role alternation after compaction', async () => {
    const messages = buildConversation(10);
    const counter = createMockTokenCounter(10_000);
    const provider = createMockProvider('Summary of conversation');

    const result = await compactIfNeeded(provider, messages, counter, {
      maxTokens: 50_000,
      preserveRecentPairs: 3,
    });

    // Verify alternating roles: user, assistant, user, assistant, ...
    for (let i = 0; i < result.length; i++) {
      const expectedRole = i % 2 === 0 ? 'user' : 'assistant';
      expect(result[i]?.role).toBe(expectedRole);
    }
  });

  it('should handle tool use content blocks in old messages', async () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Read the file' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading file...' },
          {
            type: 'tool_use',
            id: 'tc1',
            name: 'readFile',
            input: { path: 'index.ts' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'tc1', content: 'const x = 1;' },
        ],
      },
      { role: 'assistant', content: 'Found the file contents.' },
      { role: 'user', content: 'Recent message 1' },
      { role: 'assistant', content: 'Recent response 1' },
      { role: 'user', content: 'Recent message 2' },
      { role: 'assistant', content: 'Recent response 2' },
    ];

    const counter = createMockTokenCounter(20_000);
    const provider = createMockProvider('User asked to read a file');

    const result = await compactIfNeeded(provider, messages, counter, {
      maxTokens: 50_000,
      preserveRecentPairs: 2,
    });

    expect(result).toHaveLength(6);
    expect(result[0]?.content).toContain('[Conversation Summary]');
    // Recent messages preserved
    expect(result[result.length - 1]?.content).toBe('Recent response 2');
  });

  it('should use fallback summary when provider returns tool_calls', async () => {
    const messages = buildConversation(6);
    const counter = createMockTokenCounter(20_000);
    const provider: LLMProvider = {
      name: 'mock',
      generate: async (): Promise<LLMResponse> => ({
        type: 'tool_calls',
        calls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'x' } }],
        usage: USAGE,
      }),
      async *stream() {
        yield { type: 'done', content: '', usage: USAGE };
      },
    };

    const result = await compactIfNeeded(provider, messages, counter, {
      maxTokens: 50_000,
      preserveRecentPairs: 2,
    });

    expect(result[0]?.content).toContain('[Conversation Summary]');
    expect(result[0]?.content).toContain('The user discussed');
  });
});
