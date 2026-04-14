import type { ScanResult, ConflictResult } from './types';

/** A recommended merge step with explanation. */
export interface MergeStep {
  /** Branch to merge. */
  branch: string;
  /** Number of conflict files when merging this branch. */
  conflictFiles: number;
  /** Risk score of this branch. */
  riskScore: number;
  /** Human-readable explanation of why to merge at this position. */
  reason: string;
}

/** Full merge order suggestion. */
export interface MergeOrderSuggestion {
  /** Ordered list of merge steps. */
  steps: MergeStep[];
  /** Summary text for display. */
  summary: string;
}

/**
 * Suggest an optimal merge order that minimizes cascading conflicts.
 *
 * Strategy:
 *  1. Build a conflict graph: nodes = branches, edges = shared conflict files.
 *  2. Sort branches with fewer conflicts first (greedy heuristic).
 *  3. Branches with no conflicts go first — they're free merges.
 *  4. Among branches with conflicts, prefer those sharing the fewest files
 *     with remaining branches (reduces cascading risk).
 */
export function suggestMergeOrder(scan: ScanResult): MergeOrderSuggestion {
  const results = scan.results.filter((r) => r.status !== 'error');

  if (results.length === 0) {
    return { steps: [], summary: 'No branches to merge.' };
  }

  // Build conflict graph adjacency: branch → set of conflicted file paths
  const branchFiles = new Map<string, Set<string>>();
  for (const r of results) {
    branchFiles.set(r.branch, new Set(r.files.map((f) => f.path)));
  }

  // Build overlap matrix: how many files each pair of branches share
  const overlapCount = (a: string, b: string): number => {
    const filesA = branchFiles.get(a);
    const filesB = branchFiles.get(b);
    if (!filesA || !filesB) return 0;
    let count = 0;
    for (const f of filesA) {
      if (filesB.has(f)) count++;
    }
    return count;
  };

  // Greedy ordering
  const remaining = new Set(results.map((r) => r.branch));
  const resultMap = new Map(results.map((r) => [r.branch, r]));
  const steps: MergeStep[] = [];

  while (remaining.size > 0) {
    let best: string | undefined;
    let bestScore = Infinity;

    for (const branch of remaining) {
      const r = resultMap.get(branch)!;
      const fileCount = r.files.length;

      // Calculate cascade potential: total overlapping files with remaining branches
      let cascadePotential = 0;
      for (const other of remaining) {
        if (other !== branch) {
          cascadePotential += overlapCount(branch, other);
        }
      }

      // Score = conflictFiles * 10 + cascadePotential * 5 + riskScore * 0.1
      // Lower is better — prefer branches with fewer conflicts and less cascade risk
      const score = fileCount * 10 + cascadePotential * 5 + r.riskScore * 0.1;

      if (score < bestScore) {
        bestScore = score;
        best = branch;
      }
    }

    if (!best) break;

    const r = resultMap.get(best)!;
    remaining.delete(best);

    const reason = buildStepReason(r, remaining, overlapCount);
    steps.push({
      branch: best,
      conflictFiles: r.files.length,
      riskScore: r.riskScore,
      reason,
    });
  }

  const summary = buildSummary(steps);
  return { steps, summary };
}

function buildStepReason(
  result: ConflictResult,
  remaining: Set<string>,
  overlapCount: (a: string, b: string) => number,
): string {
  if (result.files.length === 0) {
    return 'No conflicts — safe to merge first.';
  }

  const overlaps: string[] = [];
  for (const other of remaining) {
    const count = overlapCount(result.branch, other);
    if (count > 0) {
      overlaps.push(`${count} shared file(s) with ${other}`);
    }
  }

  if (overlaps.length === 0) {
    return `${result.files.length} conflict(s), no overlap with remaining branches.`;
  }

  return `${result.files.length} conflict(s); ${overlaps.join(', ')}.`;
}

function buildSummary(steps: MergeStep[]): string {
  if (steps.length === 0) return 'No branches to merge.';

  const parts = steps.map((s, i) => {
    const pos = i + 1;
    const conflicts = s.conflictFiles === 0 ? 'no conflicts' : `${s.conflictFiles} conflict(s)`;
    return `${pos}. Merge \`${s.branch}\` (${conflicts})`;
  });

  return parts.join('\n');
}
