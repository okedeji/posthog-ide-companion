import { createTokenCounter } from '../tokenizer';
import type { LLMMessage } from '../types';

describe('TokenCounter', () => {
  const counter = createTokenCounter();

  describe('countText', () => {
    it('counts tokens for simple text', () => {
      // "Hello, world!" = 13 chars → ceil(13 / 4) = 4 tokens
      const count = counter.countText('Hello, world!');
      expect(count).toBe(4);
    });
  });

  describe('countMessages', () => {
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
  });
});
