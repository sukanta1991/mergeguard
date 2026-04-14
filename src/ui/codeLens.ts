import * as vscode from 'vscode';
import type { ScanResult, ConflictFile, LineRange } from '../core/types';

/**
 * Provides CodeLens annotations for files that have predicted merge conflicts.
 *
 * Shows:
 *  - A file-level lens at the top: "MergeGuard: N conflict(s) in this file"
 *  - Region-level lenses above each conflict region: "⚠ Conflicts with <branch> (lines X–Y)"
 *  - Multi-branch lenses when multiple branches conflict at the same region
 */
export class ConflictCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private scanResult: ScanResult | undefined;
  private gitRoot = '';
  private enabled = true;

  /** Update with new scan results; fires a change event to refresh lenses. */
  update(scan: ScanResult, gitRoot: string): void {
    this.scanResult = scan;
    this.gitRoot = gitRoot;
    this._onDidChangeCodeLenses.fire();
  }

  /** Clear all lenses. */
  clear(): void {
    this.scanResult = undefined;
    this._onDidChangeCodeLenses.fire();
  }

  /** Enable or disable CodeLens rendering. */
  setEnabled(enabled: boolean): void {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this._onDidChangeCodeLenses.fire();
    }
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.enabled || !this.scanResult) return [];

    const relativePath = this.getRelativePath(document.uri.fsPath);
    if (!relativePath) return [];

    // Collect all branches that conflict on this file, aggregated by region
    const fileConflicts = this.getFileConflicts(relativePath);
    if (fileConflicts.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];

    // ── File-level lens at line 0 ──────────────────
    const totalRegions = fileConflicts.reduce(
      (sum, fc) => sum + Math.max(fc.file.lineRanges.length, 1),
      0,
    );
    const branchNames = [...new Set(fileConflicts.map((fc) => fc.branch))];

    lenses.push(
      new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: `$(shield) MergeGuard: ${totalRegions} conflict${totalRegions !== 1 ? 's' : ''} in this file`,
        command: 'mergeguard.conflictsView.focus',
        tooltip: `Conflicts with: ${branchNames.join(', ')}`,
      }),
    );

    // ── Region-level lenses ────────────────────────
    // Group conflicts by line range to handle multi-branch overlaps
    const regionMap = new Map<string, { range: LineRange; branches: string[] }>();

    for (const { file, branch } of fileConflicts) {
      if (file.lineRanges.length === 0) {
        // Whole-file conflict — show at line 0
        const key = '0-0';
        const entry = regionMap.get(key);
        if (entry) {
          if (!entry.branches.includes(branch)) entry.branches.push(branch);
        } else {
          regionMap.set(key, { range: { startLine: 0, endLine: 0 }, branches: [branch] });
        }
      } else {
        for (const lr of file.lineRanges) {
          const key = `${lr.startLine}-${lr.endLine}`;
          const entry = regionMap.get(key);
          if (entry) {
            if (!entry.branches.includes(branch)) entry.branches.push(branch);
          } else {
            regionMap.set(key, { range: lr, branches: [branch] });
          }
        }
      }
    }

    for (const [, { range, branches }] of regionMap) {
      const line = Math.max(0, range.startLine - 1); // CodeLens appears above the line

      if (branches.length === 1) {
        const branch = branches[0];
        const rangeLabel =
          range.startLine === range.endLine && range.startLine === 0
            ? ''
            : ` (lines ${range.startLine}–${range.endLine})`;

        lenses.push(
          new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
            title: `$(warning) Conflicts with ${branch}${rangeLabel}`,
            command: 'mergeguard.previewConflict',
            arguments: [relativePath, branch],
            tooltip: `Click to open diff preview with ${branch}`,
          }),
        );
      } else {
        const rangeLabel =
          range.startLine === range.endLine && range.startLine === 0
            ? ''
            : ` (lines ${range.startLine}–${range.endLine})`;

        lenses.push(
          new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
            title: `$(warning) ${branches.length} branches conflict here${rangeLabel}`,
            command: 'mergeguard.previewConflict',
            arguments: [relativePath, branches[0]],
            tooltip: `Conflicts with: ${branches.join(', ')}`,
          }),
        );
      }
    }

    return lenses;
  }

  // ── Helpers ────────────────────────────────────

  private getRelativePath(fsPath: string): string | undefined {
    if (!this.gitRoot) return undefined;
    const prefix = this.gitRoot.endsWith('/') ? this.gitRoot : `${this.gitRoot}/`;
    if (!fsPath.startsWith(prefix)) return undefined;
    return fsPath.slice(prefix.length);
  }

  private getFileConflicts(
    relativePath: string,
  ): Array<{ branch: string; file: ConflictFile }> {
    if (!this.scanResult) return [];
    const hits: Array<{ branch: string; file: ConflictFile }> = [];
    for (const result of this.scanResult.results) {
      for (const file of result.files) {
        if (file.path === relativePath) {
          hits.push({ branch: result.branch, file });
        }
      }
    }
    return hits;
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}
