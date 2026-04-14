import type { SCMProvider, PRMetadata } from '../scm/provider';
import type { ConflictResult, ScanResult } from './types';

/**
 * PR metadata attached to a ConflictResult after enrichment.
 * Stored outside the core types to avoid tight coupling.
 */
export interface PRConflictInfo {
  /** PR number/id. */
  prId: number;
  /** PR title. */
  title: string;
  /** PR author. */
  author: string;
  /** Web URL to the PR. */
  url: string;
  /** Labels on the PR. */
  labels: string[];
  /** Reviewers assigned. */
  reviewers: string[];
}

/** Map from branch name → PRConflictInfo. Stored alongside scan results. */
export type PRInfoMap = Map<string, PRConflictInfo>;

/**
 * Fetch branch names from open PRs via the SCM provider and return
 * any that aren't already in the tracked list.
 */
export async function getPRBranchesToScan(
  scmProvider: SCMProvider,
  trackedBranches: string[],
): Promise<string[]> {
  try {
    const prBranches = await scmProvider.getPRBranches();
    const tracked = new Set(trackedBranches);
    return prBranches.filter(b => !tracked.has(b));
  } catch {
    return [];
  }
}

/**
 * Enrich scan results with PR metadata from the SCM provider.
 * Returns a map from branch name → PRConflictInfo for any branch
 * that has an associated open PR.
 */
export async function enrichWithPRMetadata(
  scan: ScanResult,
  scmProvider: SCMProvider,
): Promise<PRInfoMap> {
  const prInfoMap: PRInfoMap = new Map();

  try {
    const prs = await scmProvider.getOpenPRs();
    const prByBranch = new Map(prs.map(pr => [pr.sourceBranch, pr]));

    for (const result of scan.results) {
      const pr = prByBranch.get(result.branch);
      if (pr) {
        prInfoMap.set(result.branch, {
          prId: pr.id,
          title: pr.title,
          author: pr.author,
          url: pr.url,
          labels: pr.labels,
          reviewers: pr.reviewers,
        });
      }
    }
  } catch {
    // SCM API failure — return empty map, don't break scan flow
  }

  return prInfoMap;
}

/**
 * Format a short PR description for display in tree view / hover.
 * e.g. "PR #42 'Add auth' by @alice"
 */
export function formatPRDescription(info: PRConflictInfo): string {
  return `PR #${info.prId} '${info.title}' by @${info.author}`;
}
