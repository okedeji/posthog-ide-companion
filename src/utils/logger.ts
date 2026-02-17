import type * as vscode from 'vscode';

export type Logger = {
  info: (message: string) => void;
  error: (message: string, err?: unknown) => void;
  debug: (message: string) => void;
};

export function createLogger(channel: vscode.OutputChannel): Logger {
  return {
    info: (message: string): void => {
      channel.appendLine(`[INFO] ${new Date().toISOString()} ${message}`);
    },
    error: (message: string, err?: unknown): void => {
      channel.appendLine(`[ERROR] ${new Date().toISOString()} ${message}`);
      if (err instanceof Error) {
        channel.appendLine(`  ${err.stack ?? err.message}`);
      }
    },
    debug: (message: string): void => {
      channel.appendLine(`[DEBUG] ${new Date().toISOString()} ${message}`);
    },
  };
}
