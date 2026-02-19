import { ChatViewProvider } from '../chat-provider';
import type { ChatProviderDeps } from '../chat-provider';
import type { LLMProvider } from '../../../ai/provider';
import type {
  LLMMessage,
  LLMResponse,
  LLMGenerateOptions,
  ConsentDecision,
} from '../../../ai/types';
import type { Discovery } from '../../../features/discoveries/types';
import { ChatHistory } from '../../../chat/history';
import { Uri, window } from 'vscode';

const USAGE = { inputTokens: 10, outputTokens: 5 };

function createMockMemento(): { get: jest.Mock; update: jest.Mock } {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn((key: string) => store.get(key)),
    update: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
}

function createMockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;

  const nextResponse = (): LLMResponse => {
    const response = responses[callIndex];
    if (!response) {
      throw new Error('Mock provider ran out of responses');
    }
    callIndex++;
    return response;
  };

  return {
    name: 'mock',
    generate: async (
      _messages: LLMMessage[],
      _options?: LLMGenerateOptions,
    ): Promise<LLMResponse> => nextResponse(),
    async *stream() {
      const response = nextResponse();
      if (response.type === 'text') {
        yield { type: 'text', text: response.content };
        yield {
          type: 'done',
          content: response.content,
          usage: response.usage,
        };
      } else {
        yield {
          type: 'tool_calls',
          calls: response.calls,
          usage: response.usage,
        };
      }
    },
  };
}

type MockPanel = ReturnType<typeof window.createWebviewPanel>;

function createDeps(
  overrides: Partial<ChatProviderDeps> = {},
): ChatProviderDeps {
  return {
    extensionUri: Uri.file('/test/extension'),
    logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn() },
    getProvider: () =>
      createMockProvider([{ type: 'text', content: 'Hello!', usage: USAGE }]),
    getWorkspaceRoot: () => '/tmp/test-workspace',
    getMcpClient: () => undefined,
    getWorkspaceInfo: () => undefined,
    chatHistory: new ChatHistory(createMockMemento() as never),
    ...overrides,
  };
}

/**
 * Opens the chat panel and returns a `send` helper to simulate
 * webview messages.
 */
function setupProvider(deps?: Partial<ChatProviderDeps>) {
  const provider = new ChatViewProvider(createDeps(deps));
  provider.open();

  const panel = (window.createWebviewPanel as jest.Mock).mock.results.slice(
    -1,
  )[0]?.value as MockPanel;

  // Extract the message handler registered via onDidReceiveMessage
  const messageHandler = (panel.webview.onDidReceiveMessage as jest.Mock).mock
    .calls[0]?.[0] as ((msg: unknown) => void) | undefined;

  const send = (msg: unknown) => {
    if (!messageHandler) {
      throw new Error('No message handler registered');
    }
    messageHandler(msg);
  };

  return { provider, panel, send };
}

