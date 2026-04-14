import type { SCMProvider, PR } from '../scm/provider';
import { execGit } from './gitOps';

/**
 * Info about a teammate's branch that touches the same file.
 */
export interface TeammateActivity {
  /** The teammate's username. */
  author: string;
  /** Branch name of the teammate. */
  branch: string;
  /** Files modified by this branch (relative paths). */
  modifiedFiles: string[];
  /** Optional PR URL if there's an open PR. */
  prUrl?: string;
}

/**
 * File-centric team activity: which teammates are also modifying a given file.
 */
export interface FileTeamActivity {
  /** Relative file path. */
  filePath: string;
  /** Teammates with branches that modify this file. */
  teammates: Array<{
    author: string;
    branch: string;
    prUrl?: string;
  }>;
}

/**
 * Get team activity by analyzing open PRs from the SCM provider.
 * Returns branches grouped by author with the files they modify.
 *
 * @param scmProvider - SCM provider to fetch open PRs
 * @param gitRoot - Git root directory
 * @param currentBranch - Current branch to exclude from results
 */
export async function getTeamActivity(
  scmProvider: SCMProvider,
  gitRoot: string,
  currentBranch: string,
): Promise<TeammateActivity[]> {
  let prs: PR[];
  try {
    prs = await scmProvider.getOpenPRs();
  } catch {
    return [];
  }

  // Exclude PRs from the current branch
  const otherPRs = prs.filter(pr => pr.sourceBranch !== currentBranch);
  const activities: TeammateActivity[] = [];

  for (const pr of otherPRs) {
    const files = await getChangedFilesForBranch(pr.sourceBranch, pr.targetBranch, gitRoot);
    if (files.length > 0) {
      activities.push({
        author: pr.author,
        branch: pr.sourceBranch,
        modifiedFiles: files,
        prUrl: pr.url,
      });
    }
  }

  return activities;
}

/**
 * Build a file-centric view of team activity.
 * For each file, lists which teammates are also modifying it.
 */
export function buildFileTeamActivity(activities: TeammateActivity[]): FileTeamActivity[] {
  const fileMap = new Map<string, FileTeamActivity>();

  for (const activity of activities) {
    for (const filePath of activity.modifiedFiles) {
      let entry = fileMap.get(filePath);
      if (!entry) {
        entry = { filePath, teammates: [] };
        fileMap.set(filePath, entry);
      }
      entry.teammates.push({
        author: activity.author,
        branch: activity.branch,
        prUrl: activity.prUrl,
      });
    }
  }

  return Array.from(fileMap.values());
}

/**
 * Format team activity for display.
 * e.g. "Also modified by @alice (feature/auth), @bob (fix/login)"
 */
export function formatTeamActivity(activity: FileTeamActivity): string {
  if (activity.teammates.length === 0) return '';
  const names = activity.teammates.map(t => `@${t.author} (${t.branch})`);
  return `Also modified by ${names.join(', ')}`;
}

/**
 * Get files changed on a source branch relative to a target branch.
 */
async function getChangedFilesForBranch(
  sourceBranch: string,
  targetBranch: string,
  gitRoot: string,
): Promise<string[]> {
  try {
    // Find merge-base
    const baseResult = await execGit(['merge-base', targetBranch, sourceBranch], gitRoot);
    if (baseResult.exitCode !== 0) return [];

    const mergeBase = baseResult.stdout.trim();
    if (!mergeBase) return [];

    // List changed files
    const diffResult = await execGit(
      ['diff', '--name-only', mergeBase, sourceBranch],
      gitRoot,
    );
    if (diffResult.exitCode !== 0) return [];

    return diffResult.stdout
      .trim()
      .split('\n')
      .filter(line => line.length > 0);
  } catch {
    return [];
  }
}
