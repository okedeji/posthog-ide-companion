import OpenAI from 'openai';
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

export const DEFAULT_OPENAI_MODEL = 'gpt-5.2';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): Promise<LLMResponse> {
    const response = await this.client.responses.create({
      model: options?.model ?? DEFAULT_OPENAI_MODEL,
      input: toOpenAIInput(messages),
      ...(options?.systemPrompt && { instructions: options.systemPrompt }),
      ...(options?.tools?.length && {
        tools: options.tools.map(toOpenAITool),
      }),
      ...(options?.temperature !== undefined && {
        temperature: options.temperature,
      }),
      ...(options?.maxTokens && {
        max_output_tokens: options.maxTokens,
      }),
    });

    const usage: TokenUsage = {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };

    const functionCalls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
        item.type === 'function_call',
    );

    if (functionCalls.length > 0) {
      return {
        type: 'tool_calls',
        calls: mapFunctionCalls(functionCalls),
        usage,
      };
    }

    return {
      type: 'text',
      content: response.output_text,
      usage,
    };
  }

  async *stream(
    messages: LLMMessage[],
    options?: LLMGenerateOptions,
  ): AsyncIterable<LLMStreamEvent> {
    const stream = await this.client.responses.create({
      model: options?.model ?? DEFAULT_OPENAI_MODEL,
      input: toOpenAIInput(messages),
      stream: true,
      ...(options?.systemPrompt && { instructions: options.systemPrompt }),
      ...(options?.tools?.length && {
        tools: options.tools.map(toOpenAITool),
      }),
      ...(options?.temperature !== undefined && {
        temperature: options.temperature,
      }),
      ...(options?.maxTokens && {
        max_output_tokens: options.maxTokens,
      }),
    });

    let fullText = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const functionCalls = new Map<
      string,
      { id: string; callId: string; name: string; argParts: string[] }
    >();

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        fullText += event.delta;
        yield { type: 'text', text: event.delta };
      } else if (
        event.type === 'response.output_item.added' &&
        event.item.type === 'function_call'
      ) {
        const item = event.item;
        const key = item.id ?? item.call_id;
        functionCalls.set(key, {
          id: item.id ?? '',
          callId: item.call_id,
          name: item.name,
          argParts: [],
        });
      } else if (event.type === 'response.function_call_arguments.delta') {
        const fc = functionCalls.get(event.item_id);
        if (fc) {
          fc.argParts.push(event.delta);
        }
      } else if (event.type === 'response.completed') {
        usage = {
          inputTokens: event.response.usage?.input_tokens ?? 0,
          outputTokens: event.response.usage?.output_tokens ?? 0,
        };
      }
    }

    if (functionCalls.size > 0) {
      const calls: ToolCall[] = Array.from(functionCalls.values()).map(
        (fc) => ({
          id: fc.callId || fc.id,
          name: fc.name,
          arguments: safeParse(fc.argParts.join('')),
        }),
      );
      yield { type: 'tool_calls', calls, usage };
    } else {
      yield { type: 'done', content: fullText, usage };
    }
  }
}

function toOpenAIInput(messages: LLMMessage[]): OpenAI.Responses.ResponseInput {
  const input: OpenAI.Responses.ResponseInputItem[] = [];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      input.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      });
      continue;
    }

    for (const block of msg.content) {
      pushContentBlock(input, block, msg.role);
    }
  }

  return input;
}

function pushContentBlock(
  input: OpenAI.Responses.ResponseInputItem[],
  block: LLMContentBlock,
  role: string,
): void {
  switch (block.type) {
    case 'text':
      input.push({
        role: role === 'assistant' ? 'assistant' : 'user',
        content: block.text,
      });
      break;
    case 'tool_use':
      input.push({
        type: 'function_call',
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input),
        call_id: block.id,
        // The Responses API type defs don't include function_call as a valid
        // input item, but the API accepts it. Cast until the SDK catches up.
      } as OpenAI.Responses.ResponseInputItem);
      break;
    case 'tool_result':
      input.push({
        type: 'function_call_output',
        call_id: block.toolUseId,
        output: block.content,
      } as OpenAI.Responses.ResponseInputItem);
      break;
  }
}

function toOpenAITool(tool: ToolDefinition): OpenAI.Responses.FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  };
}

function mapFunctionCalls(
  calls: OpenAI.Responses.ResponseFunctionToolCall[],
): ToolCall[] {
  return calls.map((call) => ({
    id: call.id ?? call.call_id ?? '',
    name: call.name,
    arguments: safeParse(call.arguments),
  }));
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { _raw: json };
  }
}
