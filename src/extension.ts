import * as vscode from 'vscode';
import { ExtensionHost } from './extension-host';
import { createLogger } from './utils/logger';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('PostHog');
  const logger = createLogger(channel);
  logger.info('PostHog IDE Companion activating');

  const host = new ExtensionHost(context, logger);
  context.subscriptions.push(host);
  host.registerCommands();
  void host.initialize();
}

export function deactivate(): void {
  // no-op: lifecycle managed by context.subscriptions
}
