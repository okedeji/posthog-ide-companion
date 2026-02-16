import {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  getModelsForProvider,
  getModelLabel,
  getActiveAISelection,
  setActiveAISelection,
  clearActiveAISelection,
} from '../selection-manager';
import type { AISelection } from '../types';

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

describe('ANTHROPIC_MODELS', () => {
  it('should have 5 models', () => {
    expect(ANTHROPIC_MODELS).toHaveLength(5);
  });

  it('has exactly one default model', () => {
    const defaults = ANTHROPIC_MODELS.filter((m) => m.default);
    expect(defaults).toHaveLength(1);
  });

  it('should have Claude Sonnet 4.5 as the default', () => {
    const defaultModel = ANTHROPIC_MODELS.find((m) => m.default);
    expect(defaultModel?.id).toBe('claude-sonnet-4-5-20250929');
    expect(defaultModel?.label).toBe('Claude Sonnet 4.5');
  });

  it('has unique model IDs', () => {
    const ids = ANTHROPIC_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should have a label and description for every model', () => {
    for (const model of ANTHROPIC_MODELS) {
      expect(model.label).toBeTruthy();
      expect(model.description).toBeTruthy();
    }
  });
});

describe('OPENAI_MODELS', () => {
  it('has 5 models', () => {
    expect(OPENAI_MODELS).toHaveLength(5);
  });

  it('should have exactly one default model', () => {
    const defaults = OPENAI_MODELS.filter((m) => m.default);
    expect(defaults).toHaveLength(1);
  });

  it('has GPT-5.2 as the default', () => {
    const defaultModel = OPENAI_MODELS.find((m) => m.default);
    expect(defaultModel?.id).toBe('gpt-5.2');
    expect(defaultModel?.label).toBe('GPT-5.2');
  });

  it('should have unique model IDs', () => {
    const ids = OPENAI_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a label and description for every model', () => {
    for (const model of OPENAI_MODELS) {
      expect(model.label).toBeTruthy();
      expect(model.description).toBeTruthy();
    }
  });
});

describe('getModelsForProvider', () => {
  it('should return Anthropic models for anthropic', () => {
    expect(getModelsForProvider('anthropic')).toBe(ANTHROPIC_MODELS);
  });

  it('returns OpenAI models for openai', () => {
    expect(getModelsForProvider('openai')).toBe(OPENAI_MODELS);
  });
});

describe('getModelLabel', () => {
  it('should return the label for a known Anthropic model', () => {
    const selection: AISelection = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
    };

    expect(getModelLabel(selection)).toBe('Claude Sonnet 4.5');
  });

  it('returns the label for a known OpenAI model', () => {
    const selection: AISelection = {
      provider: 'openai',
      model: 'gpt-5.2',
    };

    expect(getModelLabel(selection)).toBe('GPT-5.2');
  });

  it('should fall back to raw model ID for unknown models', () => {
    const selection: AISelection = {
      provider: 'anthropic',
      model: 'some-future-model',
    };

    expect(getModelLabel(selection)).toBe('some-future-model');
  });
});

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
