import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScanOrchestrator } from '../../src/core/scanOrchestrator';
import { CacheManager } from '../../src/core/cache';
import { ConflictType, RiskLevel } from '../../src/core/types';
import type { ConflictResult } from '../../src/core/types';

vi.mock('vscode', () => import('../__mocks__/vscode'));

function makeResult(branch: string, files: number = 0): ConflictResult {
  return {
    branch,
    currentSHA: 'sha-current',
    targetSHA: `sha-${branch}`,
    files: Array.from({ length: files }, (_, i) => ({
      path: `file${i}.ts`,
      conflictType: ConflictType.Content,
      lineRanges: [],
    })),
    riskScore: 0,
    riskLevel: RiskLevel.None,
    timestamp: Date.now(),
    status: 'success' as const,
  };
}

function createMockBranchMonitor(opts: {
  currentBranch?: string;
  currentSHA?: string;
  trackedBranches?: Array<{ name: string; sha: string }>;
} = {}) {
  return {
    getCurrentBranch: vi.fn().mockResolvedValue(opts.currentBranch ?? 'feature'),
    getCurrentSHA: vi.fn().mockResolvedValue(opts.currentSHA ?? 'sha-current'),
    getTrackedBranches: vi.fn().mockResolvedValue(
      (opts.trackedBranches ?? [
        { name: 'main', sha: 'sha-main' },
        { name: 'develop', sha: 'sha-develop' },
      ]).map((b) => ({ ...b, isRemote: false, isTracked: true })),
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

// Track how many concurrent analyzeConflicts calls are active
let activeCalls = 0;
let maxConcurrentCalls = 0;

vi.mock('../../src/core/analyzer', () => ({
  analyzeConflicts: vi.fn().mockImplementation(async (_current: string, target: string) => {
    activeCalls++;
    maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
    // Simulate some async work
    await new Promise(r => setTimeout(r, 10));
    activeCalls--;
    return makeResult(target);
  }),
}));

describe('ScanOrchestrator — Performance (M4.1)', () => {
  let cache: CacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new CacheManager();
    activeCalls = 0;
    maxConcurrentCalls = 0;
  });

  describe('Incremental scanning', () => {
    it('skips re-analysis for branches with unchanged SHAs on second scan', async () => {
      const monitor = createMockBranchMonitor({
        trackedBranches: [{ name: 'main', sha: 'sha-main' }],
      });
      const orchestrator = new ScanOrchestrator(monitor as any, cache, mockLogger, '/repo');

      // First scan — must analyze
      const first = await orchestrator.runScan();
      expect(first.results).toHaveLength(1);

      // Clear the cache to ensure incremental skip (not cache hit) is tested
      cache.invalidateAll();

      // Second scan — SHAs unchanged, should skip
      const second = await orchestrator.runScan();
      expect(second.results).toHaveLength(1);
      // The log should mention "Incremental skip" for the second scan
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Incremental skip'),
      );

      orchestrator.dispose();
    });

    it('re-analyzes when target SHA changes', async () => {
      let sha = 'sha-main-v1';
      const monitor = createMockBranchMonitor();
      monitor.getTrackedBranches.mockImplementation(async () => [
        { name: 'main', sha, isRemote: false, isTracked: true },
      ]);

      const orchestrator = new ScanOrchestrator(monitor as any, cache, mockLogger, '/repo');

      await orchestrator.runScan();

      // Change the target SHA
      sha = 'sha-main-v2';
      cache.invalidateAll();

      await orchestrator.runScan();

      // Should NOT see incremental skip because SHA changed
      const skipCalls = mockLogger.info.mock.calls.filter(
        (c: any) => typeof c[0] === 'string' && c[0].includes('Incremental skip'),
      );
      expect(skipCalls).toHaveLength(0);

      orchestrator.dispose();
    });
  });

  describe('Parallel branch analysis', () => {
    it('analyzes multiple branches concurrently (up to max 4)', async () => {
      const monitor = createMockBranchMonitor({
        trackedBranches: [
          { name: 'branch-1', sha: 'sha1' },
          { name: 'branch-2', sha: 'sha2' },
          { name: 'branch-3', sha: 'sha3' },
          { name: 'branch-4', sha: 'sha4' },
          { name: 'branch-5', sha: 'sha5' },
          { name: 'branch-6', sha: 'sha6' },
        ],
      });
      const orchestrator = new ScanOrchestrator(monitor as any, cache, mockLogger, '/repo');

      const result = await orchestrator.runScan();

      // All 6 branches should be analyzed
      expect(result.results).toHaveLength(6);

      // Concurrency should not exceed 4
      expect(maxConcurrentCalls).toBeLessThanOrEqual(4);
      // Should have been at least somewhat concurrent (at least 2)
      expect(maxConcurrentCalls).toBeGreaterThanOrEqual(2);

      orchestrator.dispose();
    });

    it('uses cache + parallel together correctly', async () => {
      const monitor = createMockBranchMonitor({
        trackedBranches: [
          { name: 'cached', sha: 'sha-cached' },
          { name: 'fresh-1', sha: 'sha-f1' },
          { name: 'fresh-2', sha: 'sha-f2' },
        ],
      });

      // Pre-populate cache for one branch
      cache.set('sha-current', 'sha-cached', makeResult('cached', 2));

      const orchestrator = new ScanOrchestrator(monitor as any, cache, mockLogger, '/repo');
      const result = await orchestrator.runScan();

      expect(result.results).toHaveLength(3);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cache hit'),
      );

      orchestrator.dispose();
    });
  });

  describe('Scan performance logging', () => {
    it('reports cached/skipped and analyzed counts in log', async () => {
      const monitor = createMockBranchMonitor({
        trackedBranches: [
          { name: 'main', sha: 'sha-main' },
          { name: 'develop', sha: 'sha-develop' },
        ],
      });
      cache.set('sha-current', 'sha-main', makeResult('main'));

      const orchestrator = new ScanOrchestrator(monitor as any, cache, mockLogger, '/repo');
      await orchestrator.runScan();

      // Log should mention the split: 1 cached, 1 analyzed
      const logCalls = mockLogger.info.mock.calls.map((c: any) => c[0]);
      const completionLog = logCalls.find(
        (s: string) => s.includes('Scan complete') && s.includes('cached/skipped'),
      );
      expect(completionLog).toBeDefined();

      orchestrator.dispose();
    });
  });
});
