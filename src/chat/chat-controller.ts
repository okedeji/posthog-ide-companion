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
import {
  CHAT_INSTRUCTIONS,
  buildErrorDiscoveryContext,
  buildSetupIssueDiscoveryContext,
  buildAlertDiscoveryContext,
  buildExperimentDiscoveryContext,
  buildFlagDiscoveryContext,
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
import { CreateFeatureFlagTool } from '../ai/tools/create-feature-flag';
import { UpdateFeatureFlagTool } from '../ai/tools/update-feature-flag';
import { CreateExperimentTool } from '../ai/tools/create-experiment';
import { UpdateExperimentTool } from '../ai/tools/update-experiment';
import { CreateInsightTool } from '../ai/tools/create-insight';
import { CreateDashboardTool } from '../ai/tools/create-dashboard';
import { AddInsightToDashboardTool } from '../ai/tools/add-insight-to-dashboard';
import { CreateSurveyTool } from '../ai/tools/create-survey';
import { UpdateSurveyTool } from '../ai/tools/update-survey';
import { UpdateErrorStatusTool } from '../ai/tools/update-error-status';
import { DismissDiscoveryTool } from '../ai/tools/dismiss-discovery';
import type { WorkspaceInfo } from '../workspace/types';
import type { Logger } from '../utils/logger';
import type {
  Discovery,
  ErrorDiscovery,
  SetupIssueDiscovery,
  AlertDiscovery,
  ExperimentDiscovery,
  FlagDiscovery,
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
  onEvent: AgentEventCallback;
  onConsentRequest: (request: ConsentRequest) => void;
  onDiscoveryResolved?: (discoveryId: string) => void;
};

export class ChatController implements vscode.Disposable {
  private readonly _options: ChatControllerOptions;
  private _session: Session;
  private _registry: ReturnType<typeof createToolRegistry>;
  private _pendingConsent = new Map<
    string,
    (decision: ConsentDecision) => void
  >();
  private _discoveryContext: Discovery | undefined;
  private _pendingEditFeedback: string | undefined;

  constructor(options: ChatControllerOptions) {
    this._options = options;
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

  reset(): void {
    this._discoveryContext = undefined;

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
      tools.push(...createMcpTools(mcpClient));
    }

    if (apiClient) {
      tools.push(
        new CreateFeatureFlagTool(apiClient),
        new UpdateFeatureFlagTool(apiClient),
        new CreateExperimentTool(apiClient),
        new UpdateExperimentTool(apiClient),
        new CreateInsightTool(apiClient),
        new CreateDashboardTool(apiClient),
        new AddInsightToDashboardTool(apiClient),
        new CreateSurveyTool(apiClient),
        new UpdateSurveyTool(apiClient),
        new UpdateErrorStatusTool(apiClient, (errorId, status) => {
          if (status !== 'active') {
            this._options.onDiscoveryResolved?.(`error:${errorId}`);
          }
        }),
      );
    }

    return createToolRegistry(tools);
  }

  private _buildSession(): Session {
    const prompt = createSystemPromptBuilder();

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

    return new Session(this._options.provider, {
      systemPrompt: prompt.build(),
      tools: this._registry.definitions,
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
    default:
      return `## Context: ${discovery.title}\n\n${discovery.description}`;
  }
}
