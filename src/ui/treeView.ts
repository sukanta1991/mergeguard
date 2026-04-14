import * as vscode from 'vscode';
import type { ConflictFile, ConflictResult, ScanResult } from '../core/types';
import { ConflictType, RiskLevel } from '../core/types';

// ── Sort / Filter types ──────────────────────────────────

export type SortMode = 'severity' | 'fileName' | 'branch';
export type FilterMode = 'all' | 'highRisk';

// ── Tree item IDs ────────────────────────────────────────

type TreeElement = BranchItem | FileItem | RegionItem;

export class BranchItem {
  readonly kind = 'branch' as const;
  constructor(public readonly result: ConflictResult) {}
  get id(): string {
    return `branch:${this.result.branch}`;
  }
}

export class FileItem {
  readonly kind = 'file' as const;
  constructor(
    public readonly file: ConflictFile,
    public readonly branch: string,
    public readonly gitRoot: string,
  ) {}
  get id(): string {
    return `file:${this.branch}:${this.file.path}`;
  }
}

export class RegionItem {
  readonly kind = 'region' as const;
  constructor(
    public readonly file: ConflictFile,
    public readonly rangeIndex: number,
    public readonly branch: string,
    public readonly gitRoot: string,
  ) {}
  get id(): string {
    const r = this.file.lineRanges[this.rangeIndex];
    return `region:${this.branch}:${this.file.path}:${r.startLine}-${r.endLine}`;
  }
}

// ── Risk level ordering (for sort) ───────────────────────

const RISK_ORDER: Record<string, number> = {
  [RiskLevel.High]: 0,
  [RiskLevel.Medium]: 1,
  [RiskLevel.Low]: 2,
  [RiskLevel.None]: 3,
};

// ── Conflict tree data provider ──────────────────────────

/**
 * 3-level TreeDataProvider for predicted conflicts:
 *  Level 1 — Target branches (with conflict count)
 *  Level 2 — Conflicted files
 *  Level 3 — Conflict regions (line ranges)
 *
 * Supports sorting (by severity, file name, branch) and
 * filtering (show all or high-risk only).
 */
