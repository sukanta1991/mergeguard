import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPRBranchesToScan,
  enrichWithPRMetadata,
  formatPRDescription,
} from '../../src/core/prAwareAnalysis';
import type { SCMProvider, PR } from '../../src/scm/provider';
import type { ScanResult } from '../../src/core/types';
import { RiskLevel } from '../../src/core/types';

vi.mock('vscode', () => import('../__mocks__/vscode'));

function makeMockProvider(prs: PR[]): SCMProvider {
  return {
    type: 'github',
    isAuthenticated: vi.fn().mockResolvedValue(true),
    getOpenPRs: vi.fn().mockResolvedValue(prs),
    getPRBranches: vi.fn().mockResolvedValue(prs.map(p => p.sourceBranch)),
    getPRMetadata: vi.fn().mockImplementation(async (branch: string) => {
      const pr = prs.find(p => p.sourceBranch === branch);
      if (!pr) return undefined;
      return { title: pr.title, author: pr.author, url: pr.url, labels: pr.labels, reviewers: pr.reviewers };
    }),
    dispose: vi.fn(),
  };
}

function makeScanResult(branches: string[]): ScanResult {
  return {
    results: branches.map(b => ({
      branch: b,
      currentSHA: 'abc123',
      targetSHA: 'def456',
      files: [{ path: 'src/auth.ts', conflictType: 'content' as any, lineRanges: [] }],
      riskScore: 50,
      riskLevel: RiskLevel.Medium,
      timestamp: Date.now(),
      status: 'success' as const,
    })),
    overallRiskScore: 50,
    overallRiskLevel: RiskLevel.Medium,
    totalConflictFiles: branches.length,
    timestamp: Date.now(),
    durationMs: 100,
  };
}

const samplePRs: PR[] = [
  {
    id: 42,
    title: 'Add user auth',
    author: 'alice',
    sourceBranch: 'feature/auth',
    targetBranch: 'main',
    url: 'https://github.com/owner/repo/pull/42',
    labels: ['enhancement'],
    reviewers: ['bob'],
    state: 'open',
  },
  {
    id: 43,
    title: 'Fix login bug',
    author: 'bob',
    sourceBranch: 'fix/login',
    targetBranch: 'main',
    url: 'https://github.com/owner/repo/pull/43',
    labels: ['bug'],
    reviewers: [],
    state: 'open',
  },
];

describe('getPRBranchesToScan', () => {
  it('returns PR branches not already in tracked list', async () => {
    const provider = makeMockProvider(samplePRs);
    const result = await getPRBranchesToScan(provider, ['main', 'feature/auth']);
    expect(result).toEqual(['fix/login']);
  });

  it('returns empty if all PR branches are already tracked', async () => {
    const provider = makeMockProvider(samplePRs);
    const result = await getPRBranchesToScan(provider, ['main', 'feature/auth', 'fix/login']);
    expect(result).toEqual([]);
  });

  it('returns all PR branches when none are tracked', async () => {
    const provider = makeMockProvider(samplePRs);
    const result = await getPRBranchesToScan(provider, ['main']);
    expect(result).toEqual(['feature/auth', 'fix/login']);
  });

  it('returns empty on provider error', async () => {
    const provider = makeMockProvider([]);
    (provider.getPRBranches as any).mockRejectedValue(new Error('API error'));
    const result = await getPRBranchesToScan(provider, ['main']);
    expect(result).toEqual([]);
  });
});

describe('enrichWithPRMetadata', () => {
  it('maps PR metadata to matching branches in scan results', async () => {
    const provider = makeMockProvider(samplePRs);
    const scan = makeScanResult(['feature/auth', 'fix/login', 'develop']);

    const prInfoMap = await enrichWithPRMetadata(scan, provider);

    expect(prInfoMap.size).toBe(2);
    expect(prInfoMap.get('feature/auth')).toBeDefined();
    expect(prInfoMap.get('feature/auth')!.prId).toBe(42);
    expect(prInfoMap.get('feature/auth')!.title).toBe('Add user auth');
    expect(prInfoMap.get('feature/auth')!.author).toBe('alice');
    expect(prInfoMap.get('fix/login')).toBeDefined();
    expect(prInfoMap.get('fix/login')!.prId).toBe(43);
    expect(prInfoMap.has('develop')).toBe(false);
  });

  it('returns empty map when no PRs match', async () => {
    const provider = makeMockProvider(samplePRs);
    const scan = makeScanResult(['develop']);

    const prInfoMap = await enrichWithPRMetadata(scan, provider);
    expect(prInfoMap.size).toBe(0);
  });

  it('returns empty map on provider error', async () => {
    const provider = makeMockProvider([]);
    (provider.getOpenPRs as any).mockRejectedValue(new Error('fail'));
    const scan = makeScanResult(['feature/auth']);

    const prInfoMap = await enrichWithPRMetadata(scan, provider);
    expect(prInfoMap.size).toBe(0);
  });
});

describe('formatPRDescription', () => {
  it('formats a PR description string', () => {
    const result = formatPRDescription({
      prId: 42,
      title: 'Add user auth',
      author: 'alice',
      url: 'https://github.com/owner/repo/pull/42',
      labels: [],
      reviewers: [],
    });
    expect(result).toBe("PR #42 'Add user auth' by @alice");
  });
});
