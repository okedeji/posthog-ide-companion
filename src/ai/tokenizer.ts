import type { LLMMessage, LLMContentBlock } from './types';

// Estimates token usage for compaction decisions. Uses the ~4 chars/token
// heuristic, which is plenty for "is this conversation too long?" checks.
// Not worth pulling in a real BPE tokenizer (js-tiktoken is 22MB + ESM-only).

const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD = 4;

export type TokenCounter = {
  /** Estimate the token count for a string of text. */
  countText(text: string): number;
  /** Estimate the total token count for a list of LLM messages. */
  countMessages(messages: readonly LLMMessage[]): number;
};

export function createTokenCounter(): TokenCounter {
  return {
    countText(text: string): number {
      if (text.length === 0) {
        return 0;
      }
      return Math.ceil(text.length / CHARS_PER_TOKEN);
    },

    countMessages(messages: readonly LLMMessage[]): number {
      let total = 0;

      for (const message of messages) {
        total += MESSAGE_OVERHEAD;

        if (typeof message.content === 'string') {
          total += Math.ceil(message.content.length / CHARS_PER_TOKEN);
        } else {
          total += countContentBlocks(message.content);
        }
      }

      return total;
    },
  };
}

function countContentBlocks(blocks: LLMContentBlock[]): number {
  let total = 0;

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        total += Math.ceil(block.text.length / CHARS_PER_TOKEN);
        break;
      case 'tool_use':
        total += Math.ceil(block.name.length / CHARS_PER_TOKEN);
        total += Math.ceil(
          JSON.stringify(block.input).length / CHARS_PER_TOKEN,
        );
        break;
      case 'tool_result':
        total += Math.ceil(block.content.length / CHARS_PER_TOKEN);
        break;
    }
  }

  return total;
}
