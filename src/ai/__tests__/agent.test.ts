import { runAgentLoop } from '../agent';
import type { LLMProvider } from '../provider';
import type {
  LLMMessage,
  LLMResponse,
  LLMStreamEvent,
  LLMGenerateOptions,
  ToolDefinition,
  ToolCall,
  AgentEvent,
  ConsentDecision,
} from '../types';

const USAGE = { inputTokens: 10, outputTokens: 5 };

function createMockProvider(
  responses: LLMResponse[],
): LLMProvider & { calls: LLMMessage[][] } {
  const calls: LLMMessage[][] = [];
  let callIndex = 0;

  return {
    name: 'mock',
    calls,
    generate: async (
      messages: LLMMessage[],
      _options?: LLMGenerateOptions,
    ): Promise<LLMResponse> => {
      calls.push([...messages]);
      const response = responses[callIndex];
      if (!response) {
        throw new Error('Mock provider ran out of responses');
      }
      callIndex++;
      return response;
    },
    async *stream() {
      yield { type: 'done', content: '', usage: USAGE };
    },
  };
}

const SAMPLE_TOOLS: ToolDefinition[] = [
  {
    name: 'readFile',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

const mockExecutor = async (call: ToolCall): Promise<string> => {
  if (call.name === 'readFile') {
    return `Contents of ${String(call.arguments['path'])}`;
  }
  return 'Unknown tool';
};

describe('runAgentLoop', () => {
  it('returns immediately when provider responds with text', async () => {
    const provider = createMockProvider([
      { type: 'text', content: 'Hello!', usage: USAGE },
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Hi' }],
      SAMPLE_TOOLS,
      mockExecutor,
    );

    expect(result.content).toBe('Hello!');
    expect(result.iterations).toBe(1);
    expect(result.totalUsage).toEqual(USAGE);
  });

  it('executes tool calls and continues until text response', async () => {
    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [
          { id: 'tc1', name: 'readFile', arguments: { path: 'index.ts' } },
        ],
        usage: USAGE,
      },
      { type: 'text', content: 'Found the file!', usage: USAGE },
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Read index.ts' }],
      SAMPLE_TOOLS,
      mockExecutor,
    );

    expect(result.content).toBe('Found the file!');
    expect(result.iterations).toBe(2);
    expect(result.totalUsage).toEqual({
      inputTokens: 20,
      outputTokens: 10,
    });
  });

  it('should append tool use and tool result messages to conversation', async () => {
    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [
          { id: 'tc1', name: 'readFile', arguments: { path: 'main.py' } },
        ],
        usage: USAGE,
      },
      { type: 'text', content: 'Done', usage: USAGE },
    ]);

    await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Read main.py' }],
      SAMPLE_TOOLS,
      mockExecutor,
    );

    // Second call should include original message + tool use + tool result
    const secondCall = provider.calls[1];
    expect(secondCall).toBeDefined();
    expect(secondCall).toHaveLength(3);

    // Assistant message with tool_use block
    const assistantMsg = secondCall![1];
    expect(assistantMsg?.role).toBe('assistant');
    expect(Array.isArray(assistantMsg?.content)).toBe(true);

    // User message with tool_result block
    const toolResultMsg = secondCall![2];
    expect(toolResultMsg?.role).toBe('user');
  });

  it('handles multiple tool calls in parallel', async () => {
    const executedCalls: string[] = [];
    const parallelExecutor = async (call: ToolCall): Promise<string> => {
      executedCalls.push(call.name);
      return `Result for ${call.name}`;
    };

    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [
          { id: 'tc1', name: 'readFile', arguments: { path: 'a.ts' } },
          { id: 'tc2', name: 'readFile', arguments: { path: 'b.ts' } },
        ],
        usage: USAGE,
      },
      { type: 'text', content: 'Both read', usage: USAGE },
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Read both files' }],
      SAMPLE_TOOLS,
      parallelExecutor,
    );

    expect(result.content).toBe('Both read');
    expect(executedCalls).toHaveLength(2);
  });

  it('forces a text summary when max iterations is exceeded', async () => {
    // All responses are tool calls, so we'll hit the iteration limit
    const toolResponse: LLMResponse = {
      type: 'tool_calls',
      calls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'loop.ts' } }],
      usage: USAGE,
    };

    const provider = createMockProvider([
      toolResponse,
      toolResponse,
      // After 2 iterations, forced text call
      { type: 'text', content: 'Here is what I found so far...', usage: USAGE },
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Analyze' }],
      SAMPLE_TOOLS,
      mockExecutor,
      { maxIterations: 2 },
    );

    expect(result.content).toBe('Here is what I found so far...');
    expect(result.iterations).toBe(2);
  });

  it('accumulates usage across iterations', async () => {
    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'a.ts' } }],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      {
        type: 'text',
        content: 'Done',
        usage: { inputTokens: 200, outputTokens: 100 },
      },
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Go' }],
      SAMPLE_TOOLS,
      mockExecutor,
    );

    expect(result.totalUsage).toEqual({
      inputTokens: 300,
      outputTokens: 150,
    });
  });

  it('should pass options to the provider', async () => {
    let capturedOptions: LLMGenerateOptions | undefined;

    const provider: LLMProvider = {
      name: 'mock',
      generate: async (
        _messages: LLMMessage[],
        options?: LLMGenerateOptions,
      ): Promise<LLMResponse> => {
        capturedOptions = options;
        return { type: 'text', content: 'ok', usage: USAGE };
      },
      async *stream() {
        yield { type: 'done', content: '', usage: USAGE };
      },
    };

    await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Test' }],
      SAMPLE_TOOLS,
      mockExecutor,
      {
        model: 'custom-model',
        maxTokens: 2048,
        temperature: 0.5,
        systemPrompt: 'You are helpful.',
      },
    );

    expect(capturedOptions?.model).toBe('custom-model');
    expect(capturedOptions?.maxTokens).toBe(2048);
    expect(capturedOptions?.temperature).toBe(0.5);
    expect(capturedOptions?.systemPrompt).toBe('You are helpful.');
    expect(capturedOptions?.tools).toEqual(SAMPLE_TOOLS);
  });
});

