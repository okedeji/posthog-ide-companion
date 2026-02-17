import { AnthropicProvider } from '../anthropic';
import type { LLMMessage } from '../../types';

// Mock the SDK so we can control what the client returns
const mockCreate = jest.fn();
const mockStream = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    messages: { create: mockCreate, stream: mockStream },
  })),
}));

const MOCK_USAGE = { input_tokens: 100, output_tokens: 50 };

beforeEach(() => {
  mockCreate.mockReset();
  mockStream.mockReset();
});

describe('AnthropicProvider', () => {
  const provider = new AnthropicProvider('sk-ant-test');

  describe('generate', () => {
    it('returns text response when stop_reason is end_turn', async () => {
      mockCreate.mockResolvedValue({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hello there!' }],
        usage: MOCK_USAGE,
      });

      const result = await provider.generate([{ role: 'user', content: 'Hi' }]);

      expect(result.type).toBe('text');
      if (result.type === 'text') {
        expect(result.content).toBe('Hello there!');
      }
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it('should return tool calls when stop_reason is tool_use', async () => {
      mockCreate.mockResolvedValue({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'readFile',
            input: { path: 'index.ts' },
          },
        ],
        usage: MOCK_USAGE,
      });

      const result = await provider.generate(
        [{ role: 'user', content: 'Read index.ts' }],
        { tools: [{ name: 'readFile', description: 'Read', parameters: {} }] },
      );

      expect(result.type).toBe('tool_calls');
      if (result.type === 'tool_calls') {
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0]?.name).toBe('readFile');
        expect(result.calls[0]?.arguments).toEqual({ path: 'index.ts' });
      }
    });

    it('passes system prompt and temperature to the SDK', async () => {
      mockCreate.mockResolvedValue({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
        usage: MOCK_USAGE,
      });

      await provider.generate([{ role: 'user', content: 'Test' }], {
        systemPrompt: 'Be helpful.',
        temperature: 0.7,
        model: 'claude-opus-4-20250514',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4-20250514',
          system: 'Be helpful.',
          temperature: 0.7,
        }),
      );
    });

    it('should convert tool_use and tool_result content blocks', async () => {
      mockCreate.mockResolvedValue({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done' }],
        usage: MOCK_USAGE,
      });

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Read the file' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'readFile',
              input: { path: 'a.ts' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'tu_1',
              content: 'file contents',
            },
          ],
        },
      ];

      await provider.generate(messages);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(3);

      // tool_use block
      const assistantMsg = callArgs.messages[1];
      expect(assistantMsg.content[0].type).toBe('tool_use');
      expect(assistantMsg.content[0].name).toBe('readFile');

      // tool_result block
      const toolResultMsg = callArgs.messages[2];
      expect(toolResultMsg.content[0].type).toBe('tool_result');
      expect(toolResultMsg.content[0].tool_use_id).toBe('tu_1');
    });

    it('concatenates multiple text blocks', async () => {
      mockCreate.mockResolvedValue({
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: 'Part 1. ' },
          { type: 'text', text: 'Part 2.' },
        ],
        usage: MOCK_USAGE,
      });

      const result = await provider.generate([{ role: 'user', content: 'Hi' }]);

      if (result.type === 'text') {
        expect(result.content).toBe('Part 1. Part 2.');
      }
    });
  });

  describe('stream', () => {
    it('should yield text deltas and a done event', async () => {
      const events = [
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello' },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: ' world' },
        },
      ];

      mockStream.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) {
            yield e;
          }
        },
        finalMessage: jest.fn().mockResolvedValue({
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });

      const collected = [];
      for await (const event of provider.stream([
        { role: 'user', content: 'Hi' },
      ])) {
        collected.push(event);
      }

      expect(collected).toHaveLength(3);
      expect(collected[0]).toEqual({ type: 'text', text: 'Hello' });
      expect(collected[1]).toEqual({ type: 'text', text: ' world' });
      expect(collected[2]).toEqual({
        type: 'done',
        content: 'Hello world',
        usage: { inputTokens: 10, outputTokens: 5 },
      });
    });

    it('skips non-text-delta events', async () => {
      const events = [
        { type: 'message_start', message: {} },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hi' },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{}' },
        },
      ];

      mockStream.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) {
            yield e;
          }
        },
        finalMessage: jest.fn().mockResolvedValue({
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const collected = [];
      for await (const event of provider.stream([
        { role: 'user', content: 'Hi' },
      ])) {
        collected.push(event);
      }

      // Only the text delta + done
      expect(collected).toHaveLength(2);
      expect(collected[0]).toEqual({ type: 'text', text: 'Hi' });
      expect(collected[1]?.type).toBe('done');
    });

    it('should pass model and options to stream call', async () => {
      mockStream.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {},
        finalMessage: jest.fn().mockResolvedValue({
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      });

      const collected = [];
      for await (const event of provider.stream(
        [{ role: 'user', content: 'Hi' }],
        { model: 'claude-opus-4-20250514', temperature: 0.5, maxTokens: 2048 },
      )) {
        collected.push(event);
      }

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4-20250514',
          temperature: 0.5,
          max_tokens: 2048,
        }),
      );
    });
  });
});
