import * as vscode from 'vscode';
import type { AISelection, AIProviderName, ModelOption } from './types';
import { getAIConfig, hasApiKey, storeApiKey, removeApiKey } from './config';

const WORKSPACE_STATE_KEY = 'posthog.aiSelection';

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

/** OpenAI model options shown in the quick pick. */
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

export function getActiveAISelection(
  context: vscode.ExtensionContext,
): AISelection | undefined {
  return context.workspaceState.get<AISelection>(WORKSPACE_STATE_KEY);
}

export async function setActiveAISelection(
  context: vscode.ExtensionContext,
  selection: AISelection,
): Promise<void> {
  await context.workspaceState.update(WORKSPACE_STATE_KEY, selection);
}

export async function clearActiveAISelection(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.workspaceState.update(WORKSPACE_STATE_KEY, undefined);
}

/** Runs the full AI setup flow: pick provider → pick model → enter API key. */
export async function showAISetupFlow(
  context: vscode.ExtensionContext,
): Promise<AISelection | undefined> {
  const provider = await showProviderPicker();
  if (!provider) {
    return undefined;
  }

  const model = await showModelPicker(provider);
  if (!model) {
    return undefined;
  }

  const config = await getAIConfig(context.secrets);
  if (!hasApiKey(config, provider)) {
    const stored = await promptAndStoreApiKey(context.secrets, provider);
    if (!stored) {
      return undefined;
    }
  }

  const selection: AISelection = { provider, model };
  await setActiveAISelection(context, selection);
  return selection;
}

export async function showAIReconfigureMenu(
  context: vscode.ExtensionContext,
): Promise<AISelection | undefined> {
  const current = getActiveAISelection(context);

  const items: vscode.QuickPickItem[] = [
    {
      label: 'Change Provider',
      description: 'Switch between Anthropic and OpenAI',
    },
    { label: 'Change Model', description: 'Pick a different model' },
    { label: 'Update API Key', description: 'Enter a new API key' },
    {
      label: 'Remove AI Config',
      description: 'Clear provider and model selection',
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Configure AI',
    placeHolder: 'What would you like to change?',
  });

  if (!picked) {
    return current;
  }

  switch (picked.label) {
    case 'Change Provider':
      return showAISetupFlow(context);

    case 'Change Model': {
      if (!current) {
        return showAISetupFlow(context);
      }
      const model = await showModelPicker(current.provider);
      if (!model) {
        return current;
      }
      const updated = { ...current, model };
      await setActiveAISelection(context, updated);
      return updated;
    }

    case 'Update API Key': {
      const provider = current?.provider ?? (await showProviderPicker());
      if (!provider) {
        return current;
      }
      await promptAndStoreApiKey(context.secrets, provider);
      return current;
    }

    case 'Remove AI Config': {
      if (current) {
        await removeApiKey(context.secrets, current.provider);
      }
      await clearActiveAISelection(context);
      return undefined;
    }

    default:
      return current;
  }
}

async function showProviderPicker(): Promise<AIProviderName | undefined> {
  const items: (vscode.QuickPickItem & { provider: AIProviderName })[] = [
    {
      label: 'Anthropic (Claude)',
      description: 'Claude Sonnet, Opus, Haiku',
      provider: 'anthropic',
    },
    {
      label: 'OpenAI (GPT)',
      description: 'GPT-5.2, GPT-5.2 Codex, GPT-5.1',
      provider: 'openai',
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Choose AI Provider',
    placeHolder: 'Which LLM provider do you want to use?',
  });

  return picked?.provider;
}

export async function showModelPicker(
  provider: AIProviderName,
): Promise<string | undefined> {
  const models = getModelsForProvider(provider);

  const items = models.map((m) => ({
    label: m.default ? `${m.label}  $(star)` : m.label,
    description: m.description,
    modelId: m.id,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: `Choose ${provider === 'anthropic' ? 'Claude' : 'OpenAI'} Model`,
    placeHolder: 'Pick the model to use for AI features',
  });

  return picked?.modelId;
}

export async function promptAndStoreApiKey(
  secrets: vscode.SecretStorage,
  provider: AIProviderName,
): Promise<boolean> {
  const label = provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
  const placeholder = provider === 'anthropic' ? 'sk-ant-api03-...' : 'sk-...';

  const apiKey = await vscode.window.showInputBox({
    title: `Enter ${label} API Key`,
    prompt: `Paste your ${label} API key. It will be stored securely in your OS keychain.`,
    placeHolder: placeholder,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'API key cannot be empty';
      }
      return undefined;
    },
  });

  if (!apiKey) {
    return false;
  }

  await storeApiKey(secrets, provider, apiKey.trim());

  void vscode.window.showInformationMessage(
    `PostHog: ${label} API key saved securely.`,
  );
  return true;
}

export function getModelLabel(selection: AISelection): string {
  const models = getModelsForProvider(selection.provider);
  const match = models.find((m) => m.id === selection.model);
  return match?.label ?? selection.model;
}
