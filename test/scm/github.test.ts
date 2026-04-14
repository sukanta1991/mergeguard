import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubProvider } from '../../src/scm/github';

// ── Mock fetch ───────────────────────────────────────────

const mockPRs = [
  {
    number: 1,
    title: 'Add feature',
    user: { login: 'alice' },
    head: { ref: 'feature/auth' },
    base: { ref: 'main' },
    html_url: 'https://github.com/owner/repo/pull/1',
    labels: [{ name: 'enhancement' }],
    requested_reviewers: [{ login: 'bob' }],
    state: 'open',
  },
  {
    number: 2,
    title: 'Fix bug',
    user: { login: 'charlie' },
    head: { ref: 'fix/login' },
    base: { ref: 'main' },
    html_url: 'https://github.com/owner/repo/pull/2',
    labels: [],
    requested_reviewers: [],
    state: 'open',
  },
];

function mockFetchResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as Response;
}

describe('GitHubProvider', () => {
  let provider: GitHubProvider;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    provider = new GitHubProvider('owner', 'repo', 'https://api.github.com');
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    provider.dispose();
    fetchSpy.mockRestore();
  });

  it('has type "github"', () => {
    expect(provider.type).toBe('github');
  });

  it('isAuthenticated returns false when no session', async () => {
    expect(await provider.isAuthenticated()).toBe(false);
  });

  it('getOpenPRs fetches from GitHub API', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(mockPRs));

    const prs = await provider.getOpenPRs();
    expect(prs).toHaveLength(2);
    expect(prs[0].id).toBe(1);
    expect(prs[0].title).toBe('Add feature');
    expect(prs[0].author).toBe('alice');
    expect(prs[0].sourceBranch).toBe('feature/auth');
    expect(prs[0].targetBranch).toBe('main');
    expect(prs[0].url).toBe('https://github.com/owner/repo/pull/1');
    expect(prs[0].labels).toEqual(['enhancement']);
    expect(prs[0].reviewers).toEqual(['bob']);
  });

  it('getOpenPRs caches results', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(mockPRs));

    await provider.getOpenPRs();
    await provider.getOpenPRs();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('getPRBranches returns source branch names', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(mockPRs));

    const branches = await provider.getPRBranches();
    expect(branches).toEqual(['feature/auth', 'fix/login']);
  });

  it('getPRMetadata returns metadata for matching branch', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(mockPRs));

    const meta = await provider.getPRMetadata('feature/auth');
    expect(meta).toEqual({
      title: 'Add feature',
      author: 'alice',
      url: 'https://github.com/owner/repo/pull/1',
      labels: ['enhancement'],
      reviewers: ['bob'],
    });
  });

  it('getPRMetadata returns undefined for unknown branch', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(mockPRs));

    const meta = await provider.getPRMetadata('nonexistent');
    expect(meta).toBeUndefined();
  });

  it('handles pagination', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      user: { login: 'user' },
      head: { ref: `branch-${i + 1}` },
      base: { ref: 'main' },
      html_url: `https://github.com/owner/repo/pull/${i + 1}`,
      labels: [],
      requested_reviewers: [],
      state: 'open',
    }));
    const page2 = [mockPRs[0]];

    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse(page1))
      .mockResolvedValueOnce(mockFetchResponse(page2));

    const prs = await provider.getOpenPRs();
    expect(prs).toHaveLength(101);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws on rate limit', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({}, 403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
      }),
    );

    await expect(provider.getOpenPRs()).rejects.toThrow('rate limit');
  });

  it('throws on API error', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, 500));

    await expect(provider.getOpenPRs()).rejects.toThrow('GitHub API error: 500');
  });

  it('sends correct headers', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse([]));

    await provider.getOpenPRs();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/repos/owner/repo/pulls'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
          'User-Agent': 'MergeGuard-VSCode',
        }),
      }),
    );
  });

  it('dispose clears cache', async () => {
    fetchSpy.mockResolvedValue(mockFetchResponse(mockPRs));

    await provider.getOpenPRs();
    provider.dispose();

    // After dispose, next call should fetch again
    fetchSpy.mockResolvedValueOnce(mockFetchResponse([]));
    const prs = await provider.getOpenPRs();
    expect(prs).toHaveLength(0);
  });
});
