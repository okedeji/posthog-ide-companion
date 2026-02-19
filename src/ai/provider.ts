import type {
  LLMMessage,
  LLMGenerateOptions,
  LLMResponse,
  LLMStreamEvent,
} from './types';

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
