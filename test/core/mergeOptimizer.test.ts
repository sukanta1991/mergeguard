import { describe, it, expect } from 'vitest';
import { suggestMergeOrder } from '../../src/core/mergeOptimizer';
import { ConflictType, RiskLevel } from '../../src/core/types';
import type { ScanResult, ConflictResult, ConflictFile } from '../../src/core/types';

function makeFile(path: string, type: ConflictType = ConflictType.Content): ConflictFile {
  return { path, conflictType: type, lineRanges: [] };
}

function makeResult(branch: string, files: ConflictFile[], riskScore = 50): ConflictResult {
  return {
    branch,
    currentSHA: 'aaa',
    targetSHA: 'bbb',
    files,
    riskScore: files.length > 0 ? riskScore : 0,
    riskLevel: riskScore >= 70 ? RiskLevel.High : riskScore >= 40 ? RiskLevel.Medium : files.length > 0 ? RiskLevel.Low : RiskLevel.None,
    timestamp: Date.now(),
    status: 'success',
  };
}

function makeScan(results: ConflictResult[]): ScanResult {
  return {
    results,
    overallRiskScore: Math.max(0, ...results.map((r) => r.riskScore)),
    overallRiskLevel: RiskLevel.Medium,
    totalConflictFiles: results.reduce((s, r) => s + r.files.length, 0),
    timestamp: Date.now(),
    durationMs: 100,
  };
}

describe('suggestMergeOrder', () => {
  it('returns empty for no results', () => {
    const suggestion = suggestMergeOrder(makeScan([]));
    expect(suggestion.steps).toEqual([]);
    expect(suggestion.summary).toContain('No branches');
  });

  it('puts zero-conflict branches first', () => {
    const scan = makeScan([
      makeResult('feature/heavy', [makeFile('a.ts'), makeFile('b.ts')], 60),
      makeResult('feature/clean', [], 0),
    ]);
    const suggestion = suggestMergeOrder(scan);
    expect(suggestion.steps[0].branch).toBe('feature/clean');
    expect(suggestion.steps[0].conflictFiles).toBe(0);
    expect(suggestion.steps[1].branch).toBe('feature/heavy');
  });

  it('puts low-conflict branches before high-conflict', () => {
    const scan = makeScan([
      makeResult('many-conflicts', [makeFile('a.ts'), makeFile('b.ts'), makeFile('c.ts')], 80),
      makeResult('few-conflicts', [makeFile('x.ts')], 20),
    ]);
    const suggestion = suggestMergeOrder(scan);
    expect(suggestion.steps[0].branch).toBe('few-conflicts');
    expect(suggestion.steps[1].branch).toBe('many-conflicts');
  });

  it('considers shared file overlap (cascade risk)', () => {
    // Branch A and B both conflict on shared.ts
    // Branch C conflicts on unique.ts only
    // C should come before A/B to avoid cascade
    const scan = makeScan([
      makeResult('branchA', [makeFile('shared.ts')], 40),
      makeResult('branchB', [makeFile('shared.ts')], 40),
      makeResult('branchC', [makeFile('unique.ts')], 40),
    ]);
    const suggestion = suggestMergeOrder(scan);
    // C has 0 overlap with others, A/B overlap with each other
    expect(suggestion.steps[0].branch).toBe('branchC');
  });

  it('skips error results', () => {
    const scan = makeScan([
      { ...makeResult('err-branch', []), status: 'error' as const, errorMessage: 'fail' },
      makeResult('good-branch', [makeFile('a.ts')], 30),
    ]);
    const suggestion = suggestMergeOrder(scan);
    expect(suggestion.steps.length).toBe(1);
    expect(suggestion.steps[0].branch).toBe('good-branch');
  });

  it('handles single branch', () => {
    const scan = makeScan([makeResult('main', [makeFile('a.ts')], 50)]);
    const suggestion = suggestMergeOrder(scan);
    expect(suggestion.steps.length).toBe(1);
    expect(suggestion.steps[0].branch).toBe('main');
  });

  it('includes all branches in output', () => {
    const scan = makeScan([
      makeResult('alpha', [makeFile('a.ts')], 30),
      makeResult('beta', [makeFile('b.ts')], 50),
      makeResult('gamma', [], 0),
    ]);
    const suggestion = suggestMergeOrder(scan);
    expect(suggestion.steps.length).toBe(3);
    const branches = suggestion.steps.map((s) => s.branch);
    expect(branches).toContain('alpha');
    expect(branches).toContain('beta');
    expect(branches).toContain('gamma');
  });

  it('summary contains numbered entries', () => {
    const scan = makeScan([
      makeResult('main', [makeFile('a.ts')], 50),
      makeResult('develop', [], 0),
    ]);
    const suggestion = suggestMergeOrder(scan);
    expect(suggestion.summary).toContain('1.');
    expect(suggestion.summary).toContain('2.');
  });

  it('step reason mentions "no conflicts" for clean branches', () => {
    const scan = makeScan([makeResult('clean', [], 0)]);
    const suggestion = suggestMergeOrder(scan);
    expect(suggestion.steps[0].reason).toContain('No conflicts');
  });

  it('step reason mentions conflict count', () => {
    const scan = makeScan([makeResult('main', [makeFile('a.ts'), makeFile('b.ts')], 50)]);
    const suggestion = suggestMergeOrder(scan);
    expect(suggestion.steps[0].reason).toContain('2 conflict');
  });

  it('step reason mentions shared files with remaining branches', () => {
    const scan = makeScan([
      makeResult('branchA', [makeFile('shared.ts'), makeFile('only-a.ts')], 60),
      makeResult('branchB', [makeFile('shared.ts')], 40),
    ]);
    const suggestion = suggestMergeOrder(scan);
    // The first branch merged should mention overlap with the second
    // branchB goes first (fewer conflicts), its reason should mention shared files with branchA
    expect(suggestion.steps[0].branch).toBe('branchB');
    expect(suggestion.steps[0].reason).toContain('shared file');
  });

  it('complex topology with 4 branches', () => {
    const scan = makeScan([
      makeResult('feature/auth', [makeFile('auth.ts'), makeFile('user.ts')], 60),
      makeResult('feature/payments', [makeFile('order.ts'), makeFile('user.ts'), makeFile('billing.ts')], 80),
      makeResult('hotfix/typo', [], 0),
      makeResult('feature/ui', [makeFile('app.tsx')], 20),
    ]);
    const suggestion = suggestMergeOrder(scan);
    expect(suggestion.steps.length).toBe(4);
    // Hotfix (0 conflicts) should be first
    expect(suggestion.steps[0].branch).toBe('hotfix/typo');
    // Payments (most conflicts + shares user.ts with auth) should be last
    expect(suggestion.steps[suggestion.steps.length - 1].branch).toBe('feature/payments');
  });

  it('handles fallback results normally', () => {
    const scan = makeScan([
      { ...makeResult('fb-branch', [makeFile('x.ts')], 30), status: 'fallback' as const },
    ]);
    const suggestion = suggestMergeOrder(scan);
    expect(suggestion.steps.length).toBe(1);
  });

  it('riskScore is preserved in steps', () => {
    const scan = makeScan([makeResult('main', [makeFile('a.ts')], 75)]);
    const suggestion = suggestMergeOrder(scan);
    expect(suggestion.steps[0].riskScore).toBe(75);
  });
});
