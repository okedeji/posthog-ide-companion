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
  showInformationMessage: jest.fn(async () => undefined),
  showErrorMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showQuickPick: jest.fn(async () => undefined),
  showInputBox: jest.fn(async () => undefined),
  createTreeView: jest.fn(() => ({
    dispose: () => undefined,
  })),
  createStatusBarItem: jest.fn(() => ({
    show: jest.fn(),
    dispose: jest.fn(),
    text: '',
    command: '',
    tooltip: '',
  })),
};

export const workspace = {
  getConfiguration: jest.fn(() => ({
    get: jest.fn(() => undefined),
    update: jest.fn(async () => undefined),
  })),
};

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

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

export class ThemeIcon {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
}

export class Uri {
  static parse(value: string): Uri {
    return new Uri(value);
  }
  private constructor(public readonly fsPath: string) {}
}
