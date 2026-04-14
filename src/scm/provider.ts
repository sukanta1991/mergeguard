import { execGit } from '../core/gitOps';

// ── Types ────────────────────────────────────────────────

/** Supported SCM platform types. */
export type SCMType = 'github' | 'gitlab' | 'bitbucket' | 'azureDevops' | 'unknown';

/** A Pull / Merge Request. */
export interface PR {
  /** Numeric ID or iid of the PR. */
  id: number;
  /** PR title. */
  title: string;
  /** Author login / username. */
  author: string;
  /** Source branch name. */
  sourceBranch: string;
  /** Target branch name. */
  targetBranch: string;
  /** Web URL to view the PR in a browser. */
  url: string;
  /** Optional labels / tags. */
  labels: string[];
  /** Assigned reviewers (usernames). */
  reviewers: string[];
  /** PR state. */
  state: 'open' | 'closed' | 'merged';
}

/** Metadata about a specific PR linked to a branch. */
export interface PRMetadata {
  title: string;
  author: string;
  url: string;
  labels: string[];
  reviewers: string[];
}

// ── SCMProvider interface ────────────────────────────────

/** Abstract interface that every SCM integration must implement. */
export interface SCMProvider {
  /** The platform type. */
  readonly type: SCMType;

  /** Whether the provider is currently authenticated. */
  isAuthenticated(): Promise<boolean>;

  /** Get all open PRs for the repository. */
  getOpenPRs(): Promise<PR[]>;

  /** Get branch names from open PRs. */
  getPRBranches(): Promise<string[]>;

  /** Get metadata for the PR associated with a given branch. Returns undefined if no PR exists. */
  getPRMetadata(branch: string): Promise<PRMetadata | undefined>;

  /** Dispose resources. */
  dispose(): void;
}

// ── Remote URL detection ─────────────────────────────────

export interface RemoteInfo {
  type: SCMType;
  owner: string;
  repo: string;
  apiBase: string;
}

/**
 * Detect the SCM type from the repo's `origin` remote URL.
 * Supports HTTPS and SSH formats for GitHub, GitLab, Bitbucket, and Azure DevOps.
 */
export async function detectSCMType(gitRoot: string): Promise<RemoteInfo | undefined> {
  const result = await execGit(['remote', 'get-url', 'origin'], gitRoot);
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return undefined;
  }
  return parseRemoteUrl(result.stdout.trim());
}

/** Parse a remote URL and extract SCM type, owner, repo, and API base. */
export function parseRemoteUrl(url: string): RemoteInfo | undefined {
  // HTTPS: https://github.com/owner/repo.git
  // SSH:   git@github.com:owner/repo.git
  let host: string;
  let path: string;

  const httpsMatch = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);

  if (httpsMatch) {
    host = httpsMatch[1];
    path = httpsMatch[2];
  } else if (sshMatch) {
    host = sshMatch[1];
    path = sshMatch[2];
  } else {
    return undefined;
  }

  const parts = path.split('/');
  if (parts.length < 2) return undefined;

  const owner = parts[0];
  const repo = parts[1];

  if (host === 'github.com') {
    return { type: 'github', owner, repo, apiBase: 'https://api.github.com' };
  }
  if (host === 'gitlab.com') {
    return { type: 'gitlab', owner, repo, apiBase: 'https://gitlab.com/api/v4' };
  }
  if (host === 'bitbucket.org') {
    return { type: 'bitbucket', owner, repo, apiBase: 'https://api.bitbucket.org/2.0' };
  }
  if (host.includes('dev.azure.com') || host.includes('visualstudio.com')) {
    return { type: 'azureDevops', owner, repo, apiBase: `https://dev.azure.com/${owner}` };
  }

  // Self-hosted: check for common patterns
  // Assume GitLab for unknown self-hosted (most common self-hosted SCM)
  // GitHub Enterprise uses /api/v3
  return { type: 'unknown', owner, repo, apiBase: `https://${host}` };
}

// ── Factory ──────────────────────────────────────────────

/** Registry of provider constructors. */
const providerRegistry = new Map<SCMType, (info: RemoteInfo) => Promise<SCMProvider>>();

/** Register a provider factory for a given SCM type. */
export function registerSCMProviderFactory(
  type: SCMType,
  factory: (info: RemoteInfo) => Promise<SCMProvider>,
): void {
  providerRegistry.set(type, factory);
}

/**
 * Create an SCM provider for the given remote info.
 * Returns undefined if no provider is registered for the type.
 */
export async function createSCMProvider(info: RemoteInfo): Promise<SCMProvider | undefined> {
  const factory = providerRegistry.get(info.type);
  if (!factory) return undefined;
  return factory(info);
}
