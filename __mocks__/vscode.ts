/**
 * Mock implementation of the vscode module for unit tests.
 * Only stubs the APIs actually used by production code.
 */

export const window = {
  createOutputChannel: () => ({
    appendLine: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
  }),
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showWarningMessage: async () => undefined,
};

export const workspace = {
  getConfiguration: () => ({
    get: () => undefined,
  }),
};

export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
};

export class TreeItem {
  label: string;
  constructor(label: string) {
    this.label = label;
  }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class EventEmitter {
  event = () => ({ dispose: () => undefined });
  fire(): void {
    /* noop */
  }
  dispose(): void {
    /* noop */
  }
}

export class Uri {
  static parse(value: string): Uri {
    return new Uri(value);
  }
  private constructor(public readonly fsPath: string) {}
}
