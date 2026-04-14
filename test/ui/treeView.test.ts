import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConflictTreeDataProvider,
  BranchItem,
  FileItem,
  RegionItem,
  conflictTypeLabel,
  conflictTypeIcon,
} from '../../src/ui/treeView';
import type { SortMode, FilterMode } from '../../src/ui/treeView';
import { ConflictType, RiskLevel } from '../../src/core/types';
import type { ConflictFile, ConflictResult, ScanResult } from '../../src/core/types';

// ── Helpers ──────────────────────────────────

function makeFile(
  path: string,
  type: ConflictType = ConflictType.Content,
  lineRanges: Array<{ startLine: number; endLine: number }> = [],
): ConflictFile {
  return { path, conflictType: type, lineRanges, stages: {} };
}

function makeResult(
  branch: string,
  files: ConflictFile[] = [],
  status: 'success' | 'error' | 'fallback' = files.length > 0 ? 'success' : 'success',
  riskLevel: RiskLevel = RiskLevel.None,
): ConflictResult {
  return {
    branch,
    currentSHA: 'aaa',
    targetSHA: 'bbb',
    files,
    riskScore: 0,
    riskLevel,
    timestamp: Date.now(),
    status,
  };
}

function makeScan(results: ConflictResult[]): ScanResult {
  return {
    results,
    overallRiskScore: 0,
    overallRiskLevel: RiskLevel.None,
    totalConflictFiles: results.reduce((s, r) => s + r.files.length, 0),
    timestamp: Date.now(),
    durationMs: 50,
  };
}

const GIT_ROOT = '/repo';

// ── conflictTypeLabel / conflictTypeIcon ─────

describe('conflictTypeLabel', () => {
  it('maps Content', () => expect(conflictTypeLabel(ConflictType.Content)).toBe('content conflict'));
  it('maps Rename', () => expect(conflictTypeLabel(ConflictType.Rename)).toBe('rename conflict'));
  it('maps Delete', () => expect(conflictTypeLabel(ConflictType.Delete)).toBe('delete conflict'));
  it('maps Binary', () => expect(conflictTypeLabel(ConflictType.Binary)).toBe('binary conflict'));
  it('maps Directory', () => expect(conflictTypeLabel(ConflictType.Directory)).toBe('directory conflict'));
  it('maps ModeChange', () => expect(conflictTypeLabel(ConflictType.ModeChange)).toBe('mode change'));
});

describe('conflictTypeIcon', () => {
  it('maps Content to diff', () => expect(conflictTypeIcon(ConflictType.Content)).toBe('diff'));
  it('maps Rename to diff-renamed', () => expect(conflictTypeIcon(ConflictType.Rename)).toBe('diff-renamed'));
  it('maps Delete to diff-removed', () => expect(conflictTypeIcon(ConflictType.Delete)).toBe('diff-removed'));
  it('maps Binary to file-binary', () => expect(conflictTypeIcon(ConflictType.Binary)).toBe('file-binary'));
});

// ── ConflictTreeDataProvider ─────────────────

