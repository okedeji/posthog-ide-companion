import { createTokenCounter } from '../tokenizer';
import type { LLMMessage } from '../types';

describe('TokenCounter', () => {
  const counter = createTokenCounter();

  describe('countText', () => {
    it('should return 0 for empty string', () => {
      expect(counter.countText('')).toBe(0);
    });

    it('counts tokens for simple text', () => {
      // "Hello, world!" = 13 chars → ceil(13 / 4) = 4 tokens
      const count = counter.countText('Hello, world!');
      expect(count).toBe(4);
    });

    it('should count more tokens for longer text', () => {
      const short = counter.countText('Hi');
      const long = counter.countText(
        'This is a much longer piece of text that should produce more tokens',
      );
      expect(long).toBeGreaterThan(short);
    });

    it('handles code content', () => {
      // 36 chars → ceil(36 / 4) = 9 tokens
      const code = 'function hello() { return "world"; }';
      expect(counter.countText(code)).toBe(9);
    });
  });

  describe('countMessages', () => {
    it('should return 0 for empty message list', () => {
      expect(counter.countMessages([])).toBe(0);
    });

    it('counts tokens in string content messages', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' }, // 4 overhead + ceil(5/4)=2 = 6
        { role: 'assistant', content: 'Hi there!' }, // 4 overhead + ceil(9/4)=3 = 7
      ];

      expect(counter.countMessages(messages)).toBe(13);
    });

    it('should count tokens in content block messages', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          // 4 overhead + text(23 chars→6) + tool name(8→2) + tool input JSON(23→6) = 18
          content: [
            { type: 'text', text: 'Let me check that file.' },
            {
              type: 'tool_use',
              id: 'tc1',
              name: 'readFile',
              input: { path: '/src/index.ts' },
            },
          ],
        },
        {
          role: 'user',
          // 4 overhead + tool result(14 chars→4) = 8
          content: [
            {
              type: 'tool_result',
              toolUseId: 'tc1',
              content: 'const x = 42;',
            },
          ],
        },
      ];

      expect(counter.countMessages(messages)).toBe(26);
    });

    it('includes per-message overhead', () => {
      const singleMessage: LLMMessage[] = [
        { role: 'user', content: 'Hi' }, // 4 overhead + ceil(2/4)=1 = 5
      ];
      const twoMessages: LLMMessage[] = [
        { role: 'user', content: 'Hi' }, // 5
        { role: 'assistant', content: 'Hi' }, // 5
      ];

      expect(counter.countMessages(singleMessage)).toBe(5);
      expect(counter.countMessages(twoMessages)).toBe(10);
    });

    it('should scale with conversation length', () => {
      const short: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ];

      const long: LLMMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message number ${i + 1} with some additional content to make it longer`,
      }));

      expect(counter.countMessages(long)).toBeGreaterThan(
        counter.countMessages(short),
      );
    });
  });
});
