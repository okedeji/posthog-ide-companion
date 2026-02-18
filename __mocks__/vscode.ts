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
  tabGroups: {
    all: [],
    close: jest.fn(async () => undefined),
  },
  registerWebviewViewProvider: jest.fn(() => ({ dispose: () => undefined })),
  registerWebviewPanelSerializer: jest.fn(() => ({ dispose: () => undefined })),
  createWebviewPanel: jest.fn(
    (
      _viewType: string,
      title: string,
      _column: number,
      options?: Record<string, unknown>,
    ) => ({
      title,
      webview: {
        html: '',
        options: options ?? {},
        postMessage: jest.fn(async () => true),
        onDidReceiveMessage: jest.fn(),
        cspSource: 'https://test.vscode-cdn.net',
        asWebviewUri: jest.fn((uri: unknown) => uri),
      },
      reveal: jest.fn(),
      onDidDispose: jest.fn(),
      dispose: jest.fn(),
    }),
  ),
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

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}

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
  static file(path: string): Uri {
    return new Uri(path);
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri([base.fsPath, ...segments].join('/'));
  }
  private constructor(public readonly fsPath: string) {}
}
