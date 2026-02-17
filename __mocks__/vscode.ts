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

export const authentication = {
  registerAuthenticationProvider: jest.fn(() => ({ dispose: () => undefined })),
  getSession: jest.fn(async () => undefined),
};

export const commands = {
  registerCommand: jest.fn(() => ({ dispose: () => undefined })),
  executeCommand: jest.fn(async () => undefined),
};

export const env = {
  openExternal: jest.fn(async () => true),
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export class TreeItem {
  label: string;
  collapsibleState?: number;
  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
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

export class ThemeColor {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
}

export class ThemeIcon {
  readonly id: string;
  readonly color?: ThemeColor;
  constructor(id: string, color?: ThemeColor) {
    this.id = id;
    this.color = color;
  }
}

export class Uri {
  static parse(value: string): Uri {
    return new Uri(value);
  }
  private constructor(public readonly fsPath: string) {}
}
