import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DecorationController } from '../../src/ui/decorations';
import { ConflictType, RiskLevel } from '../../src/core/types';
import type { ConflictFile, ConflictResult, ScanResult } from '../../src/core/types';

// ── Helpers ──────────────────────────────

function makeFile(
  path: string,
  type: ConflictType = ConflictType.Content,
  lineRanges: Array<{ startLine: number; endLine: number }> = [],
): ConflictFile {
  return { path, conflictType: type, lineRanges, stages: {} };
}

function makeResult(branch: string, files: ConflictFile[] = []): ConflictResult {
  return {
    branch,
    currentSHA: 'aaa',
    targetSHA: 'bbb',
    files,
    riskScore: 0,
    riskLevel: RiskLevel.None,
    timestamp: Date.now(),
    status: files.length > 0 ? 'success' : 'success',
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

describe('DecorationController', () => {
  let ctrl: DecorationController;

  beforeEach(() => {
    ctrl = new DecorationController();
  });

  afterEach(() => {
    ctrl.dispose();
  });

  // ── Conflict tracking ──────────────────

  it('starts with no conflicts', () => {
    expect(ctrl.hasConflicts()).toBe(false);
    expect(ctrl.getConflictedPaths()).toEqual([]);
  });

  it('tracks conflicts after update', () => {
    const scan = makeScan([
      makeResult('main', [makeFile('src/a.ts'), makeFile('src/b.ts')]),
    ]);
    ctrl.update(scan, GIT_ROOT);
    expect(ctrl.hasConflicts()).toBe(true);
    expect(ctrl.getConflictedPaths()).toContain('src/a.ts');
    expect(ctrl.getConflictedPaths()).toContain('src/b.ts');
  });

  it('groups conflicts from multiple branches for same file', () => {
    const scan = makeScan([
      makeResult('main', [makeFile('src/a.ts')]),
      makeResult('develop', [makeFile('src/a.ts', ConflictType.Rename)]),
    ]);
    ctrl.update(scan, GIT_ROOT);
    const infos = ctrl.getConflictsForFile('src/a.ts');
    expect(infos).toHaveLength(2);
    expect(infos[0].branch).toBe('main');
    expect(infos[1].branch).toBe('develop');
  });

  it('returns empty for non-conflicted file', () => {
    ctrl.update(makeScan([makeResult('main', [makeFile('a.ts')])]), GIT_ROOT);
    expect(ctrl.getConflictsForFile('b.ts')).toEqual([]);
  });

  it('skips error results', () => {
    const r = makeResult('main', [makeFile('a.ts')]);
    r.status = 'error';
    ctrl.update(makeScan([r]), GIT_ROOT);
    expect(ctrl.hasConflicts()).toBe(false);
  });

  // ── Clear ──────────────────────────────

  it('clear removes all conflicts', () => {
    ctrl.update(makeScan([makeResult('main', [makeFile('a.ts')])]), GIT_ROOT);
    ctrl.clear();
    expect(ctrl.hasConflicts()).toBe(false);
  });

  // ── Enable/disable ────────────────────

  it('setEnabled(false) does not throw', () => {
    expect(() => ctrl.setEnabled(false)).not.toThrow();
  });

  it('setEnabled(true) does not throw', () => {
    ctrl.setEnabled(false);
    expect(() => ctrl.setEnabled(true)).not.toThrow();
  });

  // ── Dispose ────────────────────────────

  it('dispose clears state', () => {
    ctrl.update(makeScan([makeResult('main', [makeFile('a.ts')])]), GIT_ROOT);
    ctrl.dispose();
    expect(ctrl.hasConflicts()).toBe(false);
  });
});

// Need afterEach in the import
import { afterEach } from 'vitest';
