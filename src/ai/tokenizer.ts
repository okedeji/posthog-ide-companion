import type { LLMMessage, LLMContentBlock } from './types';

// ---------------------------------------------------------------------------
// Token counting — estimates token usage for compaction decisions.
//
// Uses the standard heuristic: 1 token ≈ 4 characters. This is the widely
// accepted approximation for English text and code. For compaction triggers
// (not billing), this is accurate enough — ±20% doesn't matter when we're
// deciding whether to summarize older messages.
//
// Why not a real BPE tokenizer?
// - js-tiktoken is 22 MB and ESM-only (CJS compat issues)
// - CountTokens APIs requires a network roundtrip per count
// - We only need "is this conversation getting too long?" — not exact counts
// ---------------------------------------------------------------------------

/** Average characters per token. Standard approximation for English/code. */
const CHARS_PER_TOKEN = 4;

/** Overhead tokens per message (role, separators, framing). */
const MESSAGE_OVERHEAD = 4;

/** Counts tokens in text and conversation messages. */
export type TokenCounter = {
  /** Estimate the token count for a string of text. */
  countText(text: string): number;
  /** Estimate the total token count for a list of LLM messages. */
  countMessages(messages: readonly LLMMessage[]): number;
};

/**
 * Creates a token counter using the character-based heuristic.
 *
 * Synchronous, zero dependencies, and fast. The ~4 chars/token ratio
 * is well-established for GPT and Claude model families.
 */
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

/**
 * Counts estimated tokens across an array of content blocks.
 * Tool use blocks include the name and serialized arguments.
 * Tool result blocks include the result content.
 */
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
