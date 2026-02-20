import * as vscode from 'vscode';

export class SendToChatCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  refresh(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._onDidChangeCodeLenses.fire();
    }, 150);
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) {
      return [];
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      return [];
    }

    const range = new vscode.Range(
      selection.start.line,
      0,
      selection.start.line,
      0,
    );
    return [
      new vscode.CodeLens(range, {
        title: 'Send to PostHog Chat',
        command: 'posthog.sendToChat',
        tooltip: 'Send selected code to PostHog Chat',
      }),
    ];
  }

  dispose(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._onDidChangeCodeLenses.dispose();
  }
}
