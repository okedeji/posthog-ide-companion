import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from '../provider';
import type {
  LLMMessage,
  LLMContentBlock,
  LLMGenerateOptions,
  LLMResponse,
  LLMStreamEvent,
  ToolDefinition,
  ToolCall,
  TokenUsage,
} from '../types';

/** Default model when none is specified during setup. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';

const DEFAULT_MAX_TOKENS = 4096;

/**
 * LLM provider backed by the Anthropic Messages API.
 *
 * Wraps `@anthropic-ai/sdk`. Converts our normalized message and tool
 * types to Anthropic's format and back. Does not run tool loops.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  /** @param apiKey - Anthropic API key (e.g. "sk-ant-..."). */
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: options?.model ?? DEFAULT_ANTHROPIC_MODEL,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toAnthropicMessages(messages),
      ...(options?.systemPrompt && { system: options.systemPrompt }),
      ...(options?.tools?.length && {
        tools: options.tools.map(toAnthropicTool),
      }),
      ...(options?.temperature !== undefined && {
        temperature: options.temperature,
      }),
    });

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };

    if (response.stop_reason === 'tool_use') {
      return { type: 'tool_calls', calls: extractToolCalls(response), usage };
    }

    return { type: 'text', content: extractText(response), usage };
  }

  async *stream(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): AsyncIterable<LLMStreamEvent> {
    const stream = this.client.messages.stream({
      model: options?.model ?? DEFAULT_ANTHROPIC_MODEL,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toAnthropicMessages(messages),
      ...(options?.systemPrompt && { system: options.systemPrompt }),
      ...(options?.temperature !== undefined && {
        temperature: options.temperature,
      }),
    });

    let fullText = '';

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        fullText += event.delta.text;
        yield { type: 'text', text: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();
    yield {
      type: 'done',
      content: fullText,
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      },
    };
  }
}

function toAnthropicMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
  return messages.map((msg): Anthropic.MessageParam => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    return {
      role: msg.role,
      content: msg.content.map(toAnthropicContentBlock),
    };
  });
}

function toAnthropicContentBlock(
  block: LLMContentBlock,
): Anthropic.ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
      };
  }
}

function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    // Structurally compatible, but the SDK wants its own branded type
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
  };
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function extractToolCalls(response: Anthropic.Message): ToolCall[] {
  return response.content
    .filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: block.input as Record<string, unknown>,
    }));
}
