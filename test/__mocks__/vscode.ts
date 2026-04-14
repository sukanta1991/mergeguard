/**
 * Minimal mock of the vscode module for unit testing.
 * Stubs the APIs that our extension modules use.
 */

type Listener<T> = (e: T) => void;

export class EventEmitter<T> {
  private listeners: Listener<T>[] = [];

  get event(): (listener: Listener<T>) => { dispose: () => void } {
    return (listener: Listener<T>) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          const idx = this.listeners.indexOf(listener);
          if (idx >= 0) this.listeners.splice(idx, 1);
        },
      };
    };
  }

  fire(data: T): void {
    for (const l of this.listeners) {
      l(data);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

export class RelativePattern {
  constructor(
    public base: { fsPath: string } | string,
    public pattern: string,
  ) {}
}

const noopWatcher = {
  onDidChange: () => ({ dispose: () => {} }),
  onDidCreate: () => ({ dispose: () => {} }),
  onDidDelete: () => ({ dispose: () => {} }),
  dispose: () => {},
};

export const workspace = {
  workspaceFolders: undefined as
    | Array<{ uri: { fsPath: string }; name: string; index: number }>
    | undefined,
  createFileSystemWatcher: () => noopWatcher,
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T => {
      if (section === 'mergeguard' && key === 'trackedBranches') {
        return ['main', 'master', 'develop'] as unknown as T;
      }
      return defaultValue as T;
    },
    update: async () => {},
  }),
  onDidSaveTextDocument: () => ({ dispose: () => {} }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  registerTextDocumentContentProvider: () => ({ dispose: () => {} }),
};

export class ThemeColor {
  constructor(public id: string) {}
}

export class ThemeIcon {
  constructor(
    public id: string,
    public color?: ThemeColor,
  ) {}
}

export enum OverviewRulerLane {
  Left = 1,
  Center = 2,
  Right = 4,
  Full = 7,
}

export class MarkdownString {
  value: string;
  isTrusted = false;
  supportThemeIcons = false;

  constructor(value = '', _supportThemeIcons = false) {
    this.value = value;
    this.supportThemeIcons = _supportThemeIcons;
  }

  appendMarkdown(value: string): this {
    this.value += value;
    return this;
  }

  appendText(value: string): this {
    this.value += value;
    return this;
  }
}

export class Hover {
  contents: MarkdownString[];
  range?: Range;
  constructor(contents: MarkdownString | MarkdownString[], range?: Range) {
    this.contents = Array.isArray(contents) ? contents : [contents];
    this.range = range;
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;
  source?: string;
  code?: string | number;

  constructor(range: Range, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

/** In-memory DiagnosticCollection mock. */
class MockDiagnosticCollection {
  name: string;
  private store = new Map<string, Diagnostic[]>();

  constructor(name: string) {
    this.name = name;
  }

  set(uri: { fsPath: string }, diagnostics: Diagnostic[]): void {
    this.store.set(uri.fsPath, diagnostics);
  }

  get(uri: { fsPath: string }): Diagnostic[] | undefined {
    return this.store.get(uri.fsPath);
  }

  clear(): void {
    this.store.clear();
  }

  dispose(): void {
    this.store.clear();
  }
}

export const languages = {
  createDiagnosticCollection: (name: string) => new MockDiagnosticCollection(name),
  registerHoverProvider: () => ({ dispose: () => {} }),
  registerCodeLensProvider: () => ({ dispose: () => {} }),
};

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label?: string;
  id?: string;
  description?: string;
  tooltip?: string;
  collapsibleState?: TreeItemCollapsibleState;
  iconPath?: ThemeIcon | { light: string; dark: string };
  contextValue?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  resourceUri?: { fsPath: string; scheme: string };

  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class Range {
  start: Position;
  end: Position;
  constructor(startLineOrPos: number | Position, startCharOrEnd: number | Position, endLine?: number, endChar?: number) {
    if (typeof startLineOrPos === 'number') {
      this.start = new Position(startLineOrPos, startCharOrEnd as number);
      this.end = new Position(endLine!, endChar!);
    } else {
      this.start = startLineOrPos;
      this.end = startCharOrEnd as Position;
    }
  }
}

export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export const window = {
  createOutputChannel: () => ({
    appendLine: () => {},
    show: () => {},
    dispose: () => {},
  }),
  createStatusBarItem: (alignment?: StatusBarAlignment, priority?: number) => ({
    alignment: alignment ?? StatusBarAlignment.Left,
    priority: priority ?? 0,
    text: '',
    tooltip: '' as string | undefined,
    command: '' as string | undefined,
    name: '' as string | undefined,
    backgroundColor: undefined as ThemeColor | undefined,
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  createTextEditorDecorationType: (options: Record<string, unknown>) => ({
    key: `dec-${Math.random().toString(36).slice(2, 8)}`,
    options,
    dispose: () => {},
  }),
  createTreeView: () => ({ dispose: () => {}, badge: undefined as { value: number; tooltip: string } | undefined }),
  registerFileDecorationProvider: () => ({ dispose: () => {} }),
  onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
  showQuickPick: async () => undefined,
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  createWebviewPanel: (
    _viewType: string,
    _title: string,
    _showOptions: unknown,
    _options?: unknown,
  ) => {
    const emitter = new EventEmitter<unknown>();
    return {
      webview: {
        html: '',
        onDidReceiveMessage: emitter.event,
        postMessage: async () => true,
      },
      reveal: () => {},
      onDidDispose: () => ({ dispose: () => {} }),
      dispose: () => {},
      visible: true,
      iconPath: undefined as unknown,
    };
  },
  activeTextEditor: undefined as
    | {
        document: { uri: { fsPath: string }; languageId: string };
        setDecorations: (type: unknown, ranges: unknown[]) => void;
      }
    | undefined,
};

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file' }),
  parse: (value: string) => {
    const url = new URL(value);
    return {
      scheme: url.protocol.replace(':', ''),
      authority: url.hostname,
      path: decodeURIComponent(url.pathname),
      query: url.search.replace('?', ''),
      fragment: url.hash.replace('#', ''),
      fsPath: decodeURIComponent(url.pathname),
    };
  },
};

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export class CodeLens {
  range: Range;
  command?: { command: string; title: string; arguments?: unknown[]; tooltip?: string };
  constructor(range: Range, command?: { command: string; title: string; arguments?: unknown[]; tooltip?: string }) {
    this.range = range;
    this.command = command;
  }
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}

export const commands = {
  registerCommand: (_command: string, _callback: (...args: unknown[]) => unknown) => ({
    dispose: () => {},
  }),
  executeCommand: async (..._args: unknown[]) => {},
};

export const authentication = {
  getSession: async (_providerId: string, _scopes: string[], _options?: unknown) => undefined as
    | { accessToken: string; account: { label: string }; id: string; scopes: string[] }
    | undefined,
};

export const l10n = {
  t: (message: string, ...args: Array<string | number>) => {
    let result = message;
    for (let i = 0; i < args.length; i++) {
      result = result.replace(`{${i}}`, String(args[i]));
    }
    return result;
  },
};

export const env = {
  isTelemetryEnabled: true,
  createTelemetryLogger: (sender: { sendEventData: (...args: unknown[]) => void; sendErrorData: (...args: unknown[]) => void }) => ({
    logUsage: (_eventName: string, _data?: Record<string, string>) => {},
    logError: (_eventName: string, _data?: Record<string, string>) => {},
    dispose: () => {},
  }),
};
