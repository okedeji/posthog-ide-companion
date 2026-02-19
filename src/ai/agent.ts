import type { LLMProvider } from './provider';
import type {
  LLMMessage,
  LLMResponse,
  LLMGenerateOptions,
  ToolDefinition,
  ToolExecutor,
  AgentLoopOptions,
  AgentResult,
  TokenUsage,
  AgentEventCallback,
} from './types';

const DEFAULT_MAX_ITERATIONS = 10;

export async function runAgentLoop(
  provider: LLMProvider,
  messages: LLMMessage[],
  tools: ToolDefinition[],
  executor: ToolExecutor,
  options?: AgentLoopOptions,
): Promise<AgentResult> {
  const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const conversation: LLMMessage[] = [...messages];
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let iterations = 0;

  const emit: AgentEventCallback = options?.onEvent ?? noop;

  const signal = options?.signal;

  while (iterations < maxIterations) {
    if (signal?.aborted) {
      break;
    }

    iterations++;
    emit({ type: 'iteration_start', iteration: iterations, maxIterations });

    const generateOptions: LLMGenerateOptions = {
      model: options?.model,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
      systemPrompt: options?.systemPrompt,
      tools,
    };

    let response: LLMResponse;
    try {
      if (options?.enableStreaming) {
        response = await consumeStream(
          provider,
          conversation,
          generateOptions,
          emit,
          signal,
        );
      } else {
        response = await provider.generate(conversation, generateOptions);
      }
    } catch (err) {
      if (signal?.aborted) {
        break;
      }
      emit({ type: 'error', error: errorMessage(err) });
      throw err;
    }

    totalUsage.inputTokens += response.usage.inputTokens;
    totalUsage.outputTokens += response.usage.outputTokens;

    if (response.type === 'text') {
      const content = signal?.aborted
        ? response.content + '\n\n*Interrupted.*'
        : response.content;
      emit({ type: 'text_response', content, isFinal: true });
      const result: AgentResult = { content, totalUsage, iterations };
      emit({ type: 'complete', result });
      return result;
    }

    if (signal?.aborted) {
      break;
    }

    conversation.push({
      role: 'assistant',
      content: response.calls.map((call) => ({
        type: 'tool_use' as const,
        id: call.id,
        name: call.name,
        input: call.arguments,
      })),
    });

    const results = await Promise.all(
      response.calls.map(async (call) => {
        emit({ type: 'tool_call_start', call });
        const start = Date.now();
        let content: string;

        // Consent gate: tools with requiresConsent must be approved before execution
        const needsConsent = tools.find(
          (t) => t.name === call.name,
        )?.requiresConsent;
        if (needsConsent) {
          const decision = options?.onConsent
            ? await options.onConsent(call)
            : { action: 'reject' as const };

          if (decision.action === 'reject') {
            content = `Tool ${call.name} was rejected by the user.`;
            const durationMs = Date.now() - start;
            emit({
              type: 'tool_call_result',
              call,
              result: content,
              durationMs,
            });
            return {
              type: 'tool_result' as const,
              toolUseId: call.id,
              content,
            };
          }

          if (decision.action === 'respond') {
            content = decision.message;
            const durationMs = Date.now() - start;
            emit({
              type: 'tool_call_result',
              call,
              result: content,
              durationMs,
              feedback: decision.message,
            });
            return {
              type: 'tool_result' as const,
              toolUseId: call.id,
              content,
            };
          }
        }

        try {
          content = await executor(call);
        } catch (err) {
          content = `Error executing tool ${call.name}: ${errorMessage(err)}`;
          emit({ type: 'error', error: content });
        }
        const durationMs = Date.now() - start;
        emit({ type: 'tool_call_result', call, result: content, durationMs });
        return {
          type: 'tool_result' as const,
          toolUseId: call.id,
          content,
        };
      }),
    );

    conversation.push({ role: 'user', content: results });
  }

  if (signal?.aborted) {
    emit({
      type: 'text_response',
      content: '*Interrupted.*',
      isFinal: true,
    });
    const result: AgentResult = {
      content: 'Interrupted.',
      totalUsage,
      iterations,
    };
    emit({ type: 'complete', result });
    return result;
  }

  return forceTextResponse(
    provider,
    conversation,
    totalUsage,
    iterations,
    emit,
    options,
  );
}

async function consumeStream(
  provider: LLMProvider,
  messages: LLMMessage[],
  options: LLMGenerateOptions,
  emit: AgentEventCallback,
  signal?: AbortSignal,
): Promise<LLMResponse> {
  let accumulated = '';

  for await (const event of provider.stream(messages, options)) {
    if (signal?.aborted) {
      break;
    }

    if (event.type === 'text') {
      accumulated += event.text;
      emit({ type: 'text_response', content: accumulated, isFinal: false });
    } else if (event.type === 'tool_calls') {
      return { type: 'tool_calls', calls: event.calls, usage: event.usage };
    } else if (event.type === 'done') {
      return { type: 'text', content: event.content, usage: event.usage };
    }
  }

  // Fallback: stream ended without done/tool_calls (or aborted mid-stream)
  return {
    type: 'text',
    content: accumulated,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

async function forceTextResponse(
  provider: LLMProvider,
  conversation: LLMMessage[],
  totalUsage: TokenUsage,
  iterations: number,
  emit: AgentEventCallback,
  options?: AgentLoopOptions,
): Promise<AgentResult> {
  conversation.push({
    role: 'user',
    content:
      'You have reached the maximum number of tool calls. ' +
      'Please summarize what you have found and accomplished so far ' +
      'based on the tool results above.',
  });

  const generateOptions: LLMGenerateOptions = {
    model: options?.model,
    maxTokens: options?.maxTokens,
    temperature: options?.temperature,
    systemPrompt: options?.systemPrompt,
  };

  let response: LLMResponse;
  try {
    if (options?.enableStreaming) {
      response = await consumeStream(
        provider,
        conversation,
        generateOptions,
        emit,
        options?.signal,
      );
    } else {
      response = await provider.generate(conversation, generateOptions);
    }
  } catch (err) {
    emit({ type: 'error', error: errorMessage(err) });
    throw err;
  }

  totalUsage.inputTokens += response.usage.inputTokens;
  totalUsage.outputTokens += response.usage.outputTokens;

  const content =
    response.type === 'text'
      ? response.content
      : 'Unable to generate a summary after reaching the iteration limit.';

  emit({ type: 'text_response', content, isFinal: true });
  const result: AgentResult = { content, totalUsage, iterations };
  emit({ type: 'complete', result });
  return result;
}

function noop(): void {}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
