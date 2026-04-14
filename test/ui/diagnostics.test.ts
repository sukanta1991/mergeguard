import { describe, it, expect, beforeEach } from 'vitest';
import { DiagnosticsController } from '../../src/ui/diagnostics';
import { ConflictType, RiskLevel } from '../../src/core/types';
import type { ConflictFile, ConflictResult, ScanResult } from '../../src/core/types';
import { Uri, DiagnosticSeverity } from 'vscode';

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
    status: 'success',
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

describe('DiagnosticsController', () => {
  let ctrl: DiagnosticsController;

  beforeEach(() => {
    ctrl = new DiagnosticsController();
  });

  // ── Basic update ───────────────────────

  it('creates diagnostics for conflicted files', () => {
    const f = makeFile('src/a.ts', ConflictType.Content, [{ startLine: 10, endLine: 20 }]);
    ctrl.update(makeScan([makeResult('main', [f])]), GIT_ROOT);

    const uri = Uri.file(`${GIT_ROOT}/src/a.ts`);
    const diags = ctrl.getDiagnostics(uri as any);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('main');
    expect(diags[0].message).toContain('content');
    expect(diags[0].source).toBe('MergeGuard');
  });

  it('creates one diagnostic per line range', () => {
    const f = makeFile('a.ts', ConflictType.Content, [
      { startLine: 1, endLine: 5 },
      { startLine: 20, endLine: 30 },
    ]);
    ctrl.update(makeScan([makeResult('main', [f])]), GIT_ROOT);

    const diags = ctrl.getDiagnostics(Uri.file(`${GIT_ROOT}/a.ts`) as any);
    expect(diags).toHaveLength(2);
  });

  it('creates whole-file diagnostic when no line ranges', () => {
    const f = makeFile('a.ts', ConflictType.Delete);
    ctrl.update(makeScan([makeResult('main', [f])]), GIT_ROOT);

    const diags = ctrl.getDiagnostics(Uri.file(`${GIT_ROOT}/a.ts`) as any);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('delete');
  });

  it('groups diagnostics by file across branches', () => {
    const f1 = makeFile('a.ts', ConflictType.Content, [{ startLine: 1, endLine: 5 }]);
    const f2 = makeFile('a.ts', ConflictType.Rename, [{ startLine: 10, endLine: 15 }]);
    ctrl.update(
      makeScan([makeResult('main', [f1]), makeResult('develop', [f2])]),
      GIT_ROOT,
    );

    const diags = ctrl.getDiagnostics(Uri.file(`${GIT_ROOT}/a.ts`) as any);
    expect(diags).toHaveLength(2);
    expect(diags.some((d) => d.message.includes('main'))).toBe(true);
    expect(diags.some((d) => d.message.includes('develop'))).toBe(true);
  });

  it('skips error results', () => {
    const r = makeResult('main', [makeFile('a.ts')]);
    r.status = 'error';
    ctrl.update(makeScan([r]), GIT_ROOT);

    const diags = ctrl.getDiagnostics(Uri.file(`${GIT_ROOT}/a.ts`) as any);
    expect(diags).toHaveLength(0);
  });

  // ── Clear ──────────────────────────────

  it('clear removes all diagnostics', () => {
    ctrl.update(
      makeScan([makeResult('main', [makeFile('a.ts')])]),
      GIT_ROOT,
    );
    ctrl.clear();
    const diags = ctrl.getDiagnostics(Uri.file(`${GIT_ROOT}/a.ts`) as any);
    expect(diags).toHaveLength(0);
  });

  // ── Enable/disable ────────────────────

  it('disabled controller produces no diagnostics', () => {
    ctrl.setEnabled(false);
    ctrl.update(
      makeScan([makeResult('main', [makeFile('a.ts', ConflictType.Content, [{ startLine: 1, endLine: 5 }])])]),
      GIT_ROOT,
    );
    const diags = ctrl.getDiagnostics(Uri.file(`${GIT_ROOT}/a.ts`) as any);
    expect(diags).toHaveLength(0);
  });

  it('setEnabled(false) clears existing diagnostics', () => {
    ctrl.update(
      makeScan([makeResult('main', [makeFile('a.ts', ConflictType.Content, [{ startLine: 1, endLine: 5 }])])]),
      GIT_ROOT,
    );
    ctrl.setEnabled(false);
    const diags = ctrl.getDiagnostics(Uri.file(`${GIT_ROOT}/a.ts`) as any);
    expect(diags).toHaveLength(0);
  });

  // ── Dispose ────────────────────────────

  it('dispose does not throw', () => {
    expect(() => ctrl.dispose()).not.toThrow();
  });

  // ── Severity ───────────────────────────

  it('diagnostics have Warning severity', () => {
    const f = makeFile('a.ts', ConflictType.Content, [{ startLine: 1, endLine: 5 }]);
    ctrl.update(makeScan([makeResult('main', [f])]), GIT_ROOT);

    const diags = ctrl.getDiagnostics(Uri.file(`${GIT_ROOT}/a.ts`) as any);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Warning);
  });
});
