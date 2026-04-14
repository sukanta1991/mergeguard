import * as vscode from 'vscode';
import type { SCMProvider, PR, PRMetadata, RemoteInfo } from './provider';
import type { SCMType } from './provider';

// ── GitLab REST API response types ───────────────────────

interface GitLabMR {
  iid: number;
  title: string;
  author: { username: string };
  source_branch: string;
  target_branch: string;
  web_url: string;
  labels: string[];
  reviewers: Array<{ username: string }>;
  state: string;
}

// ── GitLab SCM Provider ──────────────────────────────────

const SECRET_KEY = 'mergeguard.gitlab.pat';

export class GitLabProvider implements SCMProvider {
  readonly type: SCMType = 'gitlab';
  private token: string | undefined;
  private cachedMRs: PR[] | undefined;
  private cacheTimestamp = 0;
  private readonly cacheTTL = 60_000; // 1 minute

  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly apiBase: string,
    private readonly secrets?: vscode.SecretStorage,
  ) {}

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return token !== undefined;
  }

  async getOpenPRs(): Promise<PR[]> {
    const now = Date.now();
    if (this.cachedMRs && now - this.cacheTimestamp < this.cacheTTL) {
      return this.cachedMRs;
    }

    const mrs = await this.fetchAllOpenMRs();
    this.cachedMRs = mrs;
    this.cacheTimestamp = now;
    return mrs;
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

  /** Store a PAT in VS Code's SecretStorage. */
  async setToken(token: string): Promise<void> {
    this.token = token;
    if (this.secrets) {
      await this.secrets.store(SECRET_KEY, token);
    }
  }

  dispose(): void {
    this.cachedMRs = undefined;
    this.token = undefined;
  }

  // ── Internal ─────────────────────────────────

  private async getToken(): Promise<string | undefined> {
    if (this.token) return this.token;

    if (this.secrets) {
      const stored = await this.secrets.get(SECRET_KEY);
      if (stored) {
        this.token = stored;
        return stored;
      }
    }

    return undefined;
  }

  /** Prompt user for a PAT and store it. */
  async authenticate(): Promise<boolean> {
    const token = await vscode.window.showInputBox({
      prompt: 'Enter your GitLab Personal Access Token (scope: read_api)',
      password: true,
      placeHolder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
      title: 'MergeGuard: GitLab Authentication',
    });

    if (token) {
      await this.setToken(token);
      return true;
    }
    return false;
  }

  private get projectPath(): string {
    return encodeURIComponent(`${this.owner}/${this.repo}`);
  }

  private async fetchAllOpenMRs(): Promise<PR[]> {
    const allMRs: PR[] = [];
    let page = 1;
    const perPage = 100;

    for (;;) {
      const response = await this.apiGet<GitLabMR[]>(
        `/projects/${this.projectPath}/merge_requests?state=opened&per_page=${perPage}&page=${page}`,
      );

      if (!response) break;
      const { data, nextPage } = response;

      for (const mr of data) {
        allMRs.push({
          id: mr.iid,
          title: mr.title,
          author: mr.author.username,
          sourceBranch: mr.source_branch,
          targetBranch: mr.target_branch,
          url: mr.web_url,
          labels: mr.labels,
          reviewers: mr.reviewers.map(r => r.username),
          state: 'open',
        });
      }

      if (!nextPage) break;
      page = parseInt(nextPage, 10);
    }

    return allMRs;
  }

  private async apiGet<T>(
    path: string,
  ): Promise<{ data: T; nextPage: string | null } | undefined> {
    const token = await this.getToken();
    const url = `${this.apiBase}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'MergeGuard-VSCode',
    };
    if (token) {
      headers['PRIVATE-TOKEN'] = token;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('GitLab API: Unauthorized. Check your Personal Access Token.');
      }
      throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as T;
    const nextPage = response.headers.get('x-next-page');

    return { data, nextPage: nextPage && nextPage !== '' ? nextPage : null };
  }
}

// ── Factory function ─────────────────────────────────────

export async function createGitLabProvider(
  info: RemoteInfo,
  secrets?: vscode.SecretStorage,
): Promise<GitLabProvider> {
  return new GitLabProvider(info.owner, info.repo, info.apiBase, secrets);
}
