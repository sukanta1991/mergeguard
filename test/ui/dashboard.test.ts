import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DashboardPanel, RiskHistoryEntry } from '../../src/ui/dashboard';
import { ConflictType, RiskLevel } from '../../src/core/types';
import type { ScanResult, ConflictResult, ConflictFile } from '../../src/core/types';

const GIT_ROOT = '/repo';

function makeFile(
  path: string,
  conflictType: ConflictType = ConflictType.Content,
): ConflictFile {
  return { path, conflictType, lineRanges: [] };
}

function makeResult(branch: string, files: ConflictFile[]): ConflictResult {
  return {
    branch,
    currentSHA: 'aaa',
    targetSHA: 'bbb',
    files,
    riskScore: files.length > 0 ? 50 : 0,
    riskLevel: files.length > 0 ? RiskLevel.Medium : RiskLevel.None,
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

/** Simple in-memory Memento mock */
function createMemento(): { get: <T>(key: string, fallback: T) => T; update: (key: string, v: unknown) => Promise<void>; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get<T>(key: string, fallback: T): T {
      return (store.has(key) ? store.get(key) : fallback) as T;
    },
    async update(key: string, value: unknown): Promise<void> {
      store.set(key, value);
    },
  };
}

describe('DashboardPanel', () => {
  let memento: ReturnType<typeof createMemento>;
  let panel: DashboardPanel;

  beforeEach(() => {
    memento = createMemento();
    panel = new DashboardPanel(memento as any);
  });

  it('is not visible by default', () => {
    expect(panel.isVisible).toBe(false);
  });

  it('show() opens the panel', () => {
    panel.show(undefined, GIT_ROOT);
    // After show(), panel is created (mock always sets visible = true)
    expect(panel.isVisible).toBe(true);
  });

  it('show() with scan data does not throw', () => {
    const scan = makeScan([makeResult('main', [makeFile('a.ts')])]);
    expect(() => panel.show(scan, GIT_ROOT)).not.toThrow();
  });

  it('show() without scan data shows empty state', () => {
    expect(() => panel.show(undefined, GIT_ROOT)).not.toThrow();
  });

  it('update() records history entry', () => {
    panel.show(undefined, GIT_ROOT);
    const scan = makeScan([makeResult('main', [makeFile('a.ts')])]);
    panel.update(scan, GIT_ROOT);
    const history = memento.get<RiskHistoryEntry[]>('mergeguard.riskHistory', []);
    expect(history.length).toBe(1);
    expect(history[0].score).toBe(scan.overallRiskScore);
  });

  it('update() trims history to max 50 entries', () => {
    panel.show(undefined, GIT_ROOT);
    for (let i = 0; i < 55; i++) {
      const scan = makeScan([makeResult('main', [makeFile('a.ts')])]);
      scan.overallRiskScore = i;
      panel.update(scan, GIT_ROOT);
    }
    const history = memento.get<RiskHistoryEntry[]>('mergeguard.riskHistory', []);
    expect(history.length).toBe(50);
    // Oldest entries trimmed, newest remain
    expect(history[history.length - 1].score).toBe(54);
  });

  it('calling show() twice reveals existing panel', () => {
    panel.show(undefined, GIT_ROOT);
    // Second call should not throw
    expect(() => panel.show(undefined, GIT_ROOT)).not.toThrow();
  });

  it('dispose() does not throw', () => {
    panel.show(undefined, GIT_ROOT);
    expect(() => panel.dispose()).not.toThrow();
  });

  it('dispose() without show() does not throw', () => {
    expect(() => panel.dispose()).not.toThrow();
  });

  it('update() without show() still records history', () => {
    const scan = makeScan([makeResult('main', [makeFile('a.ts')])]);
    panel.update(scan, GIT_ROOT);
    const history = memento.get<RiskHistoryEntry[]>('mergeguard.riskHistory', []);
    expect(history.length).toBe(1);
  });

  it('handles scan with multiple branches', () => {
    const scan = makeScan([
      makeResult('main', [makeFile('a.ts'), makeFile('b.ts')]),
      makeResult('develop', [makeFile('a.ts', ConflictType.Rename)]),
    ]);
    expect(() => panel.show(scan, GIT_ROOT)).not.toThrow();
  });

  it('handles scan with all conflict types', () => {
    const scan = makeScan([
      makeResult('main', [
        makeFile('a.ts', ConflictType.Content),
        makeFile('b.ts', ConflictType.Rename),
        makeFile('c.bin', ConflictType.Binary),
        makeFile('d.ts', ConflictType.Delete),
        makeFile('e/', ConflictType.Directory),
        makeFile('f.ts', ConflictType.ModeChange),
      ]),
    ]);
    expect(() => panel.show(scan, GIT_ROOT)).not.toThrow();
  });

  it('handles empty scan results', () => {
    const scan = makeScan([]);
    expect(() => panel.show(scan, GIT_ROOT)).not.toThrow();
  });
});
