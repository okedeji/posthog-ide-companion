import type {
  LLMMessage,
  LLMGenerateOptions,
  LLMResponse,
  LLMStreamEvent,
} from './types';

// Thin wrapper over an LLM SDK. Does NOT run tool loops - that's the agent layer.
export interface LLMProvider {
  readonly name: string;

  generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): Promise<LLMResponse>;

  stream(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): AsyncIterable<LLMStreamEvent>;
}
