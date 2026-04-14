import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitLabProvider } from '../../src/scm/gitlab';

// ── Mock data ────────────────────────────────────────────

const mockMRs = [
  {
    iid: 10,
    title: 'Add auth module',
    author: { username: 'alice' },
    source_branch: 'feature/auth',
    target_branch: 'main',
    web_url: 'https://gitlab.com/owner/repo/-/merge_requests/10',
    labels: ['backend'],
    reviewers: [{ username: 'bob' }],
    state: 'opened',
  },
  {
    iid: 11,
    title: 'Fix CI pipeline',
    author: { username: 'charlie' },
    source_branch: 'fix/ci',
    target_branch: 'main',
    web_url: 'https://gitlab.com/owner/repo/-/merge_requests/11',
    labels: [],
    reviewers: [],
    state: 'opened',
  },
];

function mockFetchResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
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

// ── Mock SecretStorage ───────────────────────────────────

function createMockSecrets(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get: async (key: string) => store.get(key),
    store: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    onDidChange: () => ({ dispose: () => {} }),
  } as unknown as import('vscode').SecretStorage;
}

// ── Tests ────────────────────────────────────────────────

describe('GitLabProvider', () => {
  let provider: GitLabProvider;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    provider = new GitLabProvider(
      'owner',
      'repo',
      'https://gitlab.com/api/v4',
      createMockSecrets(),
    );
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    provider.dispose();
    fetchSpy.mockRestore();
  });

  it('has type "gitlab"', () => {
    expect(provider.type).toBe('gitlab');
  });

  it('isAuthenticated returns false when no token', async () => {
    expect(await provider.isAuthenticated()).toBe(false);
  });

  it('isAuthenticated returns true after setToken', async () => {
    await provider.setToken('glpat-test');
    expect(await provider.isAuthenticated()).toBe(true);
  });

  it('getOpenPRs fetches merge requests', async () => {
    await provider.setToken('glpat-test');
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(mockMRs, 200, { 'x-next-page': '' }),
    );

    const prs = await provider.getOpenPRs();
    expect(prs).toHaveLength(2);
    expect(prs[0].id).toBe(10);
    expect(prs[0].title).toBe('Add auth module');
    expect(prs[0].author).toBe('alice');
    expect(prs[0].sourceBranch).toBe('feature/auth');
    expect(prs[0].url).toContain('merge_requests/10');
    expect(prs[0].labels).toEqual(['backend']);
    expect(prs[0].reviewers).toEqual(['bob']);
  });

  it('getOpenPRs caches results', async () => {
    await provider.setToken('glpat-test');
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(mockMRs, 200, { 'x-next-page': '' }),
    );

    await provider.getOpenPRs();
    await provider.getOpenPRs();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('getPRBranches returns source branch names', async () => {
    await provider.setToken('glpat-test');
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(mockMRs, 200, { 'x-next-page': '' }),
    );

    const branches = await provider.getPRBranches();
    expect(branches).toEqual(['feature/auth', 'fix/ci']);
  });

  it('getPRMetadata returns metadata for matching branch', async () => {
    await provider.setToken('glpat-test');
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(mockMRs, 200, { 'x-next-page': '' }),
    );

    const meta = await provider.getPRMetadata('feature/auth');
    expect(meta).toEqual({
      title: 'Add auth module',
      author: 'alice',
      url: 'https://gitlab.com/owner/repo/-/merge_requests/10',
      labels: ['backend'],
      reviewers: ['bob'],
    });
  });

  it('getPRMetadata returns undefined for unknown branch', async () => {
    await provider.setToken('glpat-test');
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(mockMRs, 200, { 'x-next-page': '' }),
    );

    const meta = await provider.getPRMetadata('nonexistent');
    expect(meta).toBeUndefined();
  });

  it('handles pagination with x-next-page', async () => {
    await provider.setToken('glpat-test');
    fetchSpy
      .mockResolvedValueOnce(
        mockFetchResponse([mockMRs[0]], 200, { 'x-next-page': '2' }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse([mockMRs[1]], 200, { 'x-next-page': '' }),
      );

    const prs = await provider.getOpenPRs();
    expect(prs).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws on 401 unauthorized', async () => {
    await provider.setToken('bad-token');
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, 401));

    await expect(provider.getOpenPRs()).rejects.toThrow('Unauthorized');
  });

  it('throws on API error', async () => {
    await provider.setToken('glpat-test');
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, 500));

    await expect(provider.getOpenPRs()).rejects.toThrow('GitLab API error: 500');
  });

  it('sends PRIVATE-TOKEN header', async () => {
    await provider.setToken('glpat-test');
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse([], 200, { 'x-next-page': '' }),
    );

    await provider.getOpenPRs();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/projects/owner%2Frepo/merge_requests'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'PRIVATE-TOKEN': 'glpat-test',
        }),
      }),
    );
  });

  it('uses SecretStorage to persist token', async () => {
    const secrets = createMockSecrets();
    const p = new GitLabProvider('o', 'r', 'https://gitlab.com/api/v4', secrets);

    await p.setToken('glpat-stored');

    // Create new provider with same secrets — should find stored token
    const p2 = new GitLabProvider('o', 'r', 'https://gitlab.com/api/v4', secrets);
    expect(await p2.isAuthenticated()).toBe(true);

    p.dispose();
    p2.dispose();
  });

  it('dispose clears cache', async () => {
    await provider.setToken('glpat-test');
    fetchSpy.mockResolvedValue(
      mockFetchResponse(mockMRs, 200, { 'x-next-page': '' }),
    );

    await provider.getOpenPRs();
    provider.dispose();

    // Re-create and set token
    provider = new GitLabProvider('owner', 'repo', 'https://gitlab.com/api/v4', createMockSecrets());
    await provider.setToken('glpat-test');
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse([], 200, { 'x-next-page': '' }),
    );
    const prs = await provider.getOpenPRs();
    expect(prs).toHaveLength(0);
  });
});
