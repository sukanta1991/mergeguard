import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AzureDevOpsProvider, createAzureDevOpsProvider } from '../../src/scm/azureDevops';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock vscode
vi.mock('vscode', () => import('../__mocks__/vscode'));

function makeAdoPR(overrides: Record<string, unknown> = {}) {
  return {
    pullRequestId: 100,
    title: 'Add auth flow',
    createdBy: { displayName: 'Alice', uniqueName: 'alice@contoso.com' },
    sourceRefName: 'refs/heads/feature/auth',
    targetRefName: 'refs/heads/main',
    url: 'https://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/100',
    labels: [{ name: 'enhancement' }],
    reviewers: [{ displayName: 'Bob', uniqueName: 'bob@contoso.com' }],
    status: 'active',
    ...overrides,
  };
}

describe('AzureDevOpsProvider', () => {
  let provider: AzureDevOpsProvider;
  const mockSecrets = {
    get: vi.fn(),
    store: vi.fn(),
    delete: vi.fn(),
    onDidChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AzureDevOpsProvider('org', 'project', 'repo', 'https://dev.azure.com/org', mockSecrets as any);
  });

  afterEach(() => {
    provider.dispose();
  });

  it('has type "azureDevops"', () => {
    expect(provider.type).toBe('azureDevops');
  });

  it('isAuthenticated returns false when no token stored', async () => {
    mockSecrets.get.mockResolvedValue(undefined);
    expect(await provider.isAuthenticated()).toBe(false);
  });

  it('isAuthenticated returns true when token is stored', async () => {
    mockSecrets.get.mockResolvedValue('my-pat-token');
    expect(await provider.isAuthenticated()).toBe(true);
  });

  it('getOpenPRs fetches and maps PRs correctly', async () => {
    mockSecrets.get.mockResolvedValue('my-pat');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [makeAdoPR()], count: 1 }),
    });

    const prs = await provider.getOpenPRs();
    expect(prs).toHaveLength(1);
    expect(prs[0].id).toBe(100);
    expect(prs[0].title).toBe('Add auth flow');
    expect(prs[0].author).toBe('alice@contoso.com');
    expect(prs[0].sourceBranch).toBe('feature/auth');
    expect(prs[0].targetBranch).toBe('main');
    expect(prs[0].labels).toEqual(['enhancement']);
    expect(prs[0].reviewers).toEqual(['bob@contoso.com']);
  });

  it('strips refs/heads/ prefix from branch names', async () => {
    mockSecrets.get.mockResolvedValue('my-pat');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [makeAdoPR({
          sourceRefName: 'refs/heads/users/alice/my-branch',
          targetRefName: 'refs/heads/develop',
        })],
        count: 1,
      }),
    });

    const prs = await provider.getOpenPRs();
    expect(prs[0].sourceBranch).toBe('users/alice/my-branch');
    expect(prs[0].targetBranch).toBe('develop');
  });

  it('getPRBranches returns source branch names', async () => {
    mockSecrets.get.mockResolvedValue('my-pat');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [makeAdoPR(), makeAdoPR({ pullRequestId: 101, sourceRefName: 'refs/heads/fix/bug' })],
        count: 2,
      }),
    });

    const branches = await provider.getPRBranches();
    expect(branches).toEqual(['feature/auth', 'fix/bug']);
  });

  it('getPRMetadata returns metadata for matching branch', async () => {
    mockSecrets.get.mockResolvedValue('my-pat');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [makeAdoPR()], count: 1 }),
    });

    const meta = await provider.getPRMetadata('feature/auth');
    expect(meta).toBeDefined();
    expect(meta!.title).toBe('Add auth flow');
    expect(meta!.author).toBe('alice@contoso.com');
    expect(meta!.labels).toEqual(['enhancement']);
  });

  it('getPRMetadata returns undefined for non-matching branch', async () => {
    mockSecrets.get.mockResolvedValue('my-pat');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [makeAdoPR()], count: 1 }),
    });

    const meta = await provider.getPRMetadata('nonexistent');
    expect(meta).toBeUndefined();
  });

  it('caches PRs within TTL', async () => {
    mockSecrets.get.mockResolvedValue('my-pat');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [makeAdoPR()], count: 1 }),
    });

    await provider.getOpenPRs();
    await provider.getOpenPRs();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles pagination via $top/$skip', async () => {
    mockSecrets.get.mockResolvedValue('my-pat');

    // First page: 100 items (hits page size), second page: 1 item
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeAdoPR({ pullRequestId: i + 1, sourceRefName: `refs/heads/branch-${i}` }),
    );

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: page1, count: 100 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: [makeAdoPR({ pullRequestId: 200 })], count: 1 }),
      });

    const prs = await provider.getOpenPRs();
    expect(prs).toHaveLength(101);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('sends Basic auth header with PAT', async () => {
    mockSecrets.get.mockResolvedValue('my-pat');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [], count: 0 }),
    });

    await provider.getOpenPRs();
    const headers = mockFetch.mock.calls[0][1]?.headers;
    expect(headers.Authorization).toMatch(/^Basic /);
  });

  it('throws on 401 response', async () => {
    mockSecrets.get.mockResolvedValue('bad-pat');
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(provider.getOpenPRs()).rejects.toThrow('Unauthorized');
  });

  it('throws on 203 non-authoritative response', async () => {
    mockSecrets.get.mockResolvedValue('bad-pat');
    mockFetch.mockResolvedValue({
      ok: false,
      status: 203,
      statusText: 'Non-Authoritative Information',
    });

    await expect(provider.getOpenPRs()).rejects.toThrow('Unauthorized');
  });

  it('dispose clears cached data', async () => {
    mockSecrets.get.mockResolvedValue('my-pat');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [makeAdoPR()], count: 1 }),
    });

    await provider.getOpenPRs();
    provider.dispose();

    mockSecrets.get.mockResolvedValue(undefined);
    expect(await provider.isAuthenticated()).toBe(false);
  });
});

describe('createAzureDevOpsProvider', () => {
  it('parses project/_git/repo format', async () => {
    const provider = await createAzureDevOpsProvider({
      type: 'azureDevops',
      owner: 'myorg',
      repo: 'myproject/_git/myrepo',
      apiBase: 'https://dev.azure.com/myorg',
    });
    expect(provider.type).toBe('azureDevops');
    provider.dispose();
  });

  it('parses project/repo format', async () => {
    const provider = await createAzureDevOpsProvider({
      type: 'azureDevops',
      owner: 'myorg',
      repo: 'myproject/myrepo',
      apiBase: 'https://dev.azure.com/myorg',
    });
    expect(provider.type).toBe('azureDevops');
    provider.dispose();
  });

  it('falls back to owner as project', async () => {
    const provider = await createAzureDevOpsProvider({
      type: 'azureDevops',
      owner: 'myorg',
      repo: 'myrepo',
      apiBase: 'https://dev.azure.com/myorg',
    });
    expect(provider.type).toBe('azureDevops');
    provider.dispose();
  });
});
