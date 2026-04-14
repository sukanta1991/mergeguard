import * as vscode from 'vscode';
import type { ConflictFile, ConflictResult, ScanResult } from '../core/types';
import { ConflictType } from '../core/types';

/**
 * Decoration type presets for different conflict types.
 */
function createDecorationTypes(): Map<ConflictType, vscode.TextEditorDecorationType> {
  const map = new Map<ConflictType, vscode.TextEditorDecorationType>();

  map.set(
    ConflictType.Content,
    vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('mergeguard.conflictHighlight'),
      overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      gutterIconPath: new vscode.ThemeIcon('warning').id,
      isWholeLine: true,
    }),
  );

  map.set(
    ConflictType.Rename,
    vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('mergeguard.conflictHighlight'),
      overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true,
      border: '1px dashed',
      borderColor: new vscode.ThemeColor('editorInfo.foreground'),
    }),
  );

  map.set(
    ConflictType.Delete,
    vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('mergeguard.conflictHighlight'),
      overviewRulerColor: new vscode.ThemeColor('editorError.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true,
    }),
  );

  // Default for Binary, Directory, ModeChange
  const defaultType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('mergeguard.conflictHighlight'),
    overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    isWholeLine: true,
  });
  map.set(ConflictType.Binary, defaultType);
  map.set(ConflictType.Directory, defaultType);
  map.set(ConflictType.ModeChange, defaultType);

  return map;
}

/** Lookup key for file-level conflicts: relative path → ConflictFile[] across all branches. */
export interface FileConflictInfo {
  file: ConflictFile;
  branch: string;
}

/**
 * Manages inline editor decorations for predicted conflicts.
 * Highlights conflict regions in the editor gutter and overview ruler.
 */
export class DecorationController implements vscode.Disposable {
  private decorationTypes: Map<ConflictType, vscode.TextEditorDecorationType>;
  /** Map from relative file path to conflict info across all branches. */
  private conflictsByFile = new Map<string, FileConflictInfo[]>();
  private gitRoot = '';
  private enabled = true;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.decorationTypes = createDecorationTypes();

    // Re-apply when active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.applyToActiveEditor()),
    );
  }

  /** Update stored conflicts from a scan result and re-decorate. */
  update(scan: ScanResult, gitRoot: string): void {
    this.gitRoot = gitRoot;
    this.conflictsByFile.clear();

    for (const result of scan.results) {
      if (result.status === 'error') continue;
      for (const file of result.files) {
        const existing = this.conflictsByFile.get(file.path) ?? [];
        existing.push({ file, branch: result.branch });
        this.conflictsByFile.set(file.path, existing);
      }
    }

    this.applyToActiveEditor();
  }

  /** Clear all decorations. */
  clear(): void {
    this.conflictsByFile.clear();
    this.clearActiveEditorDecorations();
  }

  /** Enable or disable decorations. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearActiveEditorDecorations();
    } else {
      this.applyToActiveEditor();
    }
  }

  /** Get all conflict info entries for a given relative path. */
  getConflictsForFile(relativePath: string): FileConflictInfo[] {
    return this.conflictsByFile.get(relativePath) ?? [];
  }

  /** Check whether any conflicts are tracked. */
  hasConflicts(): boolean {
    return this.conflictsByFile.size > 0;
  }

  /** Get all tracked relative file paths. */
  getConflictedPaths(): string[] {
    return [...this.conflictsByFile.keys()];
  }

  private applyToActiveEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.enabled) return;

    // Resolve relative path from the editor URI
    const filePath = editor.document.uri.fsPath;
    const relativePath = this.toRelativePath(filePath);
    if (!relativePath) {
      this.clearEditorDecorations(editor);
      return;
    }

    const infos = this.conflictsByFile.get(relativePath);
    if (!infos || infos.length === 0) {
      this.clearEditorDecorations(editor);
      return;
    }

    // Group ranges by conflict type
    const rangesByType = new Map<ConflictType, vscode.Range[]>();
    for (const info of infos) {
      const ranges = rangesByType.get(info.file.conflictType) ?? [];
      for (const lr of info.file.lineRanges) {
        ranges.push(
          new vscode.Range(
            new vscode.Position(lr.startLine - 1, 0),
            new vscode.Position(lr.endLine - 1, Number.MAX_SAFE_INTEGER),
          ),
        );
      }
      rangesByType.set(info.file.conflictType, ranges);
    }

    // Apply each decoration type
    for (const [type, decType] of this.decorationTypes) {
      const ranges = rangesByType.get(type) ?? [];
      editor.setDecorations(decType, ranges);
    }
  }

  private clearActiveEditorDecorations(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.clearEditorDecorations(editor);
    }
  }

  private clearEditorDecorations(editor: vscode.TextEditor): void {
    for (const decType of this.decorationTypes.values()) {
      editor.setDecorations(decType, []);
    }
  }

  private toRelativePath(absPath: string): string | undefined {
    if (!this.gitRoot) return undefined;
    const prefix = this.gitRoot.endsWith('/') ? this.gitRoot : this.gitRoot + '/';
    if (absPath.startsWith(prefix)) {
      return absPath.slice(prefix.length);
    }
    return undefined;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const decType of this.decorationTypes.values()) {
      decType.dispose();
    }
    this.decorationTypes.clear();
    this.conflictsByFile.clear();
  }
}