describe('ChatViewProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('open', () => {
    it('should create a webview panel with correct options', () => {
      const { panel } = setupProvider();

      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'posthog.chat',
        'PostHog Companion',
        expect.anything(),
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
        }),
      );
      expect(panel.webview.html).toContain('<!DOCTYPE html>');
      expect(panel.webview.html).toContain('chat.css');
      expect(panel.webview.html).toContain('chat.js');
    });

    it('should reveal existing panel instead of creating a new one', () => {
      const { provider, panel } = setupProvider();

      provider.open();

      expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(panel.reveal).toHaveBeenCalledTimes(1);
    });

    it('should register a message handler', () => {
      const { panel } = setupProvider();
      expect(panel.webview.onDidReceiveMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('messaging', () => {
    it('should post history and state on ready even without a controller', () => {
      const { panel, send } = setupProvider();
      send({ type: 'ready' });

      const calls = (panel.webview.postMessage as jest.Mock).mock.calls.map(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type,
      );
      expect(calls).toContain('history');
      expect(calls).toContain('state');
    });

    it('should create controller and send on first message', async () => {
      const { panel, send } = setupProvider();

      send({ type: 'send', text: 'Hello' });
      await new Promise((r) => setTimeout(r, 50));

      const calls = (panel.webview.postMessage as jest.Mock).mock.calls.map(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type,
      );
      expect(calls).toContain('history');
      expect(calls).toContain('state');
    });

    it('should post error when provider is not configured', async () => {
      const { panel, send } = setupProvider({
        getProvider: () => undefined,
      });

      send({ type: 'send', text: 'Hello' });
      await new Promise((r) => setTimeout(r, 50));

      const errorMsg = (panel.webview.postMessage as jest.Mock).mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === 'error',
      );
      expect(errorMsg).toBeDefined();
      expect((errorMsg?.[0] as Record<string, unknown>).message).toContain(
        'AI provider not configured',
      );
    });

    it('should post error when workspace root is not available', async () => {
      const { panel, send } = setupProvider({
        getWorkspaceRoot: () => undefined,
      });

      send({ type: 'send', text: 'Hello' });
      await new Promise((r) => setTimeout(r, 50));

      const errorMsg = (panel.webview.postMessage as jest.Mock).mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === 'error',
      );
      expect(errorMsg).toBeDefined();
    });

    it('should handle reset', async () => {
      const { panel, send } = setupProvider();

      send({ type: 'send', text: 'Hi' });
      await new Promise((r) => setTimeout(r, 50));

      (panel.webview.postMessage as jest.Mock).mockClear();

      send({ type: 'reset' });

      const calls = (panel.webview.postMessage as jest.Mock).mock.calls.map(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type,
      );
      expect(calls).toContain('history');
      expect(calls).toContain('state');
    });
  });

  describe('consent flow', () => {
    it('should forward consent requests and resolve decisions', async () => {
      const responses: LLMResponse[] = [
        {
          type: 'tool_calls',
          calls: [{ id: 'call-1', name: 'bash', arguments: { command: 'ls' } }],
          usage: USAGE,
        },
        { type: 'text', content: 'Done', usage: USAGE },
      ];

      const { panel, send } = setupProvider({
        getProvider: () => createMockProvider(responses),
      });

      send({ type: 'send', text: 'Run ls' });
      await new Promise((r) => setTimeout(r, 50));

      const consentMsg = (
        panel.webview.postMessage as jest.Mock
      ).mock.calls.find(
        (c: unknown[]) =>
          (c[0] as Record<string, unknown>).type === 'consent_request',
      );
      expect(consentMsg).toBeDefined();

      const callId = (consentMsg?.[0] as Record<string, unknown>)
        .callId as string;

      send({
        type: 'consent_decision',
        callId,
        decision: { action: 'approve' } as ConsentDecision,
      });

      await new Promise((r) => setTimeout(r, 50));

      const historyMsg = (
        panel.webview.postMessage as jest.Mock
      ).mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === 'history',
      );
      expect(historyMsg).toBeDefined();
    });
  });

  describe('discovery context', () => {
    it('should open panel and post context_loaded message', async () => {
      const provider = new ChatViewProvider(createDeps());

      const discovery: Discovery = {
        id: 'disc-1',
        kind: 'error',
        title: 'TypeError in handleClick',
        description: 'Cannot read property of undefined',
        severity: 'critical',
        firstSeen: '2025-01-01',
        lastSeen: '2025-01-02',
        source: {},
      };

      provider.loadDiscoveryContext(discovery);

      const panel = (window.createWebviewPanel as jest.Mock).mock.results.slice(
        -1,
      )[0]?.value as MockPanel;

      const contextMsg = (
        panel.webview.postMessage as jest.Mock
      ).mock.calls.find(
        (c: unknown[]) =>
          (c[0] as Record<string, unknown>).type === 'context_loaded',
      );
      expect(contextMsg).toBeDefined();
      expect((contextMsg?.[0] as Record<string, unknown>).title).toBe(
        'TypeError in handleClick',
      );
      expect((contextMsg?.[0] as Record<string, unknown>).kind).toBe('error');
    });
  });

  describe('dispose', () => {
    it('should clean up panel and controller without errors', async () => {
      const { provider, send } = setupProvider();

      send({ type: 'send', text: 'Hi' });
      await new Promise((r) => setTimeout(r, 50));

      expect(() => provider.dispose()).not.toThrow();
    });
  });
});
