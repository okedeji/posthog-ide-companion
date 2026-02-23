import { ChatController } from '../chat-controller';
import type { ConsentRequest } from '../chat-controller';
import type { LLMProvider } from '../../ai/provider';
import type {
  LLMMessage,
  LLMResponse,
  LLMGenerateOptions,
  AgentEvent,
} from '../../ai/types';
import type { Discovery } from '../../features/discoveries/types';
import type { ErrorTrackingIssue } from '../../api/schemas';

const USAGE = { inputTokens: 10, outputTokens: 5 };

function createMockProvider(responses: LLMResponse[]): LLMProvider & {
  calls: Array<{ messages: LLMMessage[]; options?: LLMGenerateOptions }>;
} {
  let callIndex = 0;
  const calls: Array<{
    messages: LLMMessage[];
    options?: LLMGenerateOptions;
  }> = [];

  return {
    name: 'mock',
    calls,
    generate: async (
      messages: LLMMessage[],
      options?: LLMGenerateOptions,
    ): Promise<LLMResponse> => {
      calls.push({ messages: [...messages], options });
      const response = responses[callIndex];
      if (!response) {
        throw new Error('Mock provider ran out of responses');
      }
      callIndex++;
      return response;
    },
    async *stream(messages: LLMMessage[], options?: LLMGenerateOptions) {
      calls.push({ messages: [...messages], options });
      const response = responses[callIndex];
      if (!response) {
        throw new Error('Mock provider ran out of responses');
      }
      callIndex++;
      if (response.type === 'text') {
        yield { type: 'text' as const, text: response.content };
        yield {
          type: 'done' as const,
          content: response.content,
          usage: response.usage,
        };
      } else {
        yield {
          type: 'tool_calls' as const,
          calls: response.calls,
          usage: response.usage,
        };
      }
    },
  };
}

function makeErrorDiscovery(): Discovery {
  const source: ErrorTrackingIssue = {
    id: 'err-1',
    first_seen: '2025-01-01',
    last_seen: '2025-01-02',
    status: 'active',
    aggregations: { occurrences: 42, sessions: 10, users: 5 },
    library: 'react',
    function: 'handleClick',
  };

  return {
    id: 'disc-1',
    kind: 'error',
    title: 'TypeError in handleClick',
    description: 'Cannot read property of undefined',
    severity: 'critical',
    firstSeen: '2025-01-01',
    lastSeen: '2025-01-02',
    source,
  };
}

function makeSetupDiscovery(): Discovery {
  return {
    id: 'disc-2',
    kind: 'setup_issue',
    title: 'Source maps not configured',
    description: 'Production stack traces show minified code.',
    severity: 'warning',
    firstSeen: '2025-01-01',
    lastSeen: '2025-01-01',
    source: {
      checkId: 'source_maps_not_configured',
      evidence: ['posthog-js in package.json', 'no @posthog/cli found'],
    },
  };
}

function createController(
  provider: LLMProvider,
  overrides: {
    onEvent?: (e: AgentEvent) => void;
    onConsentRequest?: (r: ConsentRequest) => void;
    onDiscoveryResolved?: (id: string) => void;
  } = {},
) {
  return new ChatController({
    provider,
    workspaceRoot: '/tmp/test-workspace',
    logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn() },
    onEvent: overrides.onEvent ?? (() => {}),
    onConsentRequest: overrides.onConsentRequest ?? (() => {}),
    onDiscoveryResolved: overrides.onDiscoveryResolved,
  });
}

