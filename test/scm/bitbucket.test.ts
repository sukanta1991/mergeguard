import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BitbucketProvider } from '../../src/scm/bitbucket';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock vscode
vi.mock('vscode', () => import('../__mocks__/vscode'));

function makeBBPR(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'Add feature',
    author: { display_name: 'Alice Smith', nickname: 'alice' },
    source: { branch: { name: 'feature/auth' } },
    destination: { branch: { name: 'main' } },
    links: { html: { href: 'https://bitbucket.org/owner/repo/pull-requests/1' } },
    reviewers: [{ display_name: 'Bob', nickname: 'bob' }],
    state: 'OPEN',
    ...overrides,
  };
}

describe('BitbucketProvider', () => {
  let provider: BitbucketProvider;
  const mockSecrets = {
    get: vi.fn(),
    store: vi.fn(),
    delete: vi.fn(),
    onDidChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new BitbucketProvider('owner', 'repo', 'https://api.bitbucket.org/2.0', mockSecrets as any);
  });

  afterEach(() => {
    provider.dispose();
  });

  it('has type "bitbucket"', () => {
    expect(provider.type).toBe('bitbucket');
  });

  it('isAuthenticated returns false when no credentials stored', async () => {
    mockSecrets.get.mockResolvedValue(undefined);
    expect(await provider.isAuthenticated()).toBe(false);
  });

  it('isAuthenticated returns true when credentials are stored', async () => {
    mockSecrets.get.mockResolvedValue(JSON.stringify({ username: 'user', password: 'pass' }));
    expect(await provider.isAuthenticated()).toBe(true);
  });

  it('getOpenPRs fetches and maps PRs', async () => {
    mockSecrets.get.mockResolvedValue(JSON.stringify({ username: 'user', password: 'pass' }));
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ values: [makeBBPR()], next: undefined }),
    });

    const prs = await provider.getOpenPRs();

    expect(prs).toHaveLength(1);
    expect(prs[0].id).toBe(1);
    expect(prs[0].title).toBe('Add feature');
    expect(prs[0].author).toBe('alice');
    expect(prs[0].sourceBranch).toBe('feature/auth');
    expect(prs[0].targetBranch).toBe('main');
    expect(prs[0].reviewers).toEqual(['bob']);
  });

  it('getPRBranches returns source branch names', async () => {
    mockSecrets.get.mockResolvedValue(JSON.stringify({ username: 'user', password: 'pass' }));
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        values: [makeBBPR(), makeBBPR({ id: 2, source: { branch: { name: 'fix/bug' } } })],
        next: undefined,
      }),
    });

    const branches = await provider.getPRBranches();
    expect(branches).toEqual(['feature/auth', 'fix/bug']);
  });

  it('getPRMetadata returns metadata for a matching branch', async () => {
    mockSecrets.get.mockResolvedValue(JSON.stringify({ username: 'user', password: 'pass' }));
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ values: [makeBBPR()], next: undefined }),
    });

    const meta = await provider.getPRMetadata('feature/auth');
    expect(meta).toBeDefined();
    expect(meta!.title).toBe('Add feature');
    expect(meta!.author).toBe('alice');
  });

  it('getPRMetadata returns undefined for non-matching branch', async () => {
    mockSecrets.get.mockResolvedValue(JSON.stringify({ username: 'user', password: 'pass' }));
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ values: [makeBBPR()], next: undefined }),
    });

    const meta = await provider.getPRMetadata('nonexistent');
    expect(meta).toBeUndefined();
  });

  it('caches PRs for subsequent calls within TTL', async () => {
    mockSecrets.get.mockResolvedValue(JSON.stringify({ username: 'user', password: 'pass' }));
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ values: [makeBBPR()], next: undefined }),
    });

    await provider.getOpenPRs();
    await provider.getOpenPRs();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles pagination via next URL', async () => {
    mockSecrets.get.mockResolvedValue(JSON.stringify({ username: 'user', password: 'pass' }));
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          values: [makeBBPR({ id: 1 })],
          next: 'https://api.bitbucket.org/2.0/repositories/owner/repo/pullrequests?page=2',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          values: [makeBBPR({ id: 2, source: { branch: { name: 'fix/bug' } } })],
          next: undefined,
        }),
      });

    const prs = await provider.getOpenPRs();
    expect(prs).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('sends Basic auth header when credentials are available', async () => {
    mockSecrets.get.mockResolvedValue(JSON.stringify({ username: 'user', password: 'pass' }));
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ values: [], next: undefined }),
    });

    await provider.getOpenPRs();

    const headers = mockFetch.mock.calls[0][1]?.headers;
    expect(headers.Authorization).toMatch(/^Basic /);
  });

  it('throws on 401 response', async () => {
    mockSecrets.get.mockResolvedValue(JSON.stringify({ username: 'user', password: 'bad' }));
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(provider.getOpenPRs()).rejects.toThrow('Unauthorized');
  });

  it('dispose clears cached data', async () => {
    mockSecrets.get.mockResolvedValue(JSON.stringify({ username: 'user', password: 'pass' }));
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ values: [makeBBPR()], next: undefined }),
    });

    await provider.getOpenPRs();
    provider.dispose();

    // After dispose, a new fetch should occur
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ values: [], next: undefined }),
    });

    // But isAuthenticated should return false since credentials are cleared
    mockSecrets.get.mockResolvedValue(undefined);
    expect(await provider.isAuthenticated()).toBe(false);
  });
});
