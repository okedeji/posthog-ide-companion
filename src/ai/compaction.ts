import type { LLMProvider } from './provider';
import type { LLMMessage, CompactionOptions } from './types';
import type { TokenCounter } from './tokenizer';

// When the conversation grows long, older messages are summarized into a single
// "conversation so far" message while recent messages are preserved verbatim.

// Tuned down from 100k after hitting context errors in testing.
const DEFAULT_MAX_TOKENS = 80_000;
const DEFAULT_PRESERVE_RECENT_PAIRS = 4;
const SUMMARY_MAX_TOKENS = 1024;

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

  if (messages.length <= preserveCount) {
    return messages;
  }

  const oldMessages = messages.slice(0, messages.length - preserveCount);
  const recentMessages = messages.slice(messages.length - preserveCount);

  const summary = await summarizeMessages(provider, oldMessages);

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

function formatMessagesForSummary(messages: LLMMessage[]): string {
  const lines: string[] = ['Please summarize the following conversation:', ''];

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';

    if (typeof msg.content === 'string') {
      lines.push(`${role}: ${msg.content}`);
    } else {
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

function buildFallbackSummary(messages: LLMMessage[]): string {
  const userMessages = messages
    .filter((m) => m.role === 'user')
    .map((m) => {
      if (typeof m.content === 'string') {
        return m.content;
      }
      return m.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
    })
    .filter((text) => text.length > 0);

  return `The user discussed: ${userMessages.map((m) => truncate(m, 100)).join('; ')}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max - 1) + '…';
}

const SUMMARY_SYSTEM_PROMPT = [
  'You are summarizing a PostHog IDE assistant conversation for context preservation.',
  '',
  'Produce a concise summary covering:',
  '- What the user asked for',
  '- What was accomplished (decisions made, code changes, files modified)',
  '- Key tool results or data retrieved',
  '- Any open questions or unfinished work',
  '',
  'Rules:',
  '- Under 500 words. Use bullet points.',
  '- Be direct and factual — no greetings or filler.',
  '- Preserve specific details (file paths, function names, error messages, PostHog event names) that the assistant will need to continue the conversation.',
].join('\n');