describe('agent events', () => {
  it('should emit iteration_start, text_response, and complete for text response', async () => {
    const events: AgentEvent[] = [];
    const provider = createMockProvider([
      { type: 'text', content: 'Hello!', usage: USAGE },
    ]);

    await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Hi' }],
      SAMPLE_TOOLS,
      mockExecutor,
      { onEvent: (e) => events.push(e) },
    );

    expect(events).toHaveLength(3);
    expect(events[0]?.type).toBe('iteration_start');
    expect(events[1]?.type).toBe('text_response');
    expect(events[2]?.type).toBe('complete');
  });

  it('should emit tool_call_start and tool_call_result events', async () => {
    const events: AgentEvent[] = [];
    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'a.ts' } }],
        usage: USAGE,
      },
      { type: 'text', content: 'Done', usage: USAGE },
    ]);

    await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Read' }],
      SAMPLE_TOOLS,
      mockExecutor,
      { onEvent: (e) => events.push(e) },
    );

    const toolStart = events.find((e) => e.type === 'tool_call_start');
    const toolResult = events.find((e) => e.type === 'tool_call_result');
    expect(toolStart).toBeDefined();
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_call_result') {
      expect(toolResult.call.name).toBe('readFile');
      expect(toolResult.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('should include iteration info in iteration_start events', async () => {
    const events: AgentEvent[] = [];
    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'a.ts' } }],
        usage: USAGE,
      },
      { type: 'text', content: 'Done', usage: USAGE },
    ]);

    await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Go' }],
      SAMPLE_TOOLS,
      mockExecutor,
      { onEvent: (e) => events.push(e), maxIterations: 5 },
    );

    const starts = events.filter((e) => e.type === 'iteration_start');
    expect(starts).toHaveLength(2);
    if (starts[0]?.type === 'iteration_start') {
      expect(starts[0].iteration).toBe(1);
      expect(starts[0].maxIterations).toBe(5);
    }
    if (starts[1]?.type === 'iteration_start') {
      expect(starts[1].iteration).toBe(2);
    }
  });

  it('should emit events for forced text response on max iterations', async () => {
    const events: AgentEvent[] = [];
    const toolResponse: LLMResponse = {
      type: 'tool_calls',
      calls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'loop.ts' } }],
      usage: USAGE,
    };

    const provider = createMockProvider([
      toolResponse,
      toolResponse,
      { type: 'text', content: 'Summary', usage: USAGE },
    ]);

    await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Analyze' }],
      SAMPLE_TOOLS,
      mockExecutor,
      { onEvent: (e) => events.push(e), maxIterations: 2 },
    );

    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
    if (complete?.type === 'complete') {
      expect(complete.result.content).toBe('Summary');
    }
  });

  it('works without an onEvent callback', async () => {
    const provider = createMockProvider([
      { type: 'text', content: 'Hello!', usage: USAGE },
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Hi' }],
      SAMPLE_TOOLS,
      mockExecutor,
    );

    expect(result.content).toBe('Hello!');
  });

  it('emits error event and re-throws when LLM call fails', async () => {
    const events: AgentEvent[] = [];
    const provider: LLMProvider = {
      name: 'mock',
      generate: async () => {
        throw new Error('API rate limited');
      },
      async *stream() {
        yield { type: 'done', content: '', usage: USAGE };
      },
    };

    await expect(
      runAgentLoop(
        provider,
        [{ role: 'user', content: 'Hi' }],
        SAMPLE_TOOLS,
        mockExecutor,
        { onEvent: (e) => events.push(e) },
      ),
    ).rejects.toThrow('API rate limited');

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'error') {
      expect(errorEvent.error).toBe('API rate limited');
    }
  });

  it('should emit error event and continue when tool executor throws', async () => {
    const events: AgentEvent[] = [];
    const failingExecutor = async (call: ToolCall): Promise<string> => {
      if (call.name === 'readFile') {
        throw new Error('Permission denied');
      }
      return 'ok';
    };

    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [
          { id: 'tc1', name: 'readFile', arguments: { path: '/etc/shadow' } },
        ],
        usage: USAGE,
      },
      { type: 'text', content: 'Tool failed, sorry.', usage: USAGE },
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Read that file' }],
      SAMPLE_TOOLS,
      failingExecutor,
      { onEvent: (e) => events.push(e) },
    );

    // Should complete without throwing
    expect(result.content).toBe('Tool failed, sorry.');

    // Error event should have been emitted
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'error') {
      expect(errorEvent.error).toContain('Permission denied');
      expect(errorEvent.error).toContain('readFile');
    }

    // Error string should have been sent to the LLM as tool_result
    const secondCall = provider.calls[1];
    const toolResultMsg = secondCall![2];
    expect(toolResultMsg?.role).toBe('user');
    if (Array.isArray(toolResultMsg?.content)) {
      const block = toolResultMsg.content[0];
      if (block?.type === 'tool_result') {
        expect(block.content).toContain('Error executing tool readFile');
      }
    }
  });
});

