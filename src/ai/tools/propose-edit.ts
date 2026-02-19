import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveSafePath, isSensitiveFile } from './utils';
import type { Tool } from './tool';
import type { ToolDefinition, ToolCall } from '../types';

export type EditProposal = {
  filePath: string;
  description: string;
  isNewFile: boolean;
  tempFile: string;
};

export type EditApprovalResult =
  | { action: 'approve' }
  | { action: 'reject' }
  | { action: 'modify'; feedback: string };

// Pauses until the user approves, rejects, or requests a modification.
export type EditApprovalCallback = (
  proposal: EditProposal,
) => Promise<EditApprovalResult>;

const DEFINITION: ToolDefinition = {
  name: 'proposeEdit',
  description: `Propose a code edit to a file. The diff is shown to the user for review. The LLM pauses until the user accepts or rejects. Always explain what the edit does before proposing it.

Usage patterns:
- **Edit**: Set oldContent to the exact text to replace, newContent to the replacement.
- **Insert**: Set oldContent to the surrounding lines where you want to insert, newContent to those same lines with the new code added in between.
- **New file**: Omit oldContent, set newContent to the full file content.

The oldContent must match exactly one location in the file. Include enough surrounding context to make it unique.`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path from the workspace root.',
      },
      oldContent: {
        type: 'string',
        description:
          'The exact text to find and replace. Include surrounding lines for context. Omit when creating a new file.',
      },
      newContent: {
        type: 'string',
        description:
          'The replacement text (or full content when creating a new file).',
      },
      description: {
        type: 'string',
        description: 'Brief description of what the edit does.',
      },
    },
    required: ['path', 'newContent'],
    additionalProperties: false,
  },
};

export class ProposeEditTool implements Tool {
  readonly definition = DEFINITION;
  readonly category = 'action' as const;
  readonly promptSummary = 'suggest a code edit shown as a diff for review';
  private readonly _tempFiles: string[] = [];

  constructor(
    private readonly _workspaceRoot: string,
    private readonly _waitForApproval: EditApprovalCallback,
  ) {}

  async execute(call: ToolCall): Promise<string> {
    const filePath = String(call.arguments['path'] ?? '');
    const oldContent = call.arguments['oldContent'] as string | undefined;
    const newContent = String(call.arguments['newContent'] ?? '');
    const description = String(
      call.arguments['description'] ?? 'Proposed edit',
    );

    if (!filePath) {
      return 'Error: path is required';
    }

    if (!newContent) {
      return 'Error: newContent is required';
    }

    if (isSensitiveFile(filePath)) {
      return 'Error: cannot edit sensitive files (may contain secrets)';
    }

    const resolved = await resolveSafePath(this._workspaceRoot, filePath);
    if (!resolved) {
      return 'Error: path is outside the workspace';
    }

    const isNewFile = !oldContent;
    const proposedContent = await buildProposedContent(
      resolved,
      oldContent,
      newContent,
    );

    if (typeof proposedContent !== 'string') {
      return proposedContent.error;
    }

    let tempFile: string;
    try {
      tempFile = await writeTempFile(filePath, proposedContent);
      this._tempFiles.push(tempFile);

      const tempUri = vscode.Uri.file(tempFile);
      const diffTitle = `[PostHog Companion] ${path.basename(filePath)}`;

      if (isNewFile) {
        // For new files, diff against an empty untitled document
        const emptyFile = await writeTempFile(filePath + '.empty', '');
        this._tempFiles.push(emptyFile);
        await vscode.commands.executeCommand(
          'vscode.diff',
          vscode.Uri.file(emptyFile),
          tempUri,
          diffTitle,
        );
      } else {
        await vscode.commands.executeCommand(
          'vscode.diff',
          vscode.Uri.file(resolved),
          tempUri,
          diffTitle,
        );
      }
    } catch (err) {
      return `Error opening diff: ${err instanceof Error ? err.message : 'unknown error'}`;
    }

    const result = await this._waitForApproval({
      filePath,
      description,
      isNewFile,
      tempFile,
    });

    if (result.action === 'reject') {
      closeDiffTab(tempFile);
      return `Edit rejected by user for ${filePath}.`;
    }

    if (result.action === 'modify') {
      closeDiffTab(tempFile);
      return `User requested changes to the proposed edit for ${filePath}: ${result.feedback}`;
    }

    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, proposedContent, 'utf-8');
      closeDiffTab(tempFile);
      return `Edit applied to ${filePath}: ${description}`;
    } catch (err) {
      return `Error writing file: ${err instanceof Error ? err.message : 'unknown error'}`;
    }
  }

  async dispose(): Promise<void> {
    for (const tempFile of this._tempFiles) {
      try {
        await fs.unlink(tempFile);
      } catch {
        // Best-effort cleanup
      }
    }
    this._tempFiles.length = 0;
  }
}

async function buildProposedContent(
  resolvedPath: string,
  oldContent: string | undefined,
  newContent: string,
): Promise<string | { error: string }> {
  if (!oldContent) {
    try {
      await fs.access(resolvedPath);
      return {
        error:
          'Error: file already exists. Provide oldContent to edit an existing file.',
      };
    } catch {
      return newContent;
    }
  }

  let original: string;
  try {
    original = await fs.readFile(resolvedPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        error: 'Error: file not found. Omit oldContent to create a new file.',
      };
    }
    throw err;
  }

  const index = original.indexOf(oldContent);
  if (index === -1) {
    return {
      error:
        'Error: oldContent not found in file. Ensure the search text matches exactly.',
    };
  }

  const secondIndex = original.indexOf(oldContent, index + 1);
  if (secondIndex !== -1) {
    return {
      error:
        'Error: oldContent matches multiple locations. Provide more surrounding context to make it unique.',
    };
  }

  return (
    original.slice(0, index) +
    newContent +
    original.slice(index + oldContent.length)
  );
}

async function writeTempFile(
  originalPath: string,
  content: string,
): Promise<string> {
  const ext = path.extname(originalPath);
  const tempFile = path.join(
    os.tmpdir(),
    `posthog-edit-${crypto.randomUUID()}${ext}`,
  );
  await fs.writeFile(tempFile, content, 'utf-8');
  return tempFile;
}

function closeDiffTab(tempFilePath: string): void {
  const tempUri = vscode.Uri.file(tempFilePath);
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        input &&
        typeof input === 'object' &&
        'modified' in input &&
        (input as { modified: vscode.Uri }).modified.fsPath === tempUri.fsPath
      ) {
        void vscode.window.tabGroups.close(tab);
        return;
      }
    }
  }
}
