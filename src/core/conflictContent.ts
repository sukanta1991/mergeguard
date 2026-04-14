import { execGit } from './gitOps';

/**
 * Get the content of a file from a specific git reference (branch, SHA, etc.).
 *
 * @param ref - Git reference (branch name, SHA, tag)
 * @param filePath - Relative path to the file within the repo
 * @param cwd - Git repository root
 * @returns File content as a string, or null if the file doesn't exist at that ref
 */
export async function getFileAtRef(
  ref: string,
  filePath: string,
  cwd: string,
): Promise<string | null> {
  const result = await execGit(['show', `${ref}:${filePath}`], cwd);
  if (result.exitCode !== 0) return null;
  return result.stdout;
}

/**
 * Get the content of a git object by its OID.
 *
 * @param oid - The git object ID (SHA)
 * @param cwd - Git repository root
 * @returns Content of the object, or null on failure
 */
export async function catFile(oid: string, cwd: string): Promise<string | null> {
  const result = await execGit(['cat-file', '-p', oid], cwd);
  if (result.exitCode !== 0) return null;
  return result.stdout;
}

/**
 * Get the merge-base between two refs.
 *
 * @param ref1 - First reference
 * @param ref2 - Second reference
 * @param cwd - Git repository root
 * @returns The merge-base SHA, or null if none found
 */
export async function getMergeBase(
  ref1: string,
  ref2: string,
  cwd: string,
): Promise<string | null> {
  const result = await execGit(['merge-base', ref1, ref2], cwd);
  if (result.exitCode !== 0) return null;
  return result.stdout.trim();
}

/**
 * Get the merged file content with conflict markers by performing a merge-tree
 * and extracting the blob at the given path from the resulting tree.
 *
 * If the merge-tree reports conflicts, the file content will contain
 * standard conflict markers (<<<<<<< / ======= / >>>>>>>).
 *
 * @param currentRef - Current branch/ref
 * @param targetRef - Target branch/ref
 * @param filePath - Relative file path
 * @param cwd - Git repository root
 * @returns Merged content with conflict markers, or null on failure
 */
export async function getMergedFileContent(
  currentRef: string,
  targetRef: string,
  filePath: string,
  cwd: string,
): Promise<string | null> {
  // Run merge-tree to get the resulting tree OID
  const mtResult = await execGit(
    ['merge-tree', '--write-tree', '-z', currentRef, targetRef],
    cwd,
  );

  // The first line of output is the tree OID (before NUL or newline)
  const treeOid = (mtResult.stdout.split('\0')[0] ?? mtResult.stdout.split('\n')[0]).trim();
  if (!treeOid || !/^[0-9a-f]{40}$/.test(treeOid)) {
    return null;
  }

  // Use ls-tree to find the blob OID for the file in the merged tree
  const lsResult = await execGit(['ls-tree', '-r', treeOid, '--', filePath], cwd);
  if (lsResult.exitCode !== 0 || !lsResult.stdout.trim()) return null;

  // Parse: "<mode> blob <oid>\t<path>"
  const match = lsResult.stdout.trim().match(/^\d+\s+blob\s+([0-9a-f]{40})\t/);
  if (!match) return null;

  return catFile(match[1], cwd);
}

/** Three-way diff content for a conflicted file. */
export interface ThreeWayContent {
  /** Content at the merge-base (common ancestor). */
  base: string | null;
  /** Content on the current branch ("ours"). */
  ours: string | null;
  /** Content on the target branch ("theirs"). */
  theirs: string | null;
}

/**
 * Extract three-way diff content for a file:
 *  - base: content at merge-base of currentRef and targetRef
 *  - ours: content at currentRef
 *  - theirs: content at targetRef
 *
 * @param currentRef - Current branch/ref
 * @param targetRef - Target branch/ref
 * @param filePath - Relative file path
 * @param cwd - Git repository root
 */
export async function getThreeWayContent(
  currentRef: string,
  targetRef: string,
  filePath: string,
  cwd: string,
): Promise<ThreeWayContent> {
  const baseRef = await getMergeBase(currentRef, targetRef, cwd);

  const [base, ours, theirs] = await Promise.all([
    baseRef ? getFileAtRef(baseRef, filePath, cwd) : Promise.resolve(null),
    getFileAtRef(currentRef, filePath, cwd),
    getFileAtRef(targetRef, filePath, cwd),
  ]);

  return { base, ours, theirs };
}
