import * as vscode from 'vscode';
import type { ScanResult } from '../core/types';

/**
 * Provides file decoration badges in the Explorer for files with predicted conflicts.
 * Each conflicted file shows a warning badge with the number of conflicting branches.
 */
export class ConflictFileDecorationProvider
  implements vscode.FileDecorationProvider
{
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  /** Map from absolute file path → number of branches with conflicts. */
  private conflictCounts = new Map<string, number>();
  private gitRoot = '';

  /** Update the decoration data from a scan result. */
  update(scan: ScanResult, gitRoot: string): void {
    this.gitRoot = gitRoot;
    this.conflictCounts.clear();

    for (const result of scan.results) {
      if (result.status === 'error') continue;
      for (const file of result.files) {
        const absPath = `${gitRoot}/${file.path}`;
        const count = this.conflictCounts.get(absPath) ?? 0;
        this.conflictCounts.set(absPath, count + 1);
      }
    }

    this._onDidChangeFileDecorations.fire(undefined);
  }

  /** Clear all decorations. */
  clear(): void {
    this.conflictCounts.clear();
    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const count = this.conflictCounts.get(uri.fsPath);
    if (!count) return undefined;

    return {
      badge: String(count),
      tooltip: `${count} branch${count === 1 ? '' : 'es'} with conflicts`,
      color: new vscode.ThemeColor('list.warningForeground'),
      propagate: false,
    };
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
    this.conflictCounts.clear();
  }
}
