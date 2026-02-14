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
  showQuickPick: jest.fn(async () => undefined),
  registerWebviewViewProvider: jest.fn(() => ({
    dispose: () => undefined,
  })),
};

export const workspace = {
  getConfiguration: () => ({
    get: () => undefined,
  }),
};

export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
  executeCommand: jest.fn(async () => undefined),
};

export const env = {
  openExternal: jest.fn(async () => true),
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
  private listeners: ((...args: unknown[]) => void)[] = [];

  event = (listener: (...args: unknown[]) => void) => {
    this.listeners.push(listener);
    return { dispose: () => undefined };
  };

  fire(...args: unknown[]): void {
    for (const listener of this.listeners) {
      listener(...args);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

export class Uri {
  static parse(value: string): Uri {
    return new Uri(value);
  }
  private constructor(public readonly fsPath: string) {}
}
