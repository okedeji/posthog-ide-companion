import {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  getModelsForProvider,
  getModelLabel,
} from '../selection-manager';
import type { AISelection } from '../types';

describe('ANTHROPIC_MODELS', () => {
  it('should have 5 models', () => {
    expect(ANTHROPIC_MODELS).toHaveLength(5);
  });

  it('should have exactly one default model', () => {
    const defaults = ANTHROPIC_MODELS.filter((m) => m.default);
    expect(defaults).toHaveLength(1);
  });

  it('should have Claude Sonnet 4.5 as the default', () => {
    const defaultModel = ANTHROPIC_MODELS.find((m) => m.default);
    expect(defaultModel?.id).toBe('claude-sonnet-4-5-20250929');
    expect(defaultModel?.label).toBe('Claude Sonnet 4.5');
  });

  it('should have unique model IDs', () => {
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
  it('should have 5 models', () => {
    expect(OPENAI_MODELS).toHaveLength(5);
  });

  it('should have exactly one default model', () => {
    const defaults = OPENAI_MODELS.filter((m) => m.default);
    expect(defaults).toHaveLength(1);
  });

  it('should have GPT-5.2 as the default', () => {
    const defaultModel = OPENAI_MODELS.find((m) => m.default);
    expect(defaultModel?.id).toBe('gpt-5.2');
    expect(defaultModel?.label).toBe('GPT-5.2');
  });

  it('should have unique model IDs', () => {
    const ids = OPENAI_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should have a label and description for every model', () => {
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

  it('should return OpenAI models for openai', () => {
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

  it('should return the label for a known OpenAI model', () => {
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
