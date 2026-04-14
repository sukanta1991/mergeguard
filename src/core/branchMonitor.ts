import * as vscode from 'vscode';
import { execGit } from './gitOps';
import type { BranchInfo } from './types';

/**
 * Monitors git branches and emits events when branches change.
 *
 * Watches `.git/HEAD` and `.git/refs/` for filesystem changes
 * and provides methods to query branch state.
 */
export class BranchMonitor implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private lastKnownBranch: string | null = null;
  private lastKnownSHAs = new Map<string, string>();

  private readonly _onBranchChanged = new vscode.EventEmitter<{
    previous: string | null;
    current: string;
  }>();
  /** Fires when the current HEAD branch changes. */
  readonly onBranchChanged = this._onBranchChanged.event;

  private readonly _onTrackedBranchUpdated = new vscode.EventEmitter<{
    branch: string;
    previousSHA: string;
    currentSHA: string;
  }>();
  /** Fires when a tracked branch ref is updated (new commit pushed, etc.). */
  readonly onTrackedBranchUpdated = this._onTrackedBranchUpdated.event;

  constructor(private readonly gitRoot: string) {
    this.disposables.push(this._onBranchChanged, this._onTrackedBranchUpdated);
  }

  /**
   * Start watching for branch changes.
   * Sets up FileSystemWatchers on `.git/HEAD` and `.git/refs/`.
   */
  startWatching(): void {
    const rootUri = vscode.Uri.file(this.gitRoot);

    // Watch .git/HEAD for branch switches
    const headPattern = new vscode.RelativePattern(rootUri, '.git/HEAD');
    const headWatcher = vscode.workspace.createFileSystemWatcher(headPattern);
    headWatcher.onDidChange(() => this.checkBranchChange());
    this.disposables.push(headWatcher);

    // Watch .git/refs/ for ref updates (new commits, branch creation/deletion)
    const refsPattern = new vscode.RelativePattern(rootUri, '.git/refs/**');
    const refsWatcher = vscode.workspace.createFileSystemWatcher(refsPattern);
    refsWatcher.onDidChange(() => this.checkTrackedBranchUpdates());
    refsWatcher.onDidCreate(() => this.checkTrackedBranchUpdates());
    refsWatcher.onDidDelete(() => this.checkTrackedBranchUpdates());
    this.disposables.push(refsWatcher);
  }

  /**
   * Get the name of the currently checked-out branch.
   * Returns 'HEAD' if in detached HEAD state.
   */
  async getCurrentBranch(): Promise<string> {
    const result = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], this.gitRoot);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to get current branch: ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  }

  /**
   * Get the SHA of the current HEAD commit.
   */
  async getCurrentSHA(): Promise<string> {
    const result = await execGit(['rev-parse', 'HEAD'], this.gitRoot);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to get current SHA: ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  }

  /**
   * List all local branches with their SHAs.
   */
  async listLocalBranches(): Promise<BranchInfo[]> {
    const result = await execGit(
      ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/'],
      this.gitRoot,
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list local branches: ${result.stderr.trim()}`);
    }
    return parseBranchList(result.stdout, false);
  }

  /**
   * List all remote-tracking branches with their SHAs.
   */
  async listRemoteBranches(): Promise<BranchInfo[]> {
    const result = await execGit(
      ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/remotes/'],
      this.gitRoot,
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list remote branches: ${result.stderr.trim()}`);
    }
    return parseBranchList(result.stdout, true);
  }

  /**
   * Get the tracked branches from user configuration, resolved against
   * actual branches in the repository. Returns only branches that exist.
   */
  async getTrackedBranches(): Promise<BranchInfo[]> {
    const config = vscode.workspace.getConfiguration('mergeguard');
    const configured = config.get<string[]>('trackedBranches', ['main', 'master', 'develop']);

    const [localBranches, remoteBranches] = await Promise.all([
      this.listLocalBranches(),
      this.listRemoteBranches(),
    ]);

    const allBranches = [...localBranches, ...remoteBranches];
    const tracked: BranchInfo[] = [];

    for (const name of configured) {
      // Try exact match first, then try as remote (origin/<name>)
      const match =
        allBranches.find((b) => b.name === name) ||
        allBranches.find((b) => b.name === `origin/${name}`);

      if (match) {
        tracked.push({ ...match, isTracked: true });
      }
    }

    return tracked;
  }

  /**
   * Resolve a branch name to its SHA.
   * Returns null if the branch does not exist.
   */
  async getBranchSHA(branchName: string): Promise<string | null> {
    const result = await execGit(['rev-parse', '--verify', branchName], this.gitRoot);
    if (result.exitCode !== 0) {
      return null;
    }
    return result.stdout.trim();
  }

  /**
   * Snapshot current tracked branch state for later comparison.
   */
  async snapshotTrackedBranches(): Promise<void> {
    this.lastKnownBranch = await this.getCurrentBranch();
    const tracked = await this.getTrackedBranches();
    this.lastKnownSHAs.clear();
    for (const branch of tracked) {
      this.lastKnownSHAs.set(branch.name, branch.sha);
    }
  }

  private async checkBranchChange(): Promise<void> {
    try {
      const current = await this.getCurrentBranch();
      if (this.lastKnownBranch !== null && current !== this.lastKnownBranch) {
        this._onBranchChanged.fire({ previous: this.lastKnownBranch, current });
      }
      this.lastKnownBranch = current;
    } catch {
      // Ignore errors during transient git states (rebase, merge in progress)
    }
  }

  private async checkTrackedBranchUpdates(): Promise<void> {
    try {
      const tracked = await this.getTrackedBranches();
      for (const branch of tracked) {
        const previousSHA = this.lastKnownSHAs.get(branch.name);
        if (previousSHA && previousSHA !== branch.sha) {
          this._onTrackedBranchUpdated.fire({
            branch: branch.name,
            previousSHA,
            currentSHA: branch.sha,
          });
        }
        this.lastKnownSHAs.set(branch.name, branch.sha);
      }
    } catch {
      // Ignore errors during transient git states
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}

/**
 * Parse the output of `git for-each-ref --format='%(refname:short) %(objectname)'`
 * into BranchInfo objects.
 */
function parseBranchList(output: string, isRemote: boolean): BranchInfo[] {
  const branches: BranchInfo[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) continue;
    const name = trimmed.substring(0, spaceIdx);
    const sha = trimmed.substring(spaceIdx + 1);
    // Skip HEAD pointer entries like "origin/HEAD"
    if (name.endsWith('/HEAD')) continue;
    branches.push({ name, sha, isRemote, isTracked: false });
  }
  return branches;
}

// Export for testing
export { parseBranchList };
