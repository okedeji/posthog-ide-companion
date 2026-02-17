import { OpenAIProvider } from '../openai';
import type { LLMMessage } from '../../types';

// Mock the SDK
const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    responses: { create: mockCreate },
  })),
}));

const MOCK_USAGE = { input_tokens: 80, output_tokens: 40 };

beforeEach(() => {
  mockCreate.mockReset();
});

describe('OpenAIProvider', () => {
  const provider = new OpenAIProvider('sk-test');

  describe('generate', () => {
    it('returns text response when no function calls', async () => {
      mockCreate.mockResolvedValue({
        output: [{ type: 'message', content: [{ type: 'text', text: 'Hi!' }] }],
        output_text: 'Hi!',
        usage: MOCK_USAGE,
      });

      const result = await provider.generate([
        { role: 'user', content: 'Hello' },
      ]);

      expect(result.type).toBe('text');
      if (result.type === 'text') {
        expect(result.content).toBe('Hi!');
      }
      expect(result.usage).toEqual({ inputTokens: 80, outputTokens: 40 });
    });

    it('should return tool calls when function_call items are present', async () => {
      mockCreate.mockResolvedValue({
        output: [
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'fc_1',
            name: 'readFile',
            arguments: '{"path":"index.ts"}',
          },
        ],
        output_text: '',
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

    it('handles malformed JSON arguments with _raw fallback', async () => {
      mockCreate.mockResolvedValue({
        output: [
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'fc_1',
            name: 'readFile',
            arguments: 'not valid json',
          },
        ],
        output_text: '',
        usage: MOCK_USAGE,
      });

      const result = await provider.generate(
        [{ role: 'user', content: 'Read' }],
        { tools: [{ name: 'readFile', description: 'Read', parameters: {} }] },
      );

      if (result.type === 'tool_calls') {
        expect(result.calls[0]?.arguments).toEqual({ _raw: 'not valid json' });
      }
    });

    it('should pass system prompt, temperature, and max tokens', async () => {
      mockCreate.mockResolvedValue({
        output: [],
        output_text: 'ok',
        usage: MOCK_USAGE,
      });

      await provider.generate([{ role: 'user', content: 'Test' }], {
        systemPrompt: 'Be concise.',
        temperature: 0.3,
        maxTokens: 1024,
        model: 'gpt-5.2-pro',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-5.2-pro',
          instructions: 'Be concise.',
          temperature: 0.3,
          max_output_tokens: 1024,
        }),
      );
    });

    it('converts tool_use and tool_result content blocks', async () => {
      mockCreate.mockResolvedValue({
        output: [],
        output_text: 'Done',
        usage: MOCK_USAGE,
      });

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Read the file' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tc_1',
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
              toolUseId: 'tc_1',
              content: 'file contents',
            },
          ],
        },
      ];

      await provider.generate(messages);

      const callArgs = mockCreate.mock.calls[0][0];
      const input = callArgs.input;

      // First item: user text message
      expect(input[0]).toEqual({ role: 'user', content: 'Read the file' });

      // Second item: function_call from assistant
      expect(input[1].type).toBe('function_call');
      expect(input[1].name).toBe('readFile');

      // Third item: function_call_output from user
      expect(input[2].type).toBe('function_call_output');
      expect(input[2].call_id).toBe('tc_1');
      expect(input[2].output).toBe('file contents');
    });

    it('should default to gpt-5.2 when no model specified', async () => {
      mockCreate.mockResolvedValue({
        output: [],
        output_text: 'ok',
        usage: MOCK_USAGE,
      });

      await provider.generate([{ role: 'user', content: 'Hi' }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-5.2' }),
      );
    });

    it('handles missing usage gracefully', async () => {
      mockCreate.mockResolvedValue({
        output: [],
        output_text: 'ok',
        usage: undefined,
      });

      const result = await provider.generate([{ role: 'user', content: 'Hi' }]);

      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    });
  });

  describe('stream', () => {
    it('should yield text deltas and a done event', async () => {
      const events = [
        { type: 'response.output_text.delta', delta: 'Hello' },
        { type: 'response.output_text.delta', delta: ' world' },
        {
          type: 'response.completed',
          response: { usage: { input_tokens: 20, output_tokens: 10 } },
        },
      ];

      mockCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) {
            yield e;
          }
        },
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
        usage: { inputTokens: 20, outputTokens: 10 },
      });
    });

    it('handles missing usage in completed event', async () => {
      const events = [
        { type: 'response.output_text.delta', delta: 'ok' },
        { type: 'response.completed', response: { usage: undefined } },
      ];

      mockCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) {
            yield e;
          }
        },
      });

      const collected = [];
      for await (const event of provider.stream([
        { role: 'user', content: 'Hi' },
      ])) {
        collected.push(event);
      }

      expect(collected[1]).toEqual({
        type: 'done',
        content: 'ok',
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    });

    it('should pass stream: true and options to the SDK', async () => {
      mockCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {},
      });

      const collected = [];
      for await (const event of provider.stream(
        [{ role: 'user', content: 'Hi' }],
        { model: 'gpt-5.2-pro', temperature: 0.2 },
      )) {
        collected.push(event);
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-5.2-pro',
          stream: true,
          temperature: 0.2,
        }),
      );
    });
  });
});
