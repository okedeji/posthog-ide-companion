import type { AIProviderName, AISelection, ModelOption } from './types';

// Adding a new provider? Add a models array and update getModelsForProvider().

export const ANTHROPIC_MODELS: ModelOption[] = [
  {
    id: 'claude-sonnet-4-5-20250929',
    label: 'Claude Sonnet 4.5',
    description: 'Fast and capable (recommended)',
    default: true,
  },
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    description: 'Most intelligent, best for complex tasks',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    description: 'Fastest, most cost-effective',
  },
  {
    id: 'claude-opus-4-5-20251101',
    label: 'Claude Opus 4.5',
    description: 'Previous generation flagship',
  },
  {
    id: 'claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    description: 'Older generation, still capable',
  },
];

export const OPENAI_MODELS: ModelOption[] = [
  {
    id: 'gpt-5.2',
    label: 'GPT-5.2',
    description: 'Best general-purpose (recommended)',
    default: true,
  },
  {
    id: 'gpt-5.2-pro',
    label: 'GPT-5.2 Pro',
    description: 'Most intelligent, best for complex tasks',
  },
  {
    id: 'gpt-5.2-chat-latest',
    label: 'GPT-5.2 Chat Latest',
    description: 'Latest chat-tuned snapshot of GPT-5.2',
  },
  {
    id: 'gpt-5.2-codex',
    label: 'GPT-5.2 Codex',
    description: 'Optimized for agentic coding workflows',
  },
  {
    id: 'gpt-5.1',
    label: 'GPT-5.1',
    description: 'Previous generation, stable and proven',
  },
];

export function getModelsForProvider(provider: AIProviderName): ModelOption[] {
  switch (provider) {
    case 'anthropic':
      return ANTHROPIC_MODELS;
    case 'openai':
      return OPENAI_MODELS;
  }
}

export function getModelLabel(selection: AISelection): string {
  const models = getModelsForProvider(selection.provider);
  const match = models.find((m) => m.id === selection.model);
  return match?.label ?? selection.model;
}
