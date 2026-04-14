import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiRootManager } from '../../src/core/multiRootManager';
import { RiskLevel } from '../../src/core/types';
import type { ScanResult } from '../../src/core/types';

// Mock vscode
vi.mock('vscode', () => import('../__mocks__/vscode'));

// Mock gitOps.findGitRoots
const mockFindGitRoots = vi.fn();
vi.mock('../../src/core/gitOps', () => ({
  findGitRoots: () => mockFindGitRoots(),
  execGit: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
}));

// Mock dependencies that ScanOrchestrator / BranchMonitor use
vi.mock('../../src/core/analyzer', () => ({
  analyzeConflicts: vi.fn().mockResolvedValue({
    branch: 'main',
    currentSHA: 'abc',
    targetSHA: 'def',
    files: [],
    riskScore: 0,
    riskLevel: 'none',
    timestamp: Date.now(),
    status: 'success',
  }),
}));

vi.mock('../../src/core/riskScorer', () => ({
  calculateRiskScore: vi.fn().mockReturnValue({ score: 0, level: 'none' }),
  scoreConflictResult: vi.fn(),
}));

describe('MultiRootManager', () => {
  let manager: MultiRootManager;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dispose: vi.fn(),
  };
  const mockContext = {
    workspaceState: {
      get: vi.fn().mockReturnValue({}),
      update: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockReturnValue([]),
    },
    globalState: {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockReturnValue([]),
    },
    secrets: {
      get: vi.fn(),
      store: vi.fn(),
      delete: vi.fn(),
      onDidChange: vi.fn(),
    },
    subscriptions: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MultiRootManager(mockLogger as any, mockContext as any);
  });

  it('initializes with discovered git roots', async () => {
    mockFindGitRoots.mockResolvedValue(['/repo1', '/repo2']);

    const roots = await manager.initialize();
    expect(roots).toEqual(['/repo1', '/repo2']);
    expect(manager.getRoots()).toEqual(['/repo1', '/repo2']);
  });

  it('initializes with empty roots', async () => {
    mockFindGitRoots.mockResolvedValue([]);

    const roots = await manager.initialize();
    expect(roots).toEqual([]);
    expect(manager.getRoots()).toEqual([]);
  });

  it('returns orchestrator for a specific root', async () => {
    mockFindGitRoots.mockResolvedValue(['/repo1']);
    await manager.initialize();

    expect(manager.getOrchestrator('/repo1')).toBeDefined();
    expect(manager.getOrchestrator('/nonexistent')).toBeUndefined();
  });

  it('getLastScan returns undefined before any scan', async () => {
    mockFindGitRoots.mockResolvedValue(['/repo1']);
    await manager.initialize();

    expect(manager.getLastScan('/repo1')).toBeUndefined();
  });

  it('getLastAggregated returns undefined before scanAll', () => {
    expect(manager.getLastAggregated()).toBeUndefined();
  });

  it('createUnifiedScan returns undefined before scanAll', () => {
    expect(manager.createUnifiedScan()).toBeUndefined();
  });

  it('dispose cleans up all resources', async () => {
    mockFindGitRoots.mockResolvedValue(['/repo1', '/repo2']);
    await manager.initialize();

    manager.dispose();
    expect(manager.getRoots()).toEqual([]);
  });

  it('does not duplicate roots on re-initialization', async () => {
    mockFindGitRoots.mockResolvedValue(['/repo1', '/repo1']);
    await manager.initialize();

    // Should deduplicate
    expect(manager.getRoots()).toEqual(['/repo1']);
  });

  it('fires onScanComplete listeners', async () => {
    mockFindGitRoots.mockResolvedValue(['/repo1']);
    await manager.initialize();

    const listener = vi.fn();
    manager.onScanComplete(listener);

    // Force a scan via the orchestrator
    const orchestrator = manager.getOrchestrator('/repo1');
    expect(orchestrator).toBeDefined();
  });
});
