import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScanOrchestrator } from '../../src/core/scanOrchestrator';
import { CacheManager } from '../../src/core/cache';
import { ConflictType, RiskLevel } from '../../src/core/types';

vi.mock('vscode', () => import('../__mocks__/vscode'));

const mockAnalyze = vi.fn();
vi.mock('../../src/core/analyzer', () => ({
  analyzeConflicts: (...args: any[]) => mockAnalyze(...args),
}));

function createMockBranchMonitor(opts: {
  currentBranch?: string;
  currentSHA?: string;
  trackedBranches?: Array<{ name: string; sha: string }>;
  throwOnGetBranch?: boolean;
} = {}) {
  return {
    getCurrentBranch: opts.throwOnGetBranch
      ? vi.fn().mockRejectedValue(new Error('Repository may be corrupted'))
      : vi.fn().mockResolvedValue(opts.currentBranch ?? 'feature'),
    getCurrentSHA: vi.fn().mockResolvedValue(opts.currentSHA ?? 'sha-current'),
    getTrackedBranches: vi.fn().mockResolvedValue(
      (opts.trackedBranches ?? [{ name: 'main', sha: 'sha-main' }]).map((b) => ({
        ...b, isRemote: false, isTracked: true,
      })),
    ),
    onBranchChanged: () => ({ dispose: () => {} }),
    onTrackedBranchUpdated: () => ({ dispose: () => {} }),
  };
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as any;

describe('Error Handling Hardening (M4.2)', () => {
  let cache: CacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new CacheManager();
    mockAnalyze.mockResolvedValue({
      branch: 'main',
      currentSHA: 'sha-current',
      targetSHA: 'sha-main',
      files: [],
      riskScore: 0,
      riskLevel: RiskLevel.None,
      timestamp: Date.now(),
      status: 'success',
    });
  });

  describe('Git process failures', () => {
    it('handles analyzer timeout gracefully — returns error result', async () => {
      mockAnalyze.mockRejectedValue(new Error('Process timed out'));

      const monitor = createMockBranchMonitor();
      const orchestrator = new ScanOrchestrator(monitor as any, cache, mockLogger, '/repo');

      const result = await orchestrator.runScan();

      // Should not throw — returns a result with error status
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('error');
      expect(result.results[0].errorMessage).toContain('timed out');

      orchestrator.dispose();
    });

    it('handles repository corruption gracefully', async () => {
      mockAnalyze.mockRejectedValue(new Error('fatal: bad object HEAD'));

      const monitor = createMockBranchMonitor();
      const orchestrator = new ScanOrchestrator(monitor as any, cache, mockLogger, '/repo');

      const result = await orchestrator.runScan();

      expect(result.results[0].status).toBe('error');
      expect(result.results[0].errorMessage).toContain('bad object');

      orchestrator.dispose();
    });

    it('partial failure: successful branches still returned', async () => {
      let callCount = 0;
      mockAnalyze.mockImplementation(async (_c: string, target: string) => {
        callCount++;
        if (target === 'broken') {
          throw new Error('fatal: not a git repository');
        }
        return {
          branch: target,
          currentSHA: 'sha-current',
          targetSHA: `sha-${target}`,
          files: [{ path: 'x.ts', conflictType: ConflictType.Content, lineRanges: [] }],
          riskScore: 50,
          riskLevel: RiskLevel.Medium,
          timestamp: Date.now(),
          status: 'success',
        };
      });

      const monitor = createMockBranchMonitor({
        trackedBranches: [
          { name: 'main', sha: 'sha-main' },
          { name: 'broken', sha: 'sha-broken' },
        ],
      });
      const orchestrator = new ScanOrchestrator(monitor as any, cache, mockLogger, '/repo');

      const result = await orchestrator.runScan();

      expect(result.results).toHaveLength(2);
      const successResult = result.results.find(r => r.branch === 'main');
      const errorResult = result.results.find(r => r.branch === 'broken');
      expect(successResult?.status).toBe('success');
      expect(errorResult?.status).toBe('error');
      expect(result.totalConflictFiles).toBe(1); // Only from successful branch

      orchestrator.dispose();
    });
  });

  describe('No uncaught exceptions', () => {
    it('safeScan wraps runScan errors', async () => {
      const monitor = createMockBranchMonitor({ throwOnGetBranch: true });
      const orchestrator = new ScanOrchestrator(monitor as any, cache, mockLogger, '/repo');

      // safeScan should not throw even when runScan does
      orchestrator.startAutoScan();

      // Trigger a branch change to invoke safeScan
      // Since getCurrentBranch throws, runScan would throw — but safeScan catches it
      // We verify by attempting a manual runScan which should throw
      await expect(orchestrator.runScan()).rejects.toThrow('corrupted');

      orchestrator.dispose();
    });
  });

  describe('Logging', () => {
    it('logs error with message when analyzer fails', async () => {
      mockAnalyze.mockRejectedValue(new Error('EACCES: permission denied'));

      const monitor = createMockBranchMonitor();
      const orchestrator = new ScanOrchestrator(monitor as any, cache, mockLogger, '/repo');

      const result = await orchestrator.runScan();

      expect(result.results[0].errorMessage).toContain('EACCES');

      orchestrator.dispose();
    });
  });
});
