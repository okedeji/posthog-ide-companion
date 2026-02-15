import type { LLMProvider } from './provider';
import type {
  LLMMessage,
  ToolDefinition,
  ToolExecutor,
  AgentLoopOptions,
  AgentResult,
  TokenUsage,
  AgentEventCallback,
} from './types';

/** Safety limit to prevent runaway tool loops. */
const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Runs the standard agentic tool-use loop.
 *
 * Sends messages + tool definitions to the provider. If the provider
 * returns tool calls, executes them, appends results, and sends again.
 * Repeats until the provider returns text or the iteration limit is hit.
 *
 * When the limit is reached, makes one final call without tools to force
 * the LLM to summarize what it has accomplished so far.
 *
 * @param provider - The LLM provider to call.
 * @param messages - Initial conversation messages.
 * @param tools    - Tool definitions available to the LLM.
 * @param executor - Executes tool calls and returns string results.
 * @param options  - Max iterations, model overrides, event callbacks, etc.
 * @returns The final text response with cumulative usage stats.
 */
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

  while (iterations < maxIterations) {
    iterations++;
    emit({ type: 'iteration_start', iteration: iterations, maxIterations });

    let response;
    try {
      response = await provider.generate(conversation, {
        model: options?.model,
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
        systemPrompt: options?.systemPrompt,
        tools,
      });
    } catch (err) {
      emit({ type: 'error', error: errorMessage(err) });
      throw err;
    }

    totalUsage.inputTokens += response.usage.inputTokens;
    totalUsage.outputTokens += response.usage.outputTokens;

    if (response.type === 'text') {
      emit({ type: 'text_response', content: response.content, isFinal: true });
      const result: AgentResult = {
        content: response.content,
        totalUsage,
        iterations,
      };
      emit({ type: 'complete', result });
      return result;
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

    // TODO: run sequentially once we add write tools (file edits, env mutations)
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

  // Hit the iteration limit, force a text summary
  return forceTextResponse(
    provider,
    conversation,
    totalUsage,
    iterations,
    emit,
    options,
  );
}

/**
 * Makes one final call without tools, forcing the LLM to respond with
 * text summarizing what has been accomplished so far.
 */
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

  let response;
  try {
    response = await provider.generate(conversation, {
      model: options?.model,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
      systemPrompt: options?.systemPrompt,
    });
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
