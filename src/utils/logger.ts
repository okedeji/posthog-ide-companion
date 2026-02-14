import type * as vscode from 'vscode';

/** Logger instance returned by {@link createLogger}. */
export type Logger = {
  info: (message: string) => void;
  error: (message: string, err?: unknown) => void;
  debug: (message: string) => void;
};

/**
 * Creates a structured logger that writes to a VSCode output channel.
 * Every entry is timestamped in ISO-8601 format.
 *
 * @param channel - The VSCode output channel to write to.
 * @returns A logger with info, error, and debug methods.
 */
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
