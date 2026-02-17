import {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  getModelsForProvider,
  getModelLabel,
} from '../models';
import type { AISelection } from '../types';

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
