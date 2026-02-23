import type * as vscode from 'vscode';
import { Session } from '../ai/session';
import {
  createSystemPromptBuilder,
  createWorkspaceContextSection,
} from '../ai/prompts';
import { createToolRegistry } from '../ai/tools/registry';
import { ReadFileTool } from '../ai/tools/read-file';
import { ListDirectoryTool } from '../ai/tools/list-directory';
import { SearchCodeTool } from '../ai/tools/search-code';
import { CheckEnvKeysTool } from '../ai/tools/check-env-keys';
import { BashTool } from '../ai/tools/bash';
import { ProposeEditTool } from '../ai/tools/propose-edit';
import { createMcpTools } from '../ai/tools/mcp-tool';
import { buildMcpToolHooks } from '../ai/tools/mcp-hooks';
import {
  CHAT_INSTRUCTIONS,
  buildErrorDiscoveryContext,
  buildSetupIssueDiscoveryContext,
  buildAlertDiscoveryContext,
  buildExperimentDiscoveryContext,
  buildFlagDiscoveryContext,
  buildIntegrationSuggestionContext,
} from './prompts';
import type { LLMProvider } from '../ai/provider';
import type {
  AgentEventCallback,
  AgentResult,
  ConsentDecision,
  SessionMessage,
  ToolCall,
} from '../ai/types';
import type { Tool } from '../ai/tools/tool';
import type {
  EditProposal,
  EditApprovalResult,
} from '../ai/tools/propose-edit';
import type { PostHogMcpClient } from '../mcp/client';
import type { PostHogApiClient } from '../api/client';
import { CreateAlertTool } from '../ai/tools/create-alert';
import { GetAlertsTool } from '../ai/tools/get-alerts';
import { UpdateAlertTool } from '../ai/tools/update-alert';
import { DeleteAlertTool } from '../ai/tools/delete-alert';
import { DismissDiscoveryTool } from '../ai/tools/dismiss-discovery';
import { ThinkTool } from '../ai/tools/think';
import { FindToolsTool } from '../ai/tools/find-tools';
import type { ToolDefinition } from '../ai/types';
import type { CodeSelection } from '../ui/chat/chat-provider';
import type { WorkspaceInfo } from '../workspace/types';
import type { PostHogProject } from '../api/schemas';
import type { Logger } from '../utils/logger';
import type {
  Discovery,
  ErrorDiscovery,
  SetupIssueDiscovery,
  AlertDiscovery,
  ExperimentDiscovery,
  FlagDiscovery,
  IntegrationSuggestionDiscovery,
} from '../features/discoveries/types';

