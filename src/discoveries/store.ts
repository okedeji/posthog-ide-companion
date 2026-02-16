import * as vscode from 'vscode';
import type { Discovery, DiscoveryKind } from './types';

/** In-memory state for all discoveries. Repopulated by pollers on each restart. */
export class DiscoveryStore implements vscode.Disposable {
  private readonly items = new Map<string, Discovery>();

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  get count(): number {
    return this.items.size;
  }

  getAll(): Discovery[] {
    return [...this.items.values()].sort(
      (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
    );
  }

  getByKind(kind: DiscoveryKind): Discovery[] {
    return this.getAll().filter((d) => d.kind === kind);
  }

  /**
   * Upsert discoveries by id. Updates existing entries but only counts genuinely
   * new ids. Returns the number of new discoveries added.
   */
  merge(discoveries: Discovery[]): number {
    let newCount = 0;

    for (const discovery of discoveries) {
      const existing = this.items.get(discovery.id);
      if (!existing) {
        newCount++;
      }
      this.items.set(discovery.id, discovery);
    }

    if (discoveries.length > 0) {
      this._onDidChange.fire();
    }

    return newCount;
  }

  clear(): void {
    if (this.items.size === 0) {
      return;
    }
    this.items.clear();
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