const CONSENT_TOOLS: ToolDefinition[] = [
  {
    name: 'writeFile',
    description: 'Write a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    requiresConsent: true,
  },
  ...SAMPLE_TOOLS, // readFile does not require consent
];

describe('consent', () => {
  it('should execute normally when user approves', async () => {
    const onConsent = async (_call: ToolCall): Promise<ConsentDecision> => ({
      action: 'approve',
    });

    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [
          {
            id: 'tc1',
            name: 'writeFile',
            arguments: { path: 'a.ts', content: 'hello' },
          },
        ],
        usage: USAGE,
      },
      { type: 'text', content: 'Written!', usage: USAGE },
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Write the file' }],
      CONSENT_TOOLS,
      mockExecutor,
      { onConsent },
    );

    expect(result.content).toBe('Written!');
  });

  it('should skip execution and return rejection when user rejects', async () => {
    const executedCalls: string[] = [];
    const trackingExecutor = async (call: ToolCall): Promise<string> => {
      executedCalls.push(call.name);
      return 'done';
    };

    const onConsent = async (_call: ToolCall): Promise<ConsentDecision> => ({
      action: 'reject',
    });

    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [
          {
            id: 'tc1',
            name: 'writeFile',
            arguments: { path: 'a.ts', content: 'bad' },
          },
        ],
        usage: USAGE,
      },
      { type: 'text', content: 'Ok, skipped.', usage: USAGE },
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Write the file' }],
      CONSENT_TOOLS,
      trackingExecutor,
      { onConsent },
    );

    expect(result.content).toBe('Ok, skipped.');
    expect(executedCalls).toHaveLength(0);

    // LLM should have received the rejection as a tool_result
    const secondCall = provider.calls[1];
    const toolResultMsg = secondCall![2];
    if (Array.isArray(toolResultMsg?.content)) {
      const block = toolResultMsg.content[0];
      if (block?.type === 'tool_result') {
        expect(block.content).toContain('rejected');
      }
    }
  });

  it('should send custom message back to LLM when user responds', async () => {
    const executedCalls: string[] = [];
    const trackingExecutor = async (call: ToolCall): Promise<string> => {
      executedCalls.push(call.name);
      return 'done';
    };

    const onConsent = async (_call: ToolCall): Promise<ConsentDecision> => ({
      action: 'respond',
      message: 'Write to output.ts instead, not a.ts',
    });

    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [
          {
            id: 'tc1',
            name: 'writeFile',
            arguments: { path: 'a.ts', content: 'hello' },
          },
        ],
        usage: USAGE,
      },
      {
        type: 'text',
        content: 'Got it, switching to output.ts.',
        usage: USAGE,
      },
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Write the file' }],
      CONSENT_TOOLS,
      trackingExecutor,
      { onConsent },
    );

    expect(result.content).toBe('Got it, switching to output.ts.');
    expect(executedCalls).toHaveLength(0);

    // LLM should have received the user's custom message
    const secondCall = provider.calls[1];
    const toolResultMsg = secondCall![2];
    if (Array.isArray(toolResultMsg?.content)) {
      const block = toolResultMsg.content[0];
      if (block?.type === 'tool_result') {
        expect(block.content).toBe('Write to output.ts instead, not a.ts');
      }
    }
  });

  it('auto-rejects when no consent handler is configured', async () => {
    const executedCalls: string[] = [];
    const trackingExecutor = async (call: ToolCall): Promise<string> => {
      executedCalls.push(call.name);
      return 'done';
    };

    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [
          {
            id: 'tc1',
            name: 'writeFile',
            arguments: { path: 'a.ts', content: 'hello' },
          },
        ],
        usage: USAGE,
      },
      {
        type: 'text',
        content: 'Cannot write without permission.',
        usage: USAGE,
      },
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Write the file' }],
      CONSENT_TOOLS,
      trackingExecutor,
      // no onConsent provided
    );

    expect(result.content).toBe('Cannot write without permission.');
    expect(executedCalls).toHaveLength(0);
  });

  it('should not check consent for tools without requiresConsent', async () => {
    const consentCalls: string[] = [];
    const onConsent = async (call: ToolCall): Promise<ConsentDecision> => {
      consentCalls.push(call.name);
      return { action: 'approve' };
    };

    const provider = createMockProvider([
      {
        type: 'tool_calls',
        calls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'a.ts' } }],
        usage: USAGE,
      },
      { type: 'text', content: 'Read it.', usage: USAGE },
    ]);

    await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Read the file' }],
      CONSENT_TOOLS,
      mockExecutor,
      { onConsent },
    );

    // readFile does not have requiresConsent, so onConsent should not be called
    expect(consentCalls).toHaveLength(0);
  });
});

