import * as vscode from 'vscode';
import type { ConflictResult, ScanResult } from '../core/types';

/**
 * Manages the "MergeGuard" DiagnosticCollection.
 * Populates the Problems panel with predicted merge conflicts as warnings.
 */
export class DiagnosticsController implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private enabled = true;
  private gitRoot = '';

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('MergeGuard');
  }

  /** Replace all diagnostics from a new scan result. */
  update(scan: ScanResult, gitRoot: string): void {
    this.gitRoot = gitRoot;
    this.collection.clear();

    if (!this.enabled) return;

    // Group conflicts by file path across all branches
    const byFile = new Map<string, Array<{ result: ConflictResult; fileIndex: number }>>();

    for (const result of scan.results) {
      if (result.status === 'error') continue;
      for (let fi = 0; fi < result.files.length; fi++) {
        const file = result.files[fi];
        const entries = byFile.get(file.path) ?? [];
        entries.push({ result, fileIndex: fi });
        byFile.set(file.path, entries);
      }
    }

    for (const [filePath, entries] of byFile) {
      const uri = vscode.Uri.file(`${this.gitRoot}/${filePath}`);
      const diagnostics: vscode.Diagnostic[] = [];

      for (const { result, fileIndex } of entries) {
        const file = result.files[fileIndex];
        const conflictLabel = file.conflictType.replace('-', ' ');

        if (file.lineRanges.length > 0) {
          for (const lr of file.lineRanges) {
            const range = new vscode.Range(
              new vscode.Position(lr.startLine - 1, 0),
              new vscode.Position(lr.endLine - 1, Number.MAX_SAFE_INTEGER),
            );
            const diag = new vscode.Diagnostic(
              range,
              vscode.l10n.t("Potential merge conflict with '{0}' ({1})", result.branch, conflictLabel),
              vscode.DiagnosticSeverity.Warning,
            );
            diag.source = 'MergeGuard';
            diagnostics.push(diag);
          }
        } else {
          // Whole-file conflict (no specific line ranges)
          const range = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(0, 0),
          );
          const diag = new vscode.Diagnostic(
            range,
            vscode.l10n.t("Potential merge conflict with '{0}' ({1})", result.branch, conflictLabel),
            vscode.DiagnosticSeverity.Warning,
          );
          diag.source = 'MergeGuard';
          diagnostics.push(diag);
        }
      }

      this.collection.set(uri, diagnostics);
    }
  }

  /** Clear all diagnostics. */
  clear(): void {
    this.collection.clear();
  }

  /** Enable or disable populating the Problems panel. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.collection.clear();
    }
  }

  /** Get diagnostics for a specific URI (useful for testing). */
  getDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
    return this.collection.get(uri) ?? [];
  }

  dispose(): void {
    this.collection.dispose();
  }
}
