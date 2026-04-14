import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictFileDecorationProvider } from '../../src/ui/fileDecorations';
import { ConflictType, RiskLevel } from '../../src/core/types';
import type { ConflictFile, ConflictResult, ScanResult } from '../../src/core/types';
import { Uri } from 'vscode';

// ── Helpers ──────────────────────────────

function makeFile(
  path: string,
  type: ConflictType = ConflictType.Content,
): ConflictFile {
  return { path, conflictType: type, lineRanges: [], stages: {} };
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

describe('ConflictFileDecorationProvider', () => {
  let provider: ConflictFileDecorationProvider;

  beforeEach(() => {
    provider = new ConflictFileDecorationProvider();
  });

  // ── No decorations initially ───────────

  it('returns undefined for unknown file', () => {
    const uri = Uri.file('/repo/src/clean.ts') as any;
    expect(provider.provideFileDecoration(uri)).toBeUndefined();
  });

  // ── Basic decoration ──────────────────

  it('provides decoration for a conflicted file', () => {
    const scan = makeScan([makeResult('main', [makeFile('src/a.ts')])]);
    provider.update(scan, GIT_ROOT);

    const uri = Uri.file(`${GIT_ROOT}/src/a.ts`) as any;
    const dec = provider.provideFileDecoration(uri);
    expect(dec).toBeDefined();
    expect(dec!.badge).toBe('1');
    expect(dec!.tooltip).toContain('1 branch');
  });

  it('badge shows count of conflicting branches', () => {
    const scan = makeScan([
      makeResult('main', [makeFile('src/a.ts')]),
      makeResult('develop', [makeFile('src/a.ts')]),
      makeResult('release', [makeFile('src/a.ts')]),
    ]);
    provider.update(scan, GIT_ROOT);

    const uri = Uri.file(`${GIT_ROOT}/src/a.ts`) as any;
    const dec = provider.provideFileDecoration(uri);
    expect(dec!.badge).toBe('3');
    expect(dec!.tooltip).toContain('3 branches');
  });

  it('singular tooltip for 1 branch', () => {
    const scan = makeScan([makeResult('main', [makeFile('a.ts')])]);
    provider.update(scan, GIT_ROOT);

    const dec = provider.provideFileDecoration(Uri.file(`${GIT_ROOT}/a.ts`) as any);
    expect(dec!.tooltip).toContain('1 branch with');
    expect(dec!.tooltip).not.toContain('branches');
  });

  it('returns undefined for non-conflicted file after update', () => {
    const scan = makeScan([makeResult('main', [makeFile('a.ts')])]);
    provider.update(scan, GIT_ROOT);

    const uri = Uri.file(`${GIT_ROOT}/b.ts`) as any;
    expect(provider.provideFileDecoration(uri)).toBeUndefined();
  });

  // ── Skips errors ──────────────────────

  it('skips error results', () => {
    const r = makeResult('main', [makeFile('a.ts')]);
    r.status = 'error';
    provider.update(makeScan([r]), GIT_ROOT);

    const uri = Uri.file(`${GIT_ROOT}/a.ts`) as any;
    expect(provider.provideFileDecoration(uri)).toBeUndefined();
  });

  // ── Clear ─────────────────────────────

  it('clear removes all decorations', () => {
    provider.update(makeScan([makeResult('main', [makeFile('a.ts')])]), GIT_ROOT);
    provider.clear();

    const uri = Uri.file(`${GIT_ROOT}/a.ts`) as any;
    expect(provider.provideFileDecoration(uri)).toBeUndefined();
  });

  // ── Change event ──────────────────────

  it('fires onDidChangeFileDecorations on update', () => {
    let fired = false;
    provider.onDidChangeFileDecorations(() => {
      fired = true;
    });
    provider.update(makeScan([makeResult('main')]), GIT_ROOT);
    expect(fired).toBe(true);
  });

  it('fires onDidChangeFileDecorations on clear', () => {
    let fired = false;
    provider.onDidChangeFileDecorations(() => {
      fired = true;
    });
    provider.clear();
    expect(fired).toBe(true);
  });

  // ── propagate ─────────────────────────

  it('decoration does not propagate to parent folders', () => {
    provider.update(makeScan([makeResult('main', [makeFile('src/a.ts')])]), GIT_ROOT);
    const dec = provider.provideFileDecoration(Uri.file(`${GIT_ROOT}/src/a.ts`) as any);
    expect(dec!.propagate).toBe(false);
  });

  // ── Dispose ───────────────────────────

  it('dispose does not throw', () => {
    expect(() => provider.dispose()).not.toThrow();
  });
});
