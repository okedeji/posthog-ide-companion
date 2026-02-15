import type * as vscode from 'vscode';
import type { AISelection, AIProviderName } from './types';
import type { LLMProvider } from './provider';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';

/**
 * SecretStorage keys for each provider.
 * Adding a new provider? Add one entry here.
 */
const SECRET_KEYS: Record<AIProviderName, string> = {
  anthropic: 'posthog.ai.anthropicApiKey',
  openai: 'posthog.ai.openaiApiKey',
};

/**
 * API keys retrieved from secure storage.
 * Keys are stored in the OS keychain via VSCode's SecretStorage,
 * not in settings.json.
 */
export type AIConfig = {
  anthropicApiKey: string | undefined;
  openaiApiKey: string | undefined;
};

export async function getAIConfig(
  secrets: vscode.SecretStorage,
): Promise<AIConfig> {
  const [anthropicApiKey, openaiApiKey] = await Promise.all([
    secrets.get(SECRET_KEYS.anthropic),
    secrets.get(SECRET_KEYS.openai),
  ]);

  return {
    anthropicApiKey: anthropicApiKey || undefined,
    openaiApiKey: openaiApiKey || undefined,
  };
}

export async function storeApiKey(
  secrets: vscode.SecretStorage,
  provider: AIProviderName,
  apiKey: string,
): Promise<void> {
  await secrets.store(SECRET_KEYS[provider], apiKey);
}

export async function removeApiKey(
  secrets: vscode.SecretStorage,
  provider: AIProviderName,
): Promise<void> {
  await secrets.delete(SECRET_KEYS[provider]);
}

/** Returns undefined if the required API key is missing. */
export function createProvider(
  config: AIConfig,
  selection: AISelection,
): LLMProvider | undefined {
  const key = getKeyForProvider(config, selection.provider);
  if (!key) {
    return undefined;
  }

  switch (selection.provider) {
    case 'anthropic':
      return new AnthropicProvider(key);
    case 'openai':
      return new OpenAIProvider(key);
  }
}

export function hasApiKey(config: AIConfig, provider: AIProviderName): boolean {
  return getKeyForProvider(config, provider) !== undefined;
}

function getKeyForProvider(
  config: AIConfig,
  provider: AIProviderName,
): string | undefined {
  switch (provider) {
    case 'anthropic':
      return config.anthropicApiKey;
    case 'openai':
      return config.openaiApiKey;
  }
}
