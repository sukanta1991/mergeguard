import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getTeamActivity,
  buildFileTeamActivity,
  formatTeamActivity,
} from '../../src/core/teamAwareness';
import type { SCMProvider, PR } from '../../src/scm/provider';

// Mock vscode and gitOps
vi.mock('vscode', () => import('../__mocks__/vscode'));

const mockExecGit = vi.fn();
vi.mock('../../src/core/gitOps', () => ({
  execGit: (...args: unknown[]) => mockExecGit(...args),
}));

function makeMockProvider(prs: PR[]): SCMProvider {
  return {
    type: 'github',
    isAuthenticated: vi.fn().mockResolvedValue(true),
    getOpenPRs: vi.fn().mockResolvedValue(prs),
    getPRBranches: vi.fn().mockResolvedValue(prs.map(p => p.sourceBranch)),
    getPRMetadata: vi.fn(),
    dispose: vi.fn(),
  };
}

const samplePRs: PR[] = [
  {
    id: 42,
    title: 'Add auth',
    author: 'alice',
    sourceBranch: 'feature/auth',
    targetBranch: 'main',
    url: 'https://github.com/o/r/pull/42',
    labels: [],
    reviewers: [],
    state: 'open',
  },
  {
    id: 43,
    title: 'Fix login',
    author: 'bob',
    sourceBranch: 'fix/login',
    targetBranch: 'main',
    url: 'https://github.com/o/r/pull/43',
    labels: [],
    reviewers: [],
    state: 'open',
  },
  {
    id: 44,
    title: 'My branch',
    author: 'me',
    sourceBranch: 'my-branch',
    targetBranch: 'main',
    url: 'https://github.com/o/r/pull/44',
    labels: [],
    reviewers: [],
    state: 'open',
  },
];

describe('getTeamActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excludes current branch from results', async () => {
    const provider = makeMockProvider(samplePRs);

    // merge-base calls
    mockExecGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'src/auth.ts\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'def456\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'src/login.ts\n', stderr: '' });

    const activities = await getTeamActivity(provider, '/repo', 'my-branch');

    // Should not include my-branch
    expect(activities.map(a => a.branch)).not.toContain('my-branch');
    expect(activities).toHaveLength(2);
  });

  it('returns modified files per teammate branch', async () => {
    const provider = makeMockProvider([samplePRs[0]]);

    mockExecGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'aaa\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'src/auth.ts\nsrc/utils.ts\n', stderr: '' });

    const activities = await getTeamActivity(provider, '/repo', 'main');

    expect(activities).toHaveLength(1);
    expect(activities[0].author).toBe('alice');
    expect(activities[0].branch).toBe('feature/auth');
    expect(activities[0].modifiedFiles).toEqual(['src/auth.ts', 'src/utils.ts']);
    expect(activities[0].prUrl).toBe('https://github.com/o/r/pull/42');
  });

  it('returns empty array on provider error', async () => {
    const provider = makeMockProvider([]);
    (provider.getOpenPRs as any).mockRejectedValue(new Error('fail'));

    const activities = await getTeamActivity(provider, '/repo', 'main');
    expect(activities).toEqual([]);
  });

  it('skips branches with no changed files', async () => {
    const provider = makeMockProvider([samplePRs[0]]);

    // merge-base OK, but diff returns empty
    mockExecGit
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'aaa\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '\n', stderr: '' });

    const activities = await getTeamActivity(provider, '/repo', 'main');
    expect(activities).toHaveLength(0);
  });

  it('handles merge-base failure gracefully', async () => {
    const provider = makeMockProvider([samplePRs[0]]);
    mockExecGit.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'fatal' });

    const activities = await getTeamActivity(provider, '/repo', 'main');
    expect(activities).toHaveLength(0);
  });
});

describe('buildFileTeamActivity', () => {
  it('groups activities by file path', () => {
    const result = buildFileTeamActivity([
      { author: 'alice', branch: 'feature/a', modifiedFiles: ['src/auth.ts', 'src/shared.ts'] },
      { author: 'bob', branch: 'feature/b', modifiedFiles: ['src/shared.ts', 'src/login.ts'] },
    ]);

    expect(result).toHaveLength(3);

    const shared = result.find(f => f.filePath === 'src/shared.ts');
    expect(shared).toBeDefined();
    expect(shared!.teammates).toHaveLength(2);
    expect(shared!.teammates.map(t => t.author)).toEqual(['alice', 'bob']);

    const auth = result.find(f => f.filePath === 'src/auth.ts');
    expect(auth!.teammates).toHaveLength(1);
    expect(auth!.teammates[0].author).toBe('alice');
  });

  it('returns empty for empty input', () => {
    expect(buildFileTeamActivity([])).toEqual([]);
  });
});

describe('formatTeamActivity', () => {
  it('formats teammates list', () => {
    const result = formatTeamActivity({
      filePath: 'src/auth.ts',
      teammates: [
        { author: 'alice', branch: 'feature/auth' },
        { author: 'bob', branch: 'fix/login' },
      ],
    });
    expect(result).toBe('Also modified by @alice (feature/auth), @bob (fix/login)');
  });

  it('returns empty string for no teammates', () => {
    const result = formatTeamActivity({ filePath: 'src/auth.ts', teammates: [] });
    expect(result).toBe('');
  });
});