describe('ConflictTreeDataProvider', () => {
  let provider: ConflictTreeDataProvider;

  beforeEach(() => {
    provider = new ConflictTreeDataProvider();
  });

  // ── Empty state ────────────────────────

  it('returns empty children when no scan', () => {
    expect(provider.getChildren()).toEqual([]);
  });

  it('returns empty children after clear()', () => {
    provider.update(makeScan([makeResult('main', [makeFile('a.ts')])]), GIT_ROOT);
    provider.clear();
    expect(provider.getChildren()).toEqual([]);
  });

  // ── Root level (branches) ──────────────

  it('returns BranchItems at root level', () => {
    const scan = makeScan([
      makeResult('main', [makeFile('a.ts')]),
      makeResult('develop'),
    ]);
    provider.update(scan, GIT_ROOT);
    const roots = provider.getChildren();
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBeInstanceOf(BranchItem);
    expect(roots[1]).toBeInstanceOf(BranchItem);
  });

  it('branch tree item shows conflict count description', () => {
    const r = makeResult('main', [makeFile('a.ts'), makeFile('b.ts')]);
    const scan = makeScan([r]);
    provider.update(scan, GIT_ROOT);

    const branchItem = provider.getChildren()[0] as BranchItem;
    const treeItem = provider.getTreeItem(branchItem);
    expect(treeItem.description).toBe('2 conflicts');
  });

  it('branch tree item shows singular "conflict"', () => {
    const r = makeResult('main', [makeFile('a.ts')]);
    provider.update(makeScan([r]), GIT_ROOT);
    const treeItem = provider.getTreeItem(provider.getChildren()[0] as BranchItem);
    expect(treeItem.description).toBe('1 conflict');
  });

  it('clean branch shows "Clean ✓"', () => {
    const r = makeResult('main');
    provider.update(makeScan([r]), GIT_ROOT);
    const treeItem = provider.getTreeItem(provider.getChildren()[0] as BranchItem);
    expect(treeItem.description).toBe('Clean ✓');
  });

  it('error branch shows error message', () => {
    const r = makeResult('main', [], 'error');
    r.status = 'error';
    r.errorMessage = 'Git not found';
    provider.update(makeScan([r]), GIT_ROOT);
    const treeItem = provider.getTreeItem(provider.getChildren()[0] as BranchItem);
    expect(treeItem.description).toBe('Git not found');
  });

  // ── File level ─────────────────────────

  it('returns FileItems as children of a branch', () => {
    const files = [makeFile('a.ts'), makeFile('b.ts', ConflictType.Delete)];
    const r = makeResult('main', files);
    provider.update(makeScan([r]), GIT_ROOT);

    const branchItem = provider.getChildren()[0] as BranchItem;
    const fileItems = provider.getChildren(branchItem);
    expect(fileItems).toHaveLength(2);
    expect(fileItems[0]).toBeInstanceOf(FileItem);
  });

  it('file tree item has open command', () => {
    const r = makeResult('main', [makeFile('src/app.ts')]);
    provider.update(makeScan([r]), GIT_ROOT);

    const branch = provider.getChildren()[0] as BranchItem;
    const file = provider.getChildren(branch)[0] as FileItem;
    const treeItem = provider.getTreeItem(file);
    expect(treeItem.command?.command).toBe('mergeguard.previewConflict');
  });

  it('file tree item shows conflict type description', () => {
    const r = makeResult('main', [makeFile('a.ts', ConflictType.Rename)]);
    provider.update(makeScan([r]), GIT_ROOT);

    const branch = provider.getChildren()[0] as BranchItem;
    const file = provider.getChildren(branch)[0] as FileItem;
    const treeItem = provider.getTreeItem(file);
    expect(treeItem.description).toBe('rename conflict');
  });

  // ── Region level ───────────────────────

  it('returns RegionItems for files with line ranges', () => {
    const f = makeFile('a.ts', ConflictType.Content, [
      { startLine: 10, endLine: 20 },
      { startLine: 45, endLine: 67 },
    ]);
    const r = makeResult('main', [f]);
    provider.update(makeScan([r]), GIT_ROOT);

    const branch = provider.getChildren()[0] as BranchItem;
    const file = provider.getChildren(branch)[0] as FileItem;
    const regions = provider.getChildren(file);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toBeInstanceOf(RegionItem);
  });

  it('region tree item shows line range in label', () => {
    const f = makeFile('a.ts', ConflictType.Content, [{ startLine: 45, endLine: 67 }]);
    const r = makeResult('main', [f]);
    provider.update(makeScan([r]), GIT_ROOT);

    const branch = provider.getChildren()[0] as BranchItem;
    const file = provider.getChildren(branch)[0] as FileItem;
    const region = provider.getChildren(file)[0] as RegionItem;
    const treeItem = provider.getTreeItem(region);
    expect(treeItem.label).toContain('45');
    expect(treeItem.label).toContain('67');
  });

  it('region tree item has go-to-line command', () => {
    const f = makeFile('a.ts', ConflictType.Content, [{ startLine: 10, endLine: 20 }]);
    const r = makeResult('main', [f]);
    provider.update(makeScan([r]), GIT_ROOT);

    const branch = provider.getChildren()[0] as BranchItem;
    const file = provider.getChildren(branch)[0] as FileItem;
    const region = provider.getChildren(file)[0] as RegionItem;
    const treeItem = provider.getTreeItem(region);
    expect(treeItem.command?.command).toBe('vscode.open');
    expect(treeItem.command?.arguments).toHaveLength(2);
  });

  it('returns no children for a region', () => {
    const f = makeFile('a.ts', ConflictType.Content, [{ startLine: 1, endLine: 5 }]);
    const r = makeResult('main', [f]);
    provider.update(makeScan([r]), GIT_ROOT);

    const branch = provider.getChildren()[0] as BranchItem;
    const file = provider.getChildren(branch)[0] as FileItem;
    const region = provider.getChildren(file)[0] as RegionItem;
    expect(provider.getChildren(region)).toEqual([]);
  });

  // ── File without line ranges ───────────

  it('file without line ranges has no children', () => {
    const f = makeFile('a.ts');
    const r = makeResult('main', [f]);
    provider.update(makeScan([r]), GIT_ROOT);

    const branch = provider.getChildren()[0] as BranchItem;
    const file = provider.getChildren(branch)[0] as FileItem;
    expect(provider.getChildren(file)).toHaveLength(0);
  });

  // ── IDs ────────────────────────────────

  it('BranchItem has unique id', () => {
    const bi = new BranchItem(makeResult('main'));
    expect(bi.id).toBe('branch:main');
  });

  it('FileItem has unique id including branch', () => {
    const fi = new FileItem(makeFile('src/a.ts'), 'main', GIT_ROOT);
    expect(fi.id).toBe('file:main:src/a.ts');
  });

  it('RegionItem has unique id including range', () => {
    const f = makeFile('a.ts', ConflictType.Content, [{ startLine: 10, endLine: 20 }]);
    const ri = new RegionItem(f, 0, 'main', GIT_ROOT);
    expect(ri.id).toBe('region:main:a.ts:10-20');
  });

  // ── onDidChangeTreeData ────────────────

  it('fires change event on update', () => {
    let fired = false;
    provider.onDidChangeTreeData(() => {
      fired = true;
    });
    provider.update(makeScan([makeResult('main')]), GIT_ROOT);
    expect(fired).toBe(true);
  });

  it('fires change event on clear', () => {
    let fired = false;
    provider.onDidChangeTreeData(() => {
      fired = true;
    });
    provider.clear();
    expect(fired).toBe(true);
  });

  // ── Sort mode ──────────────────────────

  it('default sort mode is severity', () => {
    expect(provider.getSortMode()).toBe('severity');
  });

  it('setSortMode changes sort mode and fires event', () => {
    let fired = false;
    provider.onDidChangeTreeData(() => { fired = true; });
    provider.setSortMode('branch');
    expect(provider.getSortMode()).toBe('branch');
    expect(fired).toBe(true);
  });

  it('sorts branches by severity (high first)', () => {
    const scan = makeScan([
      makeResult('low-branch', [makeFile('a.ts')], 'success', RiskLevel.Low),
      makeResult('high-branch', [makeFile('b.ts')], 'success', RiskLevel.High),
      makeResult('med-branch', [makeFile('c.ts')], 'success', RiskLevel.Medium),
    ]);
    provider.update(scan, GIT_ROOT);
    provider.setSortMode('severity');
    const roots = provider.getChildren() as BranchItem[];
    expect(roots[0].result.branch).toBe('high-branch');
    expect(roots[1].result.branch).toBe('med-branch');
    expect(roots[2].result.branch).toBe('low-branch');
  });

  it('sorts branches alphabetically by branch name', () => {
    const scan = makeScan([
      makeResult('zebra', [makeFile('a.ts')]),
      makeResult('alpha', [makeFile('b.ts')]),
      makeResult('middle', [makeFile('c.ts')]),
    ]);
    provider.update(scan, GIT_ROOT);
    provider.setSortMode('branch');
    const roots = provider.getChildren() as BranchItem[];
    expect(roots[0].result.branch).toBe('alpha');
    expect(roots[1].result.branch).toBe('middle');
    expect(roots[2].result.branch).toBe('zebra');
  });

  it('sorts branches by first file name', () => {
    const scan = makeScan([
      makeResult('b1', [makeFile('z.ts')]),
      makeResult('b2', [makeFile('a.ts')]),
    ]);
    provider.update(scan, GIT_ROOT);
    provider.setSortMode('fileName');
    const roots = provider.getChildren() as BranchItem[];
    expect(roots[0].result.branch).toBe('b2');
    expect(roots[1].result.branch).toBe('b1');
  });

  it('sorts file children by name when sort mode is fileName', () => {
    const scan = makeScan([
      makeResult('main', [makeFile('z.ts'), makeFile('a.ts'), makeFile('m.ts')]),
    ]);
    provider.update(scan, GIT_ROOT);
    provider.setSortMode('fileName');
    const branch = provider.getChildren()[0] as BranchItem;
    const files = provider.getChildren(branch) as FileItem[];
    expect(files[0].file.path).toBe('a.ts');
    expect(files[1].file.path).toBe('m.ts');
    expect(files[2].file.path).toBe('z.ts');
  });

  // ── Filter mode ────────────────────────

  it('default filter mode is all', () => {
    expect(provider.getFilterMode()).toBe('all');
  });

  it('setFilterMode changes filter and fires event', () => {
    let fired = false;
    provider.onDidChangeTreeData(() => { fired = true; });
    provider.setFilterMode('highRisk');
    expect(provider.getFilterMode()).toBe('highRisk');
    expect(fired).toBe(true);
  });

  it('highRisk filter hides non-high branches', () => {
    const scan = makeScan([
      makeResult('low-branch', [makeFile('a.ts')], 'success', RiskLevel.Low),
      makeResult('high-branch', [makeFile('b.ts')], 'success', RiskLevel.High),
    ]);
    provider.update(scan, GIT_ROOT);
    provider.setFilterMode('highRisk');
    const roots = provider.getChildren() as BranchItem[];
    expect(roots).toHaveLength(1);
    expect(roots[0].result.branch).toBe('high-branch');
  });

  it('highRisk filter returns empty when no high-risk branches', () => {
    const scan = makeScan([
      makeResult('low-branch', [makeFile('a.ts')], 'success', RiskLevel.Low),
    ]);
    provider.update(scan, GIT_ROOT);
    provider.setFilterMode('highRisk');
    expect(provider.getChildren()).toHaveLength(0);
  });

  // ── Dismiss ────────────────────────────

  it('dismissConflict hides the file from tree', () => {
    const scan = makeScan([
      makeResult('main', [makeFile('a.ts'), makeFile('b.ts')]),
    ]);
    provider.update(scan, GIT_ROOT);
    provider.dismissConflict('main', 'a.ts');
    const branch = provider.getChildren()[0] as BranchItem;
    const files = provider.getChildren(branch) as FileItem[];
    expect(files).toHaveLength(1);
    expect(files[0].file.path).toBe('b.ts');
  });

  it('isConflictDismissed returns correct state', () => {
    expect(provider.isConflictDismissed('main', 'a.ts')).toBe(false);
    provider.dismissConflict('main', 'a.ts');
    expect(provider.isConflictDismissed('main', 'a.ts')).toBe(true);
  });

  it('clearDismissed restores dismissed conflicts', () => {
    const scan = makeScan([
      makeResult('main', [makeFile('a.ts'), makeFile('b.ts')]),
    ]);
    provider.update(scan, GIT_ROOT);
    provider.dismissConflict('main', 'a.ts');
    provider.clearDismissed();
    const branch = provider.getChildren()[0] as BranchItem;
    const files = provider.getChildren(branch) as FileItem[];
    expect(files).toHaveLength(2);
  });

  it('branch description updates after dismissing all files', () => {
    const scan = makeScan([
      makeResult('main', [makeFile('a.ts')]),
    ]);
    provider.update(scan, GIT_ROOT);
    provider.dismissConflict('main', 'a.ts');
    const branch = provider.getChildren()[0] as BranchItem;
    const treeItem = provider.getTreeItem(branch);
    expect(treeItem.description).toBe('Clean ✓');
  });

  // ── Visible conflict count ─────────────

  it('getVisibleConflictCount returns total visible files', () => {
    const scan = makeScan([
      makeResult('main', [makeFile('a.ts'), makeFile('b.ts')]),
      makeResult('develop', [makeFile('c.ts')]),
    ]);
    provider.update(scan, GIT_ROOT);
    expect(provider.getVisibleConflictCount()).toBe(3);
  });

  it('getVisibleConflictCount excludes dismissed', () => {
    const scan = makeScan([
      makeResult('main', [makeFile('a.ts'), makeFile('b.ts')]),
    ]);
    provider.update(scan, GIT_ROOT);
    provider.dismissConflict('main', 'a.ts');
    expect(provider.getVisibleConflictCount()).toBe(1);
  });

  it('getVisibleConflictCount respects high-risk filter', () => {
    const scan = makeScan([
      makeResult('low-branch', [makeFile('a.ts')], 'success', RiskLevel.Low),
      makeResult('high-branch', [makeFile('b.ts')], 'success', RiskLevel.High),
    ]);
    provider.update(scan, GIT_ROOT);
    provider.setFilterMode('highRisk');
    expect(provider.getVisibleConflictCount()).toBe(1);
  });

  it('getVisibleConflictCount returns 0 when no scan', () => {
    expect(provider.getVisibleConflictCount()).toBe(0);
  });
});
