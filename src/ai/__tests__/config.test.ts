import {
  createProvider,
  hasApiKey,
  getAIConfig,
  storeApiKey,
  removeApiKey,
  getActiveAISelection,
  setActiveAISelection,
  clearActiveAISelection,
} from '../config';
import type { AIConfig } from '../config';
import type { AISelection } from '../types';
import { AnthropicProvider } from '../providers/anthropic';
import { OpenAIProvider } from '../providers/openai';

function createMockSecretStorage() {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (key: string) => store.get(key)),
    store: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    onDidChange: jest.fn(),
    _store: store,
  };
}

describe('createProvider', () => {
  const fullConfig: AIConfig = {
    anthropicApiKey: 'sk-ant-test',
    openaiApiKey: 'sk-test',
  };

  const emptyConfig: AIConfig = {
    anthropicApiKey: undefined,
    openaiApiKey: undefined,
  };

  it('should create an AnthropicProvider when anthropic is selected', () => {
    const selection: AISelection = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
    };

    const provider = createProvider(fullConfig, selection);

    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider?.name).toBe('anthropic');
  });

  it('creates an OpenAIProvider when openai is selected', () => {
    const selection: AISelection = {
      provider: 'openai',
      model: 'gpt-5.2',
    };

    const provider = createProvider(fullConfig, selection);

    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider?.name).toBe('openai');
  });

  it('should return undefined when anthropic key is missing', () => {
    const selection: AISelection = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
    };

    const provider = createProvider(emptyConfig, selection);

    expect(provider).toBeUndefined();
  });

  it('returns undefined when openai key is missing', () => {
    const selection: AISelection = {
      provider: 'openai',
      model: 'gpt-5.2',
    };

    const provider = createProvider(emptyConfig, selection);

    expect(provider).toBeUndefined();
  });
});

describe('hasApiKey', () => {
  it('should return true when anthropic key exists', () => {
    const config: AIConfig = {
      anthropicApiKey: 'sk-ant-test',
      openaiApiKey: undefined,
    };

    expect(hasApiKey(config, 'anthropic')).toBe(true);
    expect(hasApiKey(config, 'openai')).toBe(false);
  });

  it('returns true when openai key exists', () => {
    const config: AIConfig = {
      anthropicApiKey: undefined,
      openaiApiKey: 'sk-test',
    };

    expect(hasApiKey(config, 'anthropic')).toBe(false);
    expect(hasApiKey(config, 'openai')).toBe(true);
  });

  it('should return false for both when no keys exist', () => {
    const config: AIConfig = {
      anthropicApiKey: undefined,
      openaiApiKey: undefined,
    };

    expect(hasApiKey(config, 'anthropic')).toBe(false);
    expect(hasApiKey(config, 'openai')).toBe(false);
  });
});

describe('getAIConfig', () => {
  it('returns keys from secret storage', async () => {
    const secrets = createMockSecretStorage();
    secrets._store.set('posthog.ai.anthropicApiKey', 'sk-ant-123');
    secrets._store.set('posthog.ai.openaiApiKey', 'sk-456');

    const config = await getAIConfig(secrets as never);

    expect(config.anthropicApiKey).toBe('sk-ant-123');
    expect(config.openaiApiKey).toBe('sk-456');
  });

  it('should return undefined for missing keys', async () => {
    const secrets = createMockSecretStorage();

    const config = await getAIConfig(secrets as never);

    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.openaiApiKey).toBeUndefined();
  });

  it('treats empty strings as undefined', async () => {
    const secrets = createMockSecretStorage();
    secrets._store.set('posthog.ai.anthropicApiKey', '');

    const config = await getAIConfig(secrets as never);

    expect(config.anthropicApiKey).toBeUndefined();
  });
});

describe('storeApiKey', () => {
  it('should store anthropic key in secret storage', async () => {
    const secrets = createMockSecretStorage();

    await storeApiKey(secrets as never, 'anthropic', 'sk-ant-new');

    expect(secrets.store).toHaveBeenCalledWith(
      'posthog.ai.anthropicApiKey',
      'sk-ant-new',
    );
  });

  it('stores openai key in secret storage', async () => {
    const secrets = createMockSecretStorage();

    await storeApiKey(secrets as never, 'openai', 'sk-new');

    expect(secrets.store).toHaveBeenCalledWith(
      'posthog.ai.openaiApiKey',
      'sk-new',
    );
  });
});

describe('removeApiKey', () => {
  it('should delete the correct key from secret storage', async () => {
    const secrets = createMockSecretStorage();
    secrets._store.set('posthog.ai.anthropicApiKey', 'sk-ant-old');

    await removeApiKey(secrets as never, 'anthropic');

    expect(secrets.delete).toHaveBeenCalledWith('posthog.ai.anthropicApiKey');
  });
});

/** Creates a minimal mock of ExtensionContext with in-memory state. */
function createMockContext() {
  const workspaceState = new Map<string, unknown>();
  const globalState = new Map<string, unknown>();

  return {
    workspaceState: {
      get: <T>(key: string): T | undefined =>
        workspaceState.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        if (value === undefined) {
          workspaceState.delete(key);
        } else {
          workspaceState.set(key, value);
        }
      },
    },
    globalState: {
      get: <T>(key: string): T | undefined =>
        globalState.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        if (value === undefined) {
          globalState.delete(key);
        } else {
          globalState.set(key, value);
        }
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('AI selection persistence', () => {
  const selection: AISelection = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
  };

  it('returns undefined when nothing is stored', () => {
    const context = createMockContext();
    expect(getActiveAISelection(context)).toBeUndefined();
  });

  it('returns workspace selection when set', async () => {
    const context = createMockContext();
    await setActiveAISelection(context, selection);

    expect(getActiveAISelection(context)).toEqual(selection);
  });

  it('falls back to global default when workspace has no selection', async () => {
    const context = createMockContext();
    await setActiveAISelection(context, selection);

    // Simulate a new workspace by clearing only workspace state
    const freshContext = createMockContext();
    // Copy global state from original context
    freshContext.globalState.update('posthog.defaultAISelection', selection);

    expect(getActiveAISelection(freshContext)).toEqual(selection);
  });

  it('prefers workspace selection over global default', async () => {
    const context = createMockContext();
    const globalSelection: AISelection = {
      provider: 'openai',
      model: 'gpt-5.2',
    };

    await context.globalState.update(
      'posthog.defaultAISelection',
      globalSelection,
    );
    await setActiveAISelection(context, selection);

    expect(getActiveAISelection(context)).toEqual(selection);
  });

  it('clears workspace selection but preserves global default', async () => {
    const context = createMockContext();
    await setActiveAISelection(context, selection);
    await clearActiveAISelection(context);

    // Falls back to global
    expect(getActiveAISelection(context)).toEqual(selection);
  });
});
