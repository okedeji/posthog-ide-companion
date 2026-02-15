import type {
  LLMMessage,
  LLMGenerateOptions,
  LLMResponse,
  LLMStreamEvent,
} from './types';

/**
 * Thin wrapper over an LLM SDK.
 *
 * Each provider sends messages to one API and normalizes the response shape.
 * It does NOT run tool loops — that responsibility belongs to the agent layer.
 */
export interface LLMProvider {
  /** Human-readable provider name (e.g. "anthropic", "openai"). */
  readonly name: string;

  /**
   * Sends messages and returns either text or tool calls.
   *
   * @param messages - The conversation history.
   * @param options  - Model, temperature, tools, etc.
   * @returns Text response or tool call requests.
   */
  generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): Promise<LLMResponse>;

  /**
   * Streaming variant — yields text deltas until done.
   * Used for non-tool-use flows where real-time output matters.
   *
   * @param messages - The conversation history.
   * @param options  - Model, temperature, etc.
   * @returns Async iterable of stream events.
   */
  stream(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): AsyncIterable<LLMStreamEvent>;
}