// --- Streaming mode ---

function createStreamingProvider(
  streamResponses: LLMStreamEvent[][],
): LLMProvider {
  let streamIndex = 0;

  return {
    name: 'mock-streaming',
    generate: async (): Promise<LLMResponse> => {
      throw new Error('Should not call generate in streaming mode');
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      const events = streamResponses[streamIndex];
      if (!events) {
        throw new Error('Mock provider ran out of stream responses');
      }
      streamIndex++;
      for (const event of events) {
        yield event;
      }
    },
  };
}

describe('streaming mode', () => {
  it('should emit incremental text_response events with accumulated content', async () => {
    const events: AgentEvent[] = [];
    const provider = createStreamingProvider([
      [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' },
        { type: 'text', text: '!' },
        { type: 'done', content: 'Hello world!', usage: USAGE },
      ],
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Hi' }],
      SAMPLE_TOOLS,
      mockExecutor,
      { enableStreaming: true, onEvent: (e) => events.push(e) },
    );

    expect(result.content).toBe('Hello world!');

    // Should have partial text_response events with isFinal: false
    const partials = events.filter(
      (e) => e.type === 'text_response' && !e.isFinal,
    );
    expect(partials).toHaveLength(3);
    if (partials[0]?.type === 'text_response') {
      expect(partials[0].content).toBe('Hello');
    }
    if (partials[1]?.type === 'text_response') {
      expect(partials[1].content).toBe('Hello world');
    }
    if (partials[2]?.type === 'text_response') {
      expect(partials[2].content).toBe('Hello world!');
    }

    // Should also have final text_response with isFinal: true
    const final = events.find((e) => e.type === 'text_response' && e.isFinal);
    expect(final).toBeDefined();
  });

  it('should handle tool calls from stream and continue the loop', async () => {
    const provider = createStreamingProvider([
      // First iteration: tool call
      [
        {
          type: 'tool_calls',
          calls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'a.ts' } }],
          usage: USAGE,
        },
      ],
      // Second iteration: text response
      [
        { type: 'text', text: 'Found it' },
        { type: 'done', content: 'Found it', usage: USAGE },
      ],
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Read a.ts' }],
      SAMPLE_TOOLS,
      mockExecutor,
      { enableStreaming: true },
    );

    expect(result.content).toBe('Found it');
    expect(result.iterations).toBe(2);
  });

  it('should accumulate usage across streaming iterations', async () => {
    const provider = createStreamingProvider([
      [
        {
          type: 'tool_calls',
          calls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'a.ts' } }],
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      ],
      [
        {
          type: 'done',
          content: 'Done',
          usage: { inputTokens: 200, outputTokens: 100 },
        },
      ],
    ]);

    const result = await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Go' }],
      SAMPLE_TOOLS,
      mockExecutor,
      { enableStreaming: true },
    );

    expect(result.totalUsage).toEqual({
      inputTokens: 300,
      outputTokens: 150,
    });
  });

  it('should not call generate() when streaming is enabled', async () => {
    const provider = createStreamingProvider([
      [{ type: 'done', content: 'ok', usage: USAGE }],
    ]);

    const generateSpy = jest.spyOn(provider, 'generate');

    await runAgentLoop(
      provider,
      [{ role: 'user', content: 'Hi' }],
      SAMPLE_TOOLS,
      mockExecutor,
      { enableStreaming: true },
    );

    expect(generateSpy).not.toHaveBeenCalled();
  });
});