export class ConflictTreeDataProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private scan: ScanResult | undefined;
  private gitRoot = '';
  private sortMode: SortMode = 'severity';
  private filterMode: FilterMode = 'all';
  private dismissedConflicts = new Set<string>();

  /** Update the tree with new scan results. */
  update(scan: ScanResult, gitRoot: string): void {
    this.scan = scan;
    this.gitRoot = gitRoot;
    this._onDidChangeTreeData.fire();
  }

  /** Clear all results. */
  clear(): void {
    this.scan = undefined;
    this._onDidChangeTreeData.fire();
  }

  /** Set sort mode and refresh. */
  setSortMode(mode: SortMode): void {
    this.sortMode = mode;
    this._onDidChangeTreeData.fire();
  }

  /** Get current sort mode. */
  getSortMode(): SortMode {
    return this.sortMode;
  }

  /** Set filter mode and refresh. */
  setFilterMode(mode: FilterMode): void {
    this.filterMode = mode;
    this._onDidChangeTreeData.fire();
  }

  /** Get current filter mode. */
  getFilterMode(): FilterMode {
    return this.filterMode;
  }

  /** Dismiss a specific conflict (branch::file). */
  dismissConflict(branch: string, filePath: string): void {
    this.dismissedConflicts.add(`${branch}::${filePath}`);
    this._onDidChangeTreeData.fire();
  }

  /** Check if a conflict is dismissed. */
  isConflictDismissed(branch: string, filePath: string): boolean {
    return this.dismissedConflicts.has(`${branch}::${filePath}`);
  }

  /** Clear all dismissed conflicts. */
  clearDismissed(): void {
    this.dismissedConflicts.clear();
    this._onDidChangeTreeData.fire();
  }

  /** Get total visible conflict file count (after filtering). */
  getVisibleConflictCount(): number {
    if (!this.scan) return 0;
    const results = this.getFilteredResults();
    return results.reduce((sum, r) => {
      const files = r.files.filter(f => !this.dismissedConflicts.has(`${r.branch}::${f.path}`));
      return sum + files.length;
    }, 0);
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    switch (element.kind) {
      case 'branch':
        return this.branchTreeItem(element);
      case 'file':
        return this.fileTreeItem(element);
      case 'region':
        return this.regionTreeItem(element);
    }
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) {
      return this.getRootChildren();
    }

    switch (element.kind) {
      case 'branch': {
        const files = element.result.files
          .filter(f => !this.dismissedConflicts.has(`${element.result.branch}::${f.path}`))
          .map(f => new FileItem(f, element.result.branch, this.gitRoot));
        if (this.sortMode === 'fileName') {
          files.sort((a, b) => a.file.path.localeCompare(b.file.path));
        }
        return files;
      }
      case 'file':
        return element.file.lineRanges.map(
          (_, i) => new RegionItem(element.file, i, element.branch, element.gitRoot),
        );
      case 'region':
        return [];
    }
  }

  // ── Root items ──────────────────────────────────

  private getFilteredResults(): ConflictResult[] {
    if (!this.scan) return [];
    let results = [...this.scan.results];

    // Apply high-risk filter
    if (this.filterMode === 'highRisk') {
      results = results.filter(r => r.riskLevel === RiskLevel.High);
    }

    return results;
  }

  private getRootChildren(): TreeElement[] {
    const results = this.getFilteredResults();
    if (results.length === 0) return [];

    // Apply sort
    const sorted = this.applySortToResults(results);
    return sorted.map(r => new BranchItem(r));
  }

  private applySortToResults(results: ConflictResult[]): ConflictResult[] {
    switch (this.sortMode) {
      case 'severity':
        return results.sort((a, b) => (RISK_ORDER[a.riskLevel] ?? 3) - (RISK_ORDER[b.riskLevel] ?? 3));
      case 'fileName':
        // Sort branches by their first file name (alphabetical)
        return results.sort((a, b) => {
          const aName = a.files[0]?.path ?? '';
          const bName = b.files[0]?.path ?? '';
          return aName.localeCompare(bName);
        });
      case 'branch':
        return results.sort((a, b) => a.branch.localeCompare(b.branch));
      default:
        return results;
    }
  }

  // ── Branch level ────────────────────────────────

  private branchTreeItem(item: BranchItem): vscode.TreeItem {
    const r = item.result;
    const visibleFiles = r.files.filter(f => !this.dismissedConflicts.has(`${r.branch}::${f.path}`));
    const count = visibleFiles.length;
    const label = r.branch;

    const treeItem = new vscode.TreeItem(
      label,
      count > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );

    treeItem.id = item.id;
    treeItem.contextValue = 'mergeguard.branch';
    treeItem.iconPath = new vscode.ThemeIcon(
      'git-branch',
      count > 0
        ? new vscode.ThemeColor('list.warningForeground')
        : new vscode.ThemeColor('list.deemphasizedForeground'),
    );

    if (r.status === 'error') {
      treeItem.description = r.errorMessage ?? 'Error';
      treeItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'));
      treeItem.accessibilityInformation = { label: `Branch ${r.branch}, error: ${r.errorMessage ?? 'Unknown error'}`, role: 'treeitem' };
    } else if (count > 0) {
      treeItem.description = `${count} conflict${count === 1 ? '' : 's'}`;
      treeItem.accessibilityInformation = { label: `Branch ${r.branch}, ${count} conflict${count === 1 ? '' : 's'}, risk level ${r.riskLevel}`, role: 'treeitem' };
    } else {
      treeItem.description = 'Clean ✓';
      treeItem.accessibilityInformation = { label: `Branch ${r.branch}, clean, no conflicts`, role: 'treeitem' };
    }

    return treeItem;
  }

  // ── File level ──────────────────────────────────

  private fileTreeItem(item: FileItem): vscode.TreeItem {
    const f = item.file;
    const hasRegions = f.lineRanges.length > 0;

    const treeItem = new vscode.TreeItem(
      f.path,
      hasRegions
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    treeItem.id = item.id;
    treeItem.contextValue = 'mergeguard.file';
    treeItem.description = conflictTypeLabel(f.conflictType);
    treeItem.resourceUri = vscode.Uri.file(`${item.gitRoot}/${f.path}`);
    treeItem.iconPath = new vscode.ThemeIcon(conflictTypeIcon(f.conflictType));
    treeItem.accessibilityInformation = {
      label: `File ${f.path}, ${conflictTypeLabel(f.conflictType)}${hasRegions ? `, ${f.lineRanges.length} region${f.lineRanges.length === 1 ? '' : 's'}` : ''}, conflicts with ${item.branch}`,
      role: 'treeitem',
    };

    // Click opens diff preview
    treeItem.command = {
      command: 'mergeguard.previewConflict',
      title: 'Preview Conflict',
      arguments: [f.path, item.branch],
    };

    return treeItem;
  }

  // ── Region level ────────────────────────────────

  private regionTreeItem(item: RegionItem): vscode.TreeItem {
    const range = item.file.lineRanges[item.rangeIndex];
    const label = `Lines ${range.startLine}–${range.endLine}`;

    const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    treeItem.id = item.id;
    treeItem.contextValue = 'mergeguard.region';
    treeItem.description = conflictTypeLabel(item.file.conflictType);
    treeItem.iconPath = new vscode.ThemeIcon('debug-stackframe-dot');
    treeItem.accessibilityInformation = {
      label: `Conflict region lines ${range.startLine} to ${range.endLine} in ${item.file.path}, ${conflictTypeLabel(item.file.conflictType)}`,
      role: 'treeitem',
    };

    // Click opens file at the conflict line
    const fileUri = vscode.Uri.file(`${item.gitRoot}/${item.file.path}`);
    treeItem.command = {
      command: 'vscode.open',
      title: 'Go to Conflict',
      arguments: [
        fileUri,
        {
          selection: new vscode.Range(
            new vscode.Position(range.startLine - 1, 0),
            new vscode.Position(range.endLine - 1, 0),
          ),
        },
      ],
    };

    return treeItem;
  }
}

// ── Helpers ──────────────────────────────────────────────

function conflictTypeLabel(type: ConflictType): string {
  switch (type) {
    case ConflictType.Content:
      return 'content conflict';
    case ConflictType.Rename:
      return 'rename conflict';
    case ConflictType.Delete:
      return 'delete conflict';
    case ConflictType.Binary:
      return 'binary conflict';
    case ConflictType.Directory:
      return 'directory conflict';
    case ConflictType.ModeChange:
      return 'mode change';
  }
}

function conflictTypeIcon(type: ConflictType): string {
  switch (type) {
    case ConflictType.Content:
      return 'diff';
    case ConflictType.Rename:
      return 'diff-renamed';
    case ConflictType.Delete:
      return 'diff-removed';
    case ConflictType.Binary:
      return 'file-binary';
    case ConflictType.Directory:
      return 'folder';
    case ConflictType.ModeChange:
      return 'settings-gear';
  }
}

// ── Exports for testing ──────────────────────────────────

export { conflictTypeLabel, conflictTypeIcon };
