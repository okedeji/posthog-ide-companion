import type * as vscode from 'vscode';
import type { AISelection, AIProviderName } from './types';
import type { LLMProvider } from './provider';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';

const SECRET_KEYS: Record<AIProviderName, string> = {
  anthropic: 'posthog.ai.anthropicApiKey',
  openai: 'posthog.ai.openaiApiKey',
};

// Stored in OS keychain via SecretStorage, not settings.json.
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

  // Normalize empty strings to undefined
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

const WORKSPACE_STATE_KEY = 'posthog.aiSelection';
const DEFAULT_AI_KEY = 'posthog.defaultAISelection';

// Falls back to global default if no workspace-specific selection
export function getActiveAISelection(
  context: vscode.ExtensionContext,
): AISelection | undefined {
  const workspace =
    context.workspaceState.get<AISelection>(WORKSPACE_STATE_KEY);
  if (workspace) {
    return workspace;
  }
  return context.globalState.get<AISelection>(DEFAULT_AI_KEY);
}

// Also sets global default so new workspaces inherit the choice
export async function setActiveAISelection(
  context: vscode.ExtensionContext,
  selection: AISelection,
): Promise<void> {
  await context.workspaceState.update(WORKSPACE_STATE_KEY, selection);
  await context.globalState.update(DEFAULT_AI_KEY, selection);
}

export async function clearActiveAISelection(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.workspaceState.update(WORKSPACE_STATE_KEY, undefined);
}
