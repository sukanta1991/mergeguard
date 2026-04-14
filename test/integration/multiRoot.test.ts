import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiRootManager, AggregatedScanResult } from '../../src/core/multiRootManager';
import { RiskLevel } from '../../src/core/types';
import type { ScanResult } from '../../src/core/types';

// Mock vscode
vi.mock('vscode', () => import('../__mocks__/vscode'));

// Mock gitOps so we control which roots are discovered
vi.mock('../../src/core/gitOps', () => ({
  findGitRoots: vi.fn(),
  execGit: vi.fn(),
}));

// Mock BranchMonitor, CacheManager, ScanOrchestrator
vi.mock('../../src/core/branchMonitor', () => ({
  BranchMonitor: vi.fn().mockImplementation(() => ({
    onBranchChanged: vi.fn(),
    onTrackedBranchUpdated: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('../../src/core/cache', () => ({
  CacheManager: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    invalidate: vi.fn(),
    invalidateAll: vi.fn(),
    dispose: vi.fn(),
  })),
}));

const mockRunScan = vi.fn();
const mockOnScanComplete = vi.fn();

vi.mock('../../src/core/scanOrchestrator', () => ({
  ScanOrchestrator: vi.fn().mockImplementation(() => ({
    runScan: mockRunScan,
    onScanComplete: mockOnScanComplete,
    getLastScan: vi.fn(),
    dispose: vi.fn(),
  })),
}));

import { findGitRoots } from '../../src/core/gitOps';
const mockedFindGitRoots = vi.mocked(findGitRoots);

function makeScanResult(riskScore: number, conflictFiles: number): ScanResult {
  return {
    results: [],
    overallRiskScore: riskScore,
    overallRiskLevel:
      riskScore >= 70 ? RiskLevel.High : riskScore >= 40 ? RiskLevel.Medium : riskScore > 0 ? RiskLevel.Low : RiskLevel.None,
    totalConflictFiles: conflictFiles,
    timestamp: Date.now(),
    durationMs: 50,
  };
}

describe('Integration: MultiRootManager', () => {
  const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  const mockWorkspaceState = {
    get: vi.fn(),
    update: vi.fn(),
    keys: vi.fn().mockReturnValue([]),
  };

  const mockContext = {
    workspaceState: mockWorkspaceState,
    subscriptions: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('discovers multiple git roots and creates orchestrators', async () => {
      mockedFindGitRoots.mockResolvedValue([
        '/workspace/packages/frontend',
        '/workspace/packages/backend',
      ]);

      const manager = new MultiRootManager(mockLogger as any, mockContext as any);
      const roots = await manager.initialize();

      expect(roots).toHaveLength(2);
      expect(roots).toContain('/workspace/packages/frontend');
      expect(roots).toContain('/workspace/packages/backend');
      expect(manager.getRoots()).toHaveLength(2);

      manager.dispose();
    });

    it('applies includePaths filter', async () => {
      mockedFindGitRoots.mockResolvedValue([
        '/workspace/packages/frontend',
        '/workspace/packages/backend',
        '/workspace/packages/docs',
      ]);

      const vscode = await import('vscode');
      const spy = vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (key: string, defVal?: unknown) => {
          if (key === 'includePaths') return ['frontend', 'backend'];
          if (key === 'excludePaths') return [];
          return defVal;
        },
      } as any);

      const manager = new MultiRootManager(mockLogger as any, mockContext as any);
      const roots = await manager.initialize();

      expect(roots).toHaveLength(2);
      expect(roots).not.toContain('/workspace/packages/docs');

      spy.mockRestore();
      manager.dispose();
    });

    it('applies excludePaths filter', async () => {
      mockedFindGitRoots.mockResolvedValue([
        '/workspace/packages/frontend',
        '/workspace/packages/backend',
        '/workspace/packages/docs',
      ]);

      const vscode = await import('vscode');
      const spy = vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (key: string, defVal?: unknown) => {
          if (key === 'includePaths') return [];
          if (key === 'excludePaths') return ['docs'];
          return defVal;
        },
      } as any);

      const manager = new MultiRootManager(mockLogger as any, mockContext as any);
      const roots = await manager.initialize();

      expect(roots).toHaveLength(2);
      expect(roots).not.toContain('/workspace/packages/docs');

      spy.mockRestore();
      manager.dispose();
    });
  });

  describe('scanAll', () => {
    it('scans all roots and aggregates results', async () => {
      mockedFindGitRoots.mockResolvedValue([
        '/workspace/frontend',
        '/workspace/backend',
      ]);

      // Each root's orchestrator.runScan returns different results
      let callCount = 0;
      mockRunScan.mockImplementation(() => {
        callCount++;
        return Promise.resolve(
          callCount === 1
            ? makeScanResult(30, 2) // frontend: Low risk
            : makeScanResult(75, 5), // backend: High risk
        );
      });

      const manager = new MultiRootManager(mockLogger as any, mockContext as any);
      await manager.initialize();

      const aggregated = await manager.scanAll();

      expect(aggregated.perRoot.size).toBe(2);
      expect(aggregated.overallRiskScore).toBe(75); // max of 30, 75
      expect(aggregated.overallRiskLevel).toBe(RiskLevel.High);
      expect(aggregated.totalConflictFiles).toBe(7); // 2 + 5

      manager.dispose();
    });

    it('handles scan failure in one root gracefully', async () => {
      mockedFindGitRoots.mockResolvedValue([
        '/workspace/good',
        '/workspace/broken',
      ]);

      let callCount = 0;
      mockRunScan.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(makeScanResult(50, 3));
        return Promise.reject(new Error('git error'));
      });

      const manager = new MultiRootManager(mockLogger as any, mockContext as any);
      await manager.initialize();

      const aggregated = await manager.scanAll();

      // Only the successful root should be in perRoot
      expect(aggregated.perRoot.size).toBe(1);
      expect(aggregated.overallRiskScore).toBe(50);
      expect(aggregated.totalConflictFiles).toBe(3);

      manager.dispose();
    });
  });

  describe('createUnifiedScan', () => {
    it('merges all root results into a single ScanResult', async () => {
      mockedFindGitRoots.mockResolvedValue(['/root/a', '/root/b']);

      mockRunScan.mockResolvedValue(makeScanResult(60, 4));

      const manager = new MultiRootManager(mockLogger as any, mockContext as any);
      await manager.initialize();
      await manager.scanAll();

      const unified = manager.createUnifiedScan();
      expect(unified).toBeDefined();
      expect(unified!.overallRiskScore).toBe(60);
      expect(unified!.totalConflictFiles).toBe(8); // 4 + 4

      manager.dispose();
    });

    it('returns undefined if no scan has been performed', () => {
      const manager = new MultiRootManager(mockLogger as any, mockContext as any);
      expect(manager.createUnifiedScan()).toBeUndefined();
      manager.dispose();
    });
  });

  describe('dispose', () => {
    it('cleans up all orchestrators and monitors', async () => {
      mockedFindGitRoots.mockResolvedValue(['/root/a', '/root/b']);

      const manager = new MultiRootManager(mockLogger as any, mockContext as any);
      await manager.initialize();

      expect(manager.getRoots()).toHaveLength(2);

      manager.dispose();

      expect(manager.getRoots()).toHaveLength(0);
    });
  });
});
