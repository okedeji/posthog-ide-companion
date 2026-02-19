import * as vscode from 'vscode';
import type { Logger } from '../../utils/logger';

export const DEFAULT_POLL_INTERVAL_MS = 300_000; // 5 min

export type PollerOptions<T> = {
  label: string;
  fetchFn: () => Promise<T>;
  intervalMs: number;
  logger?: Logger;
};

export class Poller<T> implements vscode.Disposable {
  private readonly _onDidPoll = new vscode.EventEmitter<T>();
  readonly onDidPoll = this._onDidPoll.event;

  private timer: ReturnType<typeof setInterval> | undefined;
  private inflight = false;

  constructor(private readonly options: PollerOptions<T>) {}

  start(): void {
    if (this.timer) {
      return;
    }

    this.options.logger?.info(`"${this.options.label}" poller started`);

    void this.execute();

    this.timer = setInterval(() => {
      void this.execute();
    }, this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.options.logger?.info(`"${this.options.label}" poller stopped`);
    }
  }

  async pollNow(): Promise<void> {
    return this.execute();
  }

  dispose(): void {
    this.stop();
    this._onDidPoll.dispose();
  }

  private async execute(): Promise<void> {
    if (this.inflight) {
      return;
    }

    this.inflight = true;
    try {
      const result = await this.options.fetchFn();
      this._onDidPoll.fire(result);
    } catch (err) {
      this.options.logger?.error(`[${this.options.label}] poll failed`, err);
    } finally {
      this.inflight = false;
    }
  }
}
