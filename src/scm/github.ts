import * as vscode from 'vscode';
import type { SCMProvider, PR, PRMetadata, RemoteInfo } from './provider';
import type { SCMType } from './provider';

// ── GitHub REST API response types ───────────────────────

interface GitHubPR {
  number: number;
  title: string;
  user: { login: string };
  head: { ref: string };
  base: { ref: string };
  html_url: string;
  labels: Array<{ name: string }>;
  requested_reviewers: Array<{ login: string }>;
  state: string;
}

// ── GitHub SCM Provider ──────────────────────────────────

export class GitHubProvider implements SCMProvider {
  readonly type: SCMType = 'github';
  private token: string | undefined;
  private cachedPRs: PR[] | undefined;
  private cacheTimestamp = 0;
  private readonly cacheTTL = 60_000; // 1 minute

  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly apiBase: string,
  ) {}

  async isAuthenticated(): Promise<boolean> {
    try {
      const token = await this.getToken();
      return token !== undefined;
    } catch {
      return false;
    }
  }

  async getOpenPRs(): Promise<PR[]> {
    const now = Date.now();
    if (this.cachedPRs && now - this.cacheTimestamp < this.cacheTTL) {
      return this.cachedPRs;
    }

    const prs = await this.fetchAllOpenPRs();
    this.cachedPRs = prs;
    this.cacheTimestamp = now;
    return prs;
  }

  async getPRBranches(): Promise<string[]> {
    const prs = await this.getOpenPRs();
    return prs.map(pr => pr.sourceBranch);
  }

  async getPRMetadata(branch: string): Promise<PRMetadata | undefined> {
    const prs = await this.getOpenPRs();
    const pr = prs.find(p => p.sourceBranch === branch);
    if (!pr) return undefined;
    return {
      title: pr.title,
      author: pr.author,
      url: pr.url,
      labels: pr.labels,
      reviewers: pr.reviewers,
    };
  }

  dispose(): void {
    this.cachedPRs = undefined;
    this.token = undefined;
  }

  // ── Internal ─────────────────────────────────

  private async getToken(): Promise<string | undefined> {
    if (this.token) return this.token;

    try {
      const session = await vscode.authentication.getSession('github', ['repo'], {
        createIfNone: false,
      });
      if (session) {
        this.token = session.accessToken;
        return this.token;
      }
    } catch {
      // Auth not available
    }
    return undefined;
  }

  /** Request a new session (with user prompt). */
  async authenticate(): Promise<boolean> {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], {
        createIfNone: true,
      });
      if (session) {
        this.token = session.accessToken;
        return true;
      }
    } catch {
      // User cancelled or auth failed
    }
    return false;
  }

  private async fetchAllOpenPRs(): Promise<PR[]> {
    const allPRs: PR[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const ghPRs = await this.apiGet<GitHubPR[]>(
        `/repos/${this.owner}/${this.repo}/pulls?state=open&per_page=${perPage}&page=${page}`,
      );

      if (!ghPRs || ghPRs.length === 0) break;

      for (const gh of ghPRs) {
        allPRs.push({
          id: gh.number,
          title: gh.title,
          author: gh.user.login,
          sourceBranch: gh.head.ref,
          targetBranch: gh.base.ref,
          url: gh.html_url,
          labels: gh.labels.map(l => l.name),
          reviewers: gh.requested_reviewers.map(r => r.login),
          state: 'open',
        });
      }

      if (ghPRs.length < perPage) break;
      page++;
    }

    return allPRs;
  }

  private async apiGet<T>(path: string): Promise<T | undefined> {
    const token = await this.getToken();
    const url = `${this.apiBase}${path}`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'MergeGuard-VSCode',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });

    if (response.status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        const resetTime = response.headers.get('x-ratelimit-reset');
        const resetDate = resetTime ? new Date(parseInt(resetTime, 10) * 1000) : undefined;
        throw new Error(
          `GitHub API rate limit exceeded. Resets at ${resetDate?.toLocaleTimeString() ?? 'unknown'}.`,
        );
      }
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}

// ── Factory function ─────────────────────────────────────

export async function createGitHubProvider(info: RemoteInfo): Promise<GitHubProvider> {
  return new GitHubProvider(info.owner, info.repo, info.apiBase);
}
