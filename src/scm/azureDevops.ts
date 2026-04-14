import * as vscode from 'vscode';
import type { SCMProvider, PR, PRMetadata, RemoteInfo } from './provider';
import type { SCMType } from './provider';

// ── Azure DevOps REST API response types ─────────────────

interface AzureDevOpsPR {
  pullRequestId: number;
  title: string;
  createdBy: { displayName: string; uniqueName: string };
  sourceRefName: string; // refs/heads/feature/foo
  targetRefName: string; // refs/heads/main
  url: string;
  labels?: Array<{ name: string }>;
  reviewers: Array<{ displayName: string; uniqueName: string }>;
  status: string; // 'active' | 'completed' | 'abandoned'
}

interface AzureDevOpsPRList {
  value: AzureDevOpsPR[];
  count: number;
}

// ── Azure DevOps SCM Provider ────────────────────────────

const SECRET_KEY = 'mergeguard.azureDevops.pat';

export class AzureDevOpsProvider implements SCMProvider {
  readonly type: SCMType = 'azureDevops';
  private token: string | undefined;
  private cachedPRs: PR[] | undefined;
  private cacheTimestamp = 0;
  private readonly cacheTTL = 60_000; // 1 minute

  constructor(
    private readonly org: string,
    private readonly project: string,
    private readonly repoName: string,
    private readonly apiBase: string,
    private readonly secrets?: vscode.SecretStorage,
  ) {}

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return token !== undefined;
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

  /** Prompt user for PAT and store it. */
  async authenticate(): Promise<boolean> {
    const token = await vscode.window.showInputBox({
      prompt: 'Enter your Azure DevOps Personal Access Token (scope: Code Read)',
      password: true,
      placeHolder: 'PAT',
      title: 'MergeGuard: Azure DevOps Authentication',
    });
    if (!token) return false;

    this.token = token;
    if (this.secrets) {
      await this.secrets.store(SECRET_KEY, token);
    }
    return true;
  }

  dispose(): void {
    this.cachedPRs = undefined;
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

  /** Strip refs/heads/ prefix from Azure DevOps ref names. */
  private static refToBranch(refName: string): string {
    return refName.replace(/^refs\/heads\//, '');
  }

  private async fetchAllOpenPRs(): Promise<PR[]> {
    // Azure DevOps uses $top/$skip pagination
    const allPRs: PR[] = [];
    let skip = 0;
    const top = 100;

    for (;;) {
      const result = await this.apiGet<AzureDevOpsPRList>(
        `/${this.project}/_apis/git/repositories/${this.repoName}/pullrequests?searchCriteria.status=active&$top=${top}&$skip=${skip}&api-version=7.1`,
      );
      if (!result || result.value.length === 0) break;

      for (const ado of result.value) {
        const webUrl = `${this.apiBase}/${this.project}/_git/${this.repoName}/pullrequest/${ado.pullRequestId}`;
        allPRs.push({
          id: ado.pullRequestId,
          title: ado.title,
          author: ado.createdBy.uniqueName || ado.createdBy.displayName,
          sourceBranch: AzureDevOpsProvider.refToBranch(ado.sourceRefName),
          targetBranch: AzureDevOpsProvider.refToBranch(ado.targetRefName),
          url: webUrl,
          labels: ado.labels?.map(l => l.name) ?? [],
          reviewers: ado.reviewers.map(r => r.uniqueName || r.displayName),
          state: 'open',
        });
      }

      if (result.value.length < top) break;
      skip += top;
    }

    return allPRs;
  }

  private async apiGet<T>(path: string): Promise<T | undefined> {
    const token = await this.getToken();
    const url = `${this.apiBase}${path}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'MergeGuard-VSCode',
    };
    if (token) {
      headers.Authorization = `Basic ${btoa(`:${token}`)}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 401 || response.status === 203) {
        throw new Error('Azure DevOps API: Unauthorized. Check your Personal Access Token.');
      }
      throw new Error(`Azure DevOps API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}

// ── Factory function ─────────────────────────────────────

/**
 * For Azure DevOps, the RemoteInfo.owner contains the org,
 * and RemoteInfo.repo contains project/repo or just repo.
 * We parse them to extract org, project, and repo name.
 */
export async function createAzureDevOpsProvider(
  info: RemoteInfo,
  secrets?: vscode.SecretStorage,
): Promise<AzureDevOpsProvider> {
  // Azure DevOps URLs: https://dev.azure.com/{org}/{project}/_git/{repo}
  // RemoteInfo: owner = org, repo may be "project/_git/repo" or "project/repo"
  const parts = info.repo.split('/');
  let project: string;
  let repoName: string;

  if (parts.length >= 3 && parts[1] === '_git') {
    // project/_git/repo
    project = parts[0];
    repoName = parts.slice(2).join('/');
  } else if (parts.length >= 2) {
    // project/repo
    project = parts[0];
    repoName = parts.slice(1).join('/');
  } else {
    // fallback: use owner as project, repo as repo name
    project = info.owner;
    repoName = info.repo;
  }

  return new AzureDevOpsProvider(info.owner, project, repoName, info.apiBase, secrets);
}
