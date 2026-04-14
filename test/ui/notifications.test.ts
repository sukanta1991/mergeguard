import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { NotificationManager, NotificationLevel } from '../../src/ui/notifications';
import { ConflictType, RiskLevel } from '../../src/core/types';
import type { ScanResult, ConflictResult, ConflictFile } from '../../src/core/types';

function makeFile(path: string): ConflictFile {
  return { path, conflictType: ConflictType.Content, lineRanges: [] };
}

function makeResult(
  branch: string,
  files: ConflictFile[],
  riskLevel: RiskLevel = RiskLevel.Medium,
): ConflictResult {
  return {
    branch,
    currentSHA: 'aaa',
    targetSHA: 'bbb',
    files,
    riskScore: 50,
    riskLevel,
    timestamp: Date.now(),
    status: 'success',
  };
}

function makeScan(results: ConflictResult[]): ScanResult {
  return {
    results,
    overallRiskScore: 50,
    overallRiskLevel: RiskLevel.Medium,
    totalConflictFiles: results.reduce((s, r) => s + r.files.length, 0),
    timestamp: Date.now(),
    durationMs: 100,
  };
}

/** Simple in-memory Memento mock */
function createMemento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, fallback?: T): T {
      return (store.has(key) ? store.get(key) : fallback) as T;
    },
    async update(key: string, value: unknown): Promise<void> {
      store.set(key, value);
    },
    keys: () => [...store.keys()],
  } as vscode.Memento;
}

// Override getConfiguration for notification tests
let mockNotificationLevel: NotificationLevel = 'all';

vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => ({
  get: <T>(key: string, defaultValue?: T): T => {
    if (key === 'notificationLevel') return mockNotificationLevel as unknown as T;
    return defaultValue as T;
  },
  update: async () => {},
  has: () => true,
  inspect: () => undefined,
}) as unknown as vscode.WorkspaceConfiguration);

describe('NotificationManager', () => {
  let memento: vscode.Memento;
  let mgr: NotificationManager;

  beforeEach(() => {
    memento = createMemento();
    mgr = new NotificationManager(memento);
    mockNotificationLevel = 'all';
  });

  it('detects all conflicts as new on first scan', async () => {
    const scan = makeScan([
      makeResult('main', [makeFile('a.ts'), makeFile('b.ts')]),
    ]);
    const count = await mgr.processScan(scan);
    expect(count).toBe(2);
  });

  it('detects zero new conflicts on repeated scan', async () => {
    const scan = makeScan([
      makeResult('main', [makeFile('a.ts')]),
    ]);
    await mgr.processScan(scan);
    const count = await mgr.processScan(scan);
    expect(count).toBe(0);
  });

  it('detects re-appeared conflicts after they resolve', async () => {
    const scan1 = makeScan([makeResult('main', [makeFile('a.ts')])]);
    await mgr.processScan(scan1);

    // a.ts resolves
    const scan2 = makeScan([makeResult('main', [])]);
    await mgr.processScan(scan2);

    // a.ts reappears
    const scan3 = makeScan([makeResult('main', [makeFile('a.ts')])]);
    const count = await mgr.processScan(scan3);
    expect(count).toBe(1);
  });

  it('returns 0 in silent mode', async () => {
    mockNotificationLevel = 'silent';
    const scan = makeScan([makeResult('main', [makeFile('a.ts')])]);
    const count = await mgr.processScan(scan);
    expect(count).toBe(0);
  });

  it('skips dismissed branches', async () => {
    await mgr.dismissBranch('main');
    const scan = makeScan([makeResult('main', [makeFile('a.ts')])]);
    const count = await mgr.processScan(scan);
    expect(count).toBe(0);
  });

  it('dismissBranch persists to state', async () => {
    await mgr.dismissBranch('main');
    expect(mgr.isDismissed('main')).toBe(true);
    expect(mgr.isDismissed('develop')).toBe(false);
  });

  it('clearDismissed resets all', async () => {
    await mgr.dismissBranch('main');
    await mgr.dismissBranch('develop');
    await mgr.clearDismissed();
    expect(mgr.isDismissed('main')).toBe(false);
    expect(mgr.isDismissed('develop')).toBe(false);
  });

  it('reset clears all state', async () => {
    const scan = makeScan([makeResult('main', [makeFile('a.ts')])]);
    await mgr.processScan(scan);
    await mgr.dismissBranch('main');
    await mgr.reset();
    expect(mgr.isDismissed('main')).toBe(false);
    expect(mgr.getNewConflictCount()).toBe(0);
  });

  it('skips error results', async () => {
    const scan = makeScan([
      { ...makeResult('main', [makeFile('a.ts')]), status: 'error' as const },
    ]);
    const count = await mgr.processScan(scan);
    expect(count).toBe(0);
  });

  it('getNewConflictCount reflects last scan', async () => {
    const scan = makeScan([makeResult('main', [makeFile('a.ts'), makeFile('b.ts')])]);
    await mgr.processScan(scan);
    expect(mgr.getNewConflictCount()).toBe(2);
  });

  it('handles multiple branches independently', async () => {
    const scan1 = makeScan([
      makeResult('main', [makeFile('a.ts')]),
      makeResult('develop', [makeFile('b.ts')]),
    ]);
    await mgr.processScan(scan1);

    // Only develop gets a new file
    const scan2 = makeScan([
      makeResult('main', [makeFile('a.ts')]),
      makeResult('develop', [makeFile('b.ts'), makeFile('c.ts')]),
    ]);
    const count = await mgr.processScan(scan2);
    expect(count).toBe(1);
  });

  it('badge mode still counts new conflicts', async () => {
    mockNotificationLevel = 'badge';
    const scan = makeScan([makeResult('main', [makeFile('a.ts')])]);
    const count = await mgr.processScan(scan);
    expect(count).toBe(1);
    expect(mgr.getNewConflictCount()).toBe(1);
  });

  it('dispose does not throw', () => {
    expect(() => mgr.dispose()).not.toThrow();
  });
});