describe('ChatController', () => {
  it('should send a message and return the result', async () => {
    const provider = createMockProvider([
      { type: 'text', content: 'Hello!', usage: USAGE },
    ]);

    const controller = createController(provider);
    const result = await controller.send('Hi');

    expect(result.content).toBe('Hello!');
    expect(controller.messages).toHaveLength(2);
    expect(controller.messages[0]?.content).toBe('Hi');
    expect(controller.messages[1]?.content).toBe('Hello!');
  });

  it('should forward agent events', async () => {
    const provider = createMockProvider([
      { type: 'text', content: 'Done', usage: USAGE },
    ]);

    const events: AgentEvent[] = [];
    const controller = createController(provider, {
      onEvent: (e) => events.push(e),
    });

    await controller.send('Go');

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'iteration_start')).toBe(true);
  });

  describe('discovery context', () => {
    it('should prepend error discovery context to the user message', async () => {
      const provider = createMockProvider([
        { type: 'text', content: 'Analyzing...', usage: USAGE },
      ]);

      const controller = createController(provider);
      controller.setDiscoveryContext(makeErrorDiscovery());

      await controller.send('Help me fix this');

      // The provider should have received the augmented message
      const sentMessages = provider.calls[0]?.messages;
      const userMsg = sentMessages?.find((m) => m.role === 'user');
      expect(typeof userMsg?.content).toBe('string');
      const content = userMsg?.content as string;
      expect(content).toContain('TypeError in handleClick');
      expect(content).toContain('handleClick');
      expect(content).toContain('Help me fix this');
    });

    it('should prepend setup issue context to the user message', async () => {
      const provider = createMockProvider([
        { type: 'text', content: 'Fixing...', usage: USAGE },
      ]);

      const controller = createController(provider);
      controller.setDiscoveryContext(makeSetupDiscovery());

      await controller.send('Fix this please');

      const sentMessages = provider.calls[0]?.messages;
      const userMsg = sentMessages?.find((m) => m.role === 'user');
      const content = userMsg?.content as string;
      expect(content).toContain('Source maps not configured');
      expect(content).toContain('posthog-js in package.json');
      expect(content).toContain('Fix this please');
    });

    it('should clear discovery context after use', async () => {
      const provider = createMockProvider([
        { type: 'text', content: 'First', usage: USAGE },
        { type: 'text', content: 'Second', usage: USAGE },
      ]);

      const controller = createController(provider);
      controller.setDiscoveryContext(makeErrorDiscovery());

      await controller.send('With context');
      await controller.send('Without context');

      // Second call should NOT have discovery context
      const secondMessages = provider.calls[1]?.messages;
      const lastUserMsg = secondMessages?.[secondMessages.length - 1];
      const content = lastUserMsg?.content as string;
      expect(content).toContain('Without context');
      expect(content).not.toContain('TypeError');
    });

    it('should expose pending discovery via getter', () => {
      const provider = createMockProvider([]);
      const controller = createController(provider);

      expect(controller.pendingDiscovery).toBeUndefined();

      const discovery = makeErrorDiscovery();
      controller.setDiscoveryContext(discovery);

      expect(controller.pendingDiscovery).toBe(discovery);
    });
  });

  describe('consent', () => {
    it('should fire onConsentRequest for consent-requiring tools', async () => {
      const consentRequests: ConsentRequest[] = [];

      const provider = createMockProvider([
        {
          type: 'tool_calls',
          calls: [
            {
              id: 'call-1',
              name: 'bash',
              arguments: { command: 'echo hello' },
            },
          ],
          usage: USAGE,
        },
        { type: 'text', content: 'Done', usage: USAGE },
      ]);

      const controller = createController(provider, {
        onConsentRequest: (r) => {
          consentRequests.push(r);
          // Auto-approve so the send completes
          controller.resolveConsent(r.callId, { action: 'approve' });
        },
      });

      await controller.send('Run echo hello');

      expect(consentRequests).toHaveLength(1);
      expect(consentRequests[0]?.toolName).toBe('bash');
      expect(consentRequests[0]?.args).toEqual({ command: 'echo hello' });
    });

    it('should handle consent rejection', async () => {
      const provider = createMockProvider([
        {
          type: 'tool_calls',
          calls: [
            {
              id: 'call-1',
              name: 'bash',
              arguments: { command: 'rm -rf .' },
            },
          ],
          usage: USAGE,
        },
        { type: 'text', content: 'Rejected, moving on.', usage: USAGE },
      ]);

      const controller = createController(provider, {
        onConsentRequest: (r) => {
          controller.resolveConsent(r.callId, { action: 'reject' });
        },
      });

      const result = await controller.send('Delete everything');

      expect(result.content).toBe('Rejected, moving on.');
    });

    it('should ignore resolveConsent for unknown callIds', () => {
      const provider = createMockProvider([]);
      const controller = createController(provider);

      // Should not throw
      controller.resolveConsent('nonexistent', { action: 'approve' });
    });

    it('should call onDiscoveryResolved when dismissDiscovery is approved', async () => {
      const onDiscoveryResolved = jest.fn();

      const provider = createMockProvider([
        {
          type: 'tool_calls',
          calls: [
            {
              id: 'call-1',
              name: 'dismissDiscovery',
              arguments: { id: 'setup_issue:source_maps_not_configured' },
            },
          ],
          usage: USAGE,
        },
        { type: 'text', content: 'Done, dismissed.', usage: USAGE },
      ]);

      const controller = createController(provider, {
        onConsentRequest: (r) => {
          controller.resolveConsent(r.callId, { action: 'approve' });
        },
        onDiscoveryResolved,
      });

      await controller.send('Fix and dismiss');

      expect(onDiscoveryResolved).toHaveBeenCalledWith(
        'setup_issue:source_maps_not_configured',
      );
    });
  });

  describe('reset', () => {
    it('should clear messages and discovery context', async () => {
      const provider = createMockProvider([
        { type: 'text', content: 'Hello', usage: USAGE },
      ]);

      const controller = createController(provider);
      controller.setDiscoveryContext(makeErrorDiscovery());

      await controller.send('Hi');
      expect(controller.messages).toHaveLength(2);
      expect(controller.pendingDiscovery).toBeUndefined(); // cleared by send

      controller.setDiscoveryContext(makeErrorDiscovery());
      controller.reset();

      expect(controller.messages).toHaveLength(0);
      expect(controller.pendingDiscovery).toBeUndefined();
    });

    it('should reject pending consent requests on reset', async () => {
      const provider = createMockProvider([
        {
          type: 'tool_calls',
          calls: [{ id: 'call-1', name: 'bash', arguments: { command: 'ls' } }],
          usage: USAGE,
        },
        { type: 'text', content: 'Done', usage: USAGE },
      ]);

      let consentFired = false;
      const controller = createController(provider, {
        onConsentRequest: () => {
          consentFired = true;
          // Don't resolve - let reset handle it
        },
      });

      // Start send but don't await - consent will be pending
      const sendPromise = controller.send('Run ls');

      // Wait for the consent request to fire
      await new Promise((r) => setTimeout(r, 10));
      expect(consentFired).toBe(true);

      // Reset rejects pending consents, unblocking the agent loop
      controller.reset();

      // The send should complete (tool was rejected by consent rejection)
      const result = await sendPromise;
      expect(result.content).toBe('Done');
    });
  });

  describe('system prompt', () => {
    it('should include foundation, tools section, and chat instructions', async () => {
      const provider = createMockProvider([
        { type: 'text', content: 'Hi', usage: USAGE },
      ]);

      const controller = createController(provider);
      await controller.send('Hello');

      const systemPrompt = provider.calls[0]?.options?.systemPrompt;
      expect(systemPrompt).toBeDefined();

      // Foundation
      expect(systemPrompt).toContain('Hard Rules');

      // Auto-generated tools section
      expect(systemPrompt).toContain('readFile');
      expect(systemPrompt).toContain('bash');
      expect(systemPrompt).toContain('proposeEdit');
      expect(systemPrompt).toContain('Core tools');
      expect(systemPrompt).toContain('findTools');

      // Chat instructions
      expect(systemPrompt).toContain('Handling Requests');
    });
  });
});
