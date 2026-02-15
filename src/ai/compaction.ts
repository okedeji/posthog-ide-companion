import type { LLMProvider } from './provider';
import type { LLMMessage, CompactionOptions } from './types';
import type { TokenCounter } from './tokenizer';

// ---------------------------------------------------------------------------
// Conversation compaction — keeps context window usage under control.
//
// When the conversation grows long, older messages are summarized into a
// single "conversation so far" message while recent messages are preserved verbatim.
//
// The algorithm:
//   1. Count tokens across all LLM messages.
//   2. If under the threshold → return messages unchanged.
//   3. Otherwise, split into "old" and "recent" (preserveRecentPairs).
//   4. Send old messages to the LLM for summarization.
//   5. Return: [summary message, assistant ack, ...recent messages].
// ---------------------------------------------------------------------------

/** Default compaction thresholds. */
const DEFAULT_MAX_TOKENS = 80_000;
const DEFAULT_PRESERVE_RECENT_PAIRS = 4;

/** Maximum tokens for the summary response itself. */
const SUMMARY_MAX_TOKENS = 1024;

/**
 * Checks whether compaction is needed and compacts if so.
 *
 * @param provider     - LLM provider used to generate the summary.
 * @param messages     - Current LLM conversation messages.
 * @param tokenCounter - Token counter for estimating message sizes.
 * @param options      - Compaction thresholds.
 * @returns The (possibly compacted) message array.
 */
export async function compactIfNeeded(
  provider: LLMProvider,
  messages: LLMMessage[],
  tokenCounter: TokenCounter,
  options?: CompactionOptions,
): Promise<LLMMessage[]> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const preservePairs =
    options?.preserveRecentPairs ?? DEFAULT_PRESERVE_RECENT_PAIRS;

  const totalTokens = tokenCounter.countMessages(messages);

  if (totalTokens <= maxTokens) {
    return messages;
  }

  // Number of individual messages to keep (each pair = user + assistant)
  const preserveCount = preservePairs * 2;

  // Not enough messages to compact — keep everything
  if (messages.length <= preserveCount) {
    return messages;
  }

  const oldMessages = messages.slice(0, messages.length - preserveCount);
  const recentMessages = messages.slice(messages.length - preserveCount);

  const summary = await summarizeMessages(provider, oldMessages);

  // Build the compacted conversation:
  //   1. A user message with the summary (provides context)
  //   2. An assistant acknowledgment (maintains role alternation)
  //   3. The preserved recent messages
  return [
    { role: 'user', content: summary },
    {
      role: 'assistant',
      content:
        'Understood. I have the context from our earlier conversation and will continue from here.',
    },
    ...recentMessages,
  ];
}

/**
 * Asks the LLM to produce a concise summary of the conversation so far.
 * Uses a dedicated system prompt to keep the summary focused and compact.
 */
async function summarizeMessages(
  provider: LLMProvider,
  messages: LLMMessage[],
): Promise<string> {
  const response = await provider.generate(
    [
      {
        role: 'user',
        content: formatMessagesForSummary(messages),
      },
    ],
    {
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      maxTokens: SUMMARY_MAX_TOKENS,
      temperature: 0,
    },
  );

  if (response.type === 'text') {
    return `[Conversation Summary]\n${response.content}`;
  }

  // Fallback if the model tries to call tools during summarization
  return `[Conversation Summary]\n${buildFallbackSummary(messages)}`;
}

/**
 * Formats messages into a readable transcript for the summarizer.
 * Strips tool use/result blocks down to just the tool name and result
 * to keep the summary request small.
 */
function formatMessagesForSummary(messages: LLMMessage[]): string {
  const lines: string[] = ['Please summarize the following conversation:', ''];

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';

    if (typeof msg.content === 'string') {
      lines.push(`${role}: ${msg.content}`);
    } else {
      // Condense content blocks into a readable format
      const parts: string[] = [];
      for (const block of msg.content) {
        switch (block.type) {
          case 'text':
            parts.push(block.text);
            break;
          case 'tool_use':
            parts.push(`[Called tool: ${block.name}]`);
            break;
          case 'tool_result':
            parts.push(`[Tool result: ${truncate(block.content, 200)}]`);
            break;
        }
      }
      lines.push(`${role}: ${parts.join(' ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Builds a basic fallback summary when the LLM can't summarize.
 * Extracts user messages only — good enough to preserve context.
 */
function buildFallbackSummary(messages: LLMMessage[]): string {
  const userMessages = messages
    .filter((m) => m.role === 'user')
    .map((m) => {
      if (typeof m.content === 'string') {
        return m.content;
      }
      // Extract text blocks from content block arrays
      return m.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
    })
    .filter((text) => text.length > 0);

  return `The user discussed: ${userMessages.map((m) => truncate(m, 100)).join('; ')}`;
}

/** Truncates a string to `max` characters with an ellipsis. */
function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max - 1) + '…';
}

/** System prompt for the summarization call. */
const SUMMARY_SYSTEM_PROMPT = [
  'You are a conversation summarizer.',
  'Produce a concise summary of the conversation below.',
  'Focus on:',
  '- What the user asked for',
  '- What was accomplished (decisions made, code changes, files modified)',
  '- Any open questions or unfinished work',
  '',
  'Keep the summary under 500 words. Use bullet points.',
  'Do NOT include greetings or filler. Be direct and factual.',
].join('\n');
