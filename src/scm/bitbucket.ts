import * as vscode from 'vscode';
import type { SCMProvider, PR, PRMetadata, RemoteInfo } from './provider';
import type { SCMType } from './provider';

// ── Bitbucket REST API response types ────────────────────

interface BitbucketPR {
  id: number;
  title: string;
  author: { display_name: string; nickname: string };
  source: { branch: { name: string } };
  destination: { branch: { name: string } };
  links: { html: { href: string } };
  reviewers: Array<{ display_name: string; nickname: string }>;
  state: string;
}

interface BitbucketPRPage {
  values: BitbucketPR[];
  next?: string;
}

// ── Bitbucket SCM Provider ───────────────────────────────

const SECRET_KEY = 'mergeguard.bitbucket.appPassword';

export class BitbucketProvider implements SCMProvider {
  readonly type: SCMType = 'bitbucket';
  private credentials: { username: string; password: string } | undefined;
  private cachedPRs: PR[] | undefined;
  private cacheTimestamp = 0;
  private readonly cacheTTL = 60_000; // 1 minute

  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly apiBase: string,
    private readonly secrets?: vscode.SecretStorage,
  ) {}

  async isAuthenticated(): Promise<boolean> {
    const creds = await this.getCredentials();
    return creds !== undefined;
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

  /** Prompt user for Bitbucket App Password and store it. */
  async authenticate(): Promise<boolean> {
    const username = await vscode.window.showInputBox({
      prompt: 'Enter your Bitbucket username',
      placeHolder: 'username',
      title: 'MergeGuard: Bitbucket Authentication (1/2)',
    });
    if (!username) return false;

    const password = await vscode.window.showInputBox({
      prompt: 'Enter your Bitbucket App Password (scope: pullrequest:read)',
      password: true,
      placeHolder: 'app-password',
      title: 'MergeGuard: Bitbucket Authentication (2/2)',
    });
    if (!password) return false;

    this.credentials = { username, password };
    if (this.secrets) {
      await this.secrets.store(SECRET_KEY, JSON.stringify({ username, password }));
    }
    return true;
  }

  dispose(): void {
    this.cachedPRs = undefined;
    this.credentials = undefined;
  }

  // ── Internal ─────────────────────────────────

  private async getCredentials(): Promise<{ username: string; password: string } | undefined> {
    if (this.credentials) return this.credentials;

    if (this.secrets) {
      const stored = await this.secrets.get(SECRET_KEY);
      if (stored) {
        try {
          this.credentials = JSON.parse(stored);
          return this.credentials;
        } catch {
          // Corrupted data, ignore
        }
      }
    }
    return undefined;
  }

  private async fetchAllOpenPRs(): Promise<PR[]> {
    const allPRs: PR[] = [];
    let url: string | undefined =
      `${this.apiBase}/repositories/${this.owner}/${this.repo}/pullrequests?state=OPEN&pagelen=50`;

    while (url) {
      const page: BitbucketPRPage | undefined = await this.apiGet<BitbucketPRPage>(url);
      if (!page) break;

      for (const bb of page.values) {
        allPRs.push({
          id: bb.id,
          title: bb.title,
          author: bb.author.nickname || bb.author.display_name,
          sourceBranch: bb.source.branch.name,
          targetBranch: bb.destination.branch.name,
          url: bb.links.html.href,
          labels: [],
          reviewers: bb.reviewers.map((r: BitbucketPR['reviewers'][number]) => r.nickname || r.display_name),
          state: 'open',
        });
      }

      url = page.next;
    }

    return allPRs;
  }

  private async apiGet<T>(url: string): Promise<T | undefined> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'MergeGuard-VSCode',
    };

    const creds = await this.getCredentials();
    if (creds) {
      headers.Authorization = `Basic ${btoa(`${creds.username}:${creds.password}`)}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Bitbucket API: Unauthorized. Check your App Password.');
      }
      throw new Error(`Bitbucket API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}

// ── Factory function ─────────────────────────────────────

export async function createBitbucketProvider(
  info: RemoteInfo,
  secrets?: vscode.SecretStorage,
): Promise<BitbucketProvider> {
  return new BitbucketProvider(info.owner, info.repo, info.apiBase, secrets);
}