export type ConsentRequest = {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type ChatControllerOptions = {
  provider: LLMProvider;
  workspaceRoot: string;
  logger: Logger;
  mcpClient?: PostHogMcpClient;
  apiClient?: PostHogApiClient;
  workspaceInfo?: WorkspaceInfo;
  project?: PostHogProject;
  onEvent: AgentEventCallback;
  onConsentRequest: (request: ConsentRequest) => void;
  onDiscoveryResolved?: (discoveryId: string) => void;
  sessionId?: string;
  initialMessages?: SessionMessage[];
};

// Tools that always have their full JSON schema sent to the API.
// Everything else is on-demand (listed in prompt, loaded via findTools).
const CORE_TOOLS = new Set([
  'think',
  'findTools',
  'readFile',
  'listDirectory',
  'searchCode',
  'checkEnvKeys',
  'bash',
  'proposeEdit',
  'docs-search',
  'query-run',
]);

export class ChatController implements vscode.Disposable {
  private readonly _options: ChatControllerOptions;
  private _session: Session;
  private _registry: ReturnType<typeof createToolRegistry>;
  private _findTool: FindToolsTool;
  private _activeTools: ToolDefinition[] = [];
  private _pendingConsent = new Map<
    string,
    (decision: ConsentDecision) => void
  >();
  private _discoveryContext: Discovery | undefined;
  private _codeContext: CodeSelection | undefined;
  private _pendingEditFeedback: string | undefined;

  constructor(options: ChatControllerOptions) {
    this._options = options;
    this._findTool = new FindToolsTool();
    this._registry = this._buildRegistry();
    this._session = this._buildSession();
  }

  get messages(): readonly SessionMessage[] {
    return this._session.messages;
  }

  get isRunning(): boolean {
    return this._session.isRunning;
  }

  cancel(): void {
    this._session.cancel();
  }

  async send(message: string): Promise<AgentResult> {
    if (this._discoveryContext) {
      const context = buildDiscoveryContext(this._discoveryContext);
      const augmented = context + '\n\n' + message;
      this._discoveryContext = undefined;
      return this._session.send(augmented, message);
    }
    if (this._codeContext) {
      const context = buildCodeContext(this._codeContext);
      const augmented = context + '\n\n' + message;
      this._codeContext = undefined;
      return this._session.send(augmented, message);
    }
    return this._session.send(message);
  }

  resolveConsent(callId: string, decision: ConsentDecision): void {
    const handler = this._pendingConsent.get(callId);
    if (!handler) {
      return;
    }
    this._pendingConsent.delete(callId);
    handler(decision);
  }

  get pendingDiscovery(): Discovery | undefined {
    return this._discoveryContext;
  }

  setDiscoveryContext(discovery: Discovery): void {
    this._discoveryContext = discovery;
  }

  setCodeContext(context: CodeSelection): void {
    this._codeContext = context;
  }

  reset(): void {
    this._discoveryContext = undefined;
    this._codeContext = undefined;

    // Reject pending consents first so the agent loop can finish
    for (const [id, handler] of this._pendingConsent) {
      handler({ action: 'reject' });
      this._pendingConsent.delete(id);
    }

    // Only reset the session if it's idle. If it's mid-run (e.g. waiting on
    // consent we just rejected), it will finish on its own.
    if (!this._session.isRunning) {
      this._session.reset();
    }
  }

  dispose(): void {
    this.reset();
    void this._registry.dispose();
  }

  private _buildRegistry(): ReturnType<typeof createToolRegistry> {
    const { workspaceRoot, mcpClient, apiClient } = this._options;

    const tools: Tool[] = [
      new ThinkTool(),
      this._findTool,
      new ReadFileTool(workspaceRoot),
      new ListDirectoryTool(workspaceRoot),
      new SearchCodeTool(workspaceRoot),
      new CheckEnvKeysTool(workspaceRoot),
      new BashTool(workspaceRoot),
      new ProposeEditTool(workspaceRoot, this._handleEditApproval),
      new DismissDiscoveryTool((discoveryId) => {
        this._options.onDiscoveryResolved?.(discoveryId);
      }),
    ];

    if (mcpClient) {
      const hooks = this._options.onDiscoveryResolved
        ? buildMcpToolHooks(this._options.onDiscoveryResolved)
        : undefined;
      // Exclude MCP tools that have better local implementations with
      // validation, parameter transformation, and consent gates.
      const excludeMcp = new Set(['entity-search']);
      tools.push(...createMcpTools(mcpClient, hooks, excludeMcp));
    }

    if (apiClient) {
      tools.push(
        new GetAlertsTool(apiClient),
        new CreateAlertTool(apiClient),
        new UpdateAlertTool(apiClient, (alertId, enabled) => {
          if (!enabled) {
            this._options.onDiscoveryResolved?.(`firing_alert:${alertId}`);
          }
        }),
        new DeleteAlertTool(apiClient, (alertId) => {
          this._options.onDiscoveryResolved?.(`firing_alert:${alertId}`);
        }),
      );
    }

    return createToolRegistry(tools, CORE_TOOLS);
  }

  private _buildSession(): Session {
    const prompt = createSystemPromptBuilder();

    prompt.addSection({
      key: 'current-date',
      content: `Today's date: ${new Date().toISOString().split('T')[0]}`,
      priority: 2,
    });

    if (this._options.project) {
      const { name, id } = this._options.project;
      prompt.addSection({
        key: 'project-context',
        content:
          `## Active PostHog Project\n\n` +
          `Project: **${name}** (ID: ${id}). All MCP tool calls query this project. ` +
          `To switch projects, tell the user to use the "PostHog: Select Project" command.`,
        priority: 8,
      });
    }

    if (this._options.workspaceInfo) {
      prompt.addSection(
        createWorkspaceContextSection(this._options.workspaceInfo),
      );
    }

    prompt.addSection({
      key: 'tools',
      content: this._registry.toolsPromptSection,
      priority: 5,
    });

    prompt.addSection({
      key: 'chat-instructions',
      content: CHAT_INSTRUCTIONS,
      priority: 20,
    });

    const systemPrompt = prompt.build();
    // Mutable array — starts with core tools, findTools pushes on-demand defs here
    this._activeTools = [...this._registry.coreDefinitions];

    this._findTool.bindResolver((names) => {
      const loaded: string[] = [];
      const already: string[] = [];
      const notFound: string[] = [];

      for (const name of names) {
        if (this._activeTools.some((t) => t.name === name)) {
          already.push(name);
          continue;
        }
        const def = this._registry.onDemandDefinitions.get(name);
        if (def) {
          this._activeTools.push(def);
          loaded.push(name);
        } else {
          notFound.push(name);
        }
      }

      const parts: string[] = [];
      if (loaded.length)
        parts.push(`Loaded: ${loaded.join(', ')}. You can now call them.`);
      if (already.length) parts.push(`Already loaded: ${already.join(', ')}.`);
      if (notFound.length)
        parts.push(`Not found: ${notFound.join(', ')}. Check the names.`);
      return parts.join(' ');
    });

    return new Session(this._options.provider, {
      id: this._options.sessionId,
      initialMessages: this._options.initialMessages,
      systemPrompt,
      tools: this._activeTools,
      executor: this._registry.executor,
      onEvent: (event) => {
        // proposeEdit has its own approval flow, so we attach feedback here instead
        if (
          event.type === 'tool_call_result' &&
          event.call.name === 'proposeEdit' &&
          this._pendingEditFeedback
        ) {
          event.feedback = this._pendingEditFeedback;
          this._pendingEditFeedback = undefined;
        }
        this._options.onEvent(event);
      },
      agentOptions: {
        enableStreaming: true,
        onConsent: this._handleAgentConsent,
      },
      compaction: {},
    });
  }

  // For bash, setEnvValues, etc. (tools with requiresConsent flag)
  private _handleAgentConsent = async (
    call: ToolCall,
  ): Promise<ConsentDecision> => {
    return new Promise((resolve) => {
      this._pendingConsent.set(call.id, resolve);
      this._options.onConsentRequest({
        callId: call.id,
        toolName: call.name,
        args: call.arguments,
      });
    });
  };

  // For proposeEdit (uses its own approval callback)
  private _handleEditApproval = async (
    proposal: EditProposal,
  ): Promise<EditApprovalResult> => {
    const callId = `edit-${Date.now()}`;
    return new Promise((resolve) => {
      this._pendingConsent.set(callId, (decision) => {
        if (decision.action === 'respond') {
          this._pendingEditFeedback = decision.message;
          resolve({ action: 'modify', feedback: decision.message });
        } else if (decision.action === 'approve') {
          resolve({ action: 'approve' });
        } else {
          resolve({ action: 'reject' });
        }
      });
      this._options.onConsentRequest({
        callId,
        toolName: 'proposeEdit',
        args: {
          path: proposal.filePath,
          description: proposal.description,
          isNewFile: proposal.isNewFile,
        },
      });
    });
  };
}

function buildCodeContext(ctx: CodeSelection): string {
  const lines = [
    `## Selected Code`,
    '',
    `File: ${ctx.relativePath} (lines ${ctx.startLine}-${ctx.endLine})`,
    '',
    '```' + ctx.language,
    ctx.code,
    '```',
  ];
  return lines.join('\n');
}

function buildDiscoveryContext(discovery: Discovery): string {
  switch (discovery.kind) {
    case 'error':
      return buildErrorDiscoveryContext(discovery as ErrorDiscovery);
    case 'setup_issue':
      return buildSetupIssueDiscoveryContext(discovery as SetupIssueDiscovery);
    case 'firing_alert':
      return buildAlertDiscoveryContext(discovery as AlertDiscovery);
    case 'experiment_result':
      return buildExperimentDiscoveryContext(discovery as ExperimentDiscovery);
    case 'stale_flag':
    case 'flag_rollback':
      return buildFlagDiscoveryContext(discovery as FlagDiscovery);
    case 'integration_suggestion':
      return buildIntegrationSuggestionContext(
        discovery as IntegrationSuggestionDiscovery,
      );
    default:
      return `## Context: ${discovery.title}\n\n${discovery.description}`;
  }
}
