import { execGit, checkMergeTreeSupport } from './gitOps';
import { ConflictFile, ConflictResult, ConflictType, LineRange, RiskLevel } from './types';

/**
 * Analyze merge conflicts between the current branch and a target branch
 * using `git merge-tree --write-tree`.
 *
 * @param currentRef - The current branch name or SHA
 * @param targetRef - The target branch name or SHA to merge against
 * @param cwd - Git repository working directory
 * @returns ConflictResult with conflict details (riskScore set to 0 — scored later by riskScorer)
 */
export async function analyzeConflicts(
  currentRef: string,
  targetRef: string,
  cwd: string,
): Promise<ConflictResult> {
  const [currentSHA, targetSHA] = await resolveRefs(currentRef, targetRef, cwd);

  const hasMergeTree = await checkMergeTreeSupport(cwd);

  if (hasMergeTree) {
    return runMergeTreeAnalysis(currentRef, targetRef, currentSHA, targetSHA, cwd);
  }

  return runFallbackAnalysis(currentRef, targetRef, currentSHA, targetSHA, cwd);
}

/**
 * Analyze conflicts against multiple target branches.
 * Uses sequential analysis (batch --stdin mode is unreliable across git versions).
 */
export async function analyzeMultipleBranches(
  currentRef: string,
  targets: string[],
  cwd: string,
): Promise<ConflictResult[]> {
  const results: ConflictResult[] = [];
  for (const target of targets) {
    try {
      results.push(await analyzeConflicts(currentRef, target, cwd));
    } catch (err) {
      const [currentSHA, targetSHA] = await resolveRefs(currentRef, target, cwd).catch(() => [
        'unknown',
        'unknown',
      ]);
      results.push({
        branch: target,
        currentSHA,
        targetSHA,
        files: [],
        riskScore: 0,
        riskLevel: RiskLevel.None,
        timestamp: Date.now(),
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/**
 * Pre-screen whether two branches could possibly conflict by checking
 * if they modified any of the same files relative to their merge-base.
 * Returns the set of overlapping file paths, or null if no overlap.
 */
export async function preScreenConflicts(
  currentRef: string,
  targetRef: string,
  cwd: string,
): Promise<string[] | null> {
  const mergeBase = await getMergeBase(currentRef, targetRef, cwd);
  if (!mergeBase) return null;

  const [currentFiles, targetFiles] = await Promise.all([
    getChangedFiles(mergeBase, currentRef, cwd),
    getChangedFiles(mergeBase, targetRef, cwd),
  ]);

  const targetSet = new Set(targetFiles);
  const overlap = currentFiles.filter((f) => targetSet.has(f));

  return overlap.length > 0 ? overlap : null;
}

// ──────────────────────────────────────────────────────────
// Merge-tree analysis (git >= 2.38)
// ──────────────────────────────────────────────────────────

async function runMergeTreeAnalysis(
  currentRef: string,
  targetRef: string,
  currentSHA: string,
  targetSHA: string,
  cwd: string,
): Promise<ConflictResult> {
  const result = await execGit(['merge-tree', '--write-tree', currentRef, targetRef], cwd);

  // Exit code 0 = clean merge, 1 = conflicts, other = error
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return {
      branch: targetRef,
      currentSHA,
      targetSHA,
      files: [],
      riskScore: 0,
      riskLevel: RiskLevel.None,
      timestamp: Date.now(),
      status: 'error',
      errorMessage: `merge-tree failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
    };
  }

  const hasConflicts = result.exitCode === 1;

  if (!hasConflicts) {
    return {
      branch: targetRef,
      currentSHA,
      targetSHA,
      files: [],
      riskScore: 0,
      riskLevel: RiskLevel.None,
      timestamp: Date.now(),
      status: 'success',
    };
  }

  const files = parseMergeTreeOutput(result.stdout);

  // Extract line ranges from conflict markers for content conflicts
  await extractLineRanges(files, cwd);

  return {
    branch: targetRef,
    currentSHA,
    targetSHA,
    files,
    riskScore: 0, // Will be calculated by riskScorer
    riskLevel: RiskLevel.None,
    timestamp: Date.now(),
    status: 'success',
  };
}

// ──────────────────────────────────────────────────────────
// Fallback analysis (git < 2.38)
// ──────────────────────────────────────────────────────────

async function runFallbackAnalysis(
  currentRef: string,
  targetRef: string,
  currentSHA: string,
  targetSHA: string,
  cwd: string,
): Promise<ConflictResult> {
  const overlap = await preScreenConflicts(currentRef, targetRef, cwd);

  if (!overlap) {
    return {
      branch: targetRef,
      currentSHA,
      targetSHA,
      files: [],
      riskScore: 0,
      riskLevel: RiskLevel.None,
      timestamp: Date.now(),
      status: 'fallback',
    };
  }

  // In fallback mode we can only report which files overlap — no line-level detail
  const files: ConflictFile[] = overlap.map((path) => ({
    path,
    conflictType: ConflictType.Content,
    lineRanges: [],
  }));

  return {
    branch: targetRef,
    currentSHA,
    targetSHA,
    files,
    riskScore: 0,
    riskLevel: RiskLevel.None,
    timestamp: Date.now(),
    status: 'fallback',
  };
}

// ──────────────────────────────────────────────────────────
// merge-tree output parsing
// ──────────────────────────────────────────────────────────

/**
 * Parse the output of `git merge-tree --write-tree` when conflicts exist.
 *
 * The output format (after the tree OID line) contains an "informational messages"
 * section separated by a NUL byte or blank line, and a "conflicted file info" section.
 *
 * Example output with conflicts:
 * ```
 * <tree-oid>
 * <blank line>
 * CONFLICT (content): Merge conflict in file.txt
 * CONFLICT (modify/delete): file2.txt deleted in target and modified in current.
 * <blank line>
 * <mode> <oid> <stage>\tpath
 * ```
 */
export function parseMergeTreeOutput(output: string): ConflictFile[] {
  const files: ConflictFile[] = [];
  const lines = output.split('\n');

  // Collect informational CONFLICT messages and staged file entries
  const conflictMessages: string[] = [];
  const stageEntries: Array<{ mode: string; oid: string; stage: number; path: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // CONFLICT messages
    if (trimmed.startsWith('CONFLICT')) {
      conflictMessages.push(trimmed);
      continue;
    }

    // Stage entries: "<mode> <oid> <stage>\t<path>"
    const stageMatch = trimmed.match(/^(\d{6})\s+([0-9a-f]{40})\s+(\d)\t(.+)$/);
    if (stageMatch) {
      stageEntries.push({
        mode: stageMatch[1],
        oid: stageMatch[2],
        stage: parseInt(stageMatch[3], 10),
        path: stageMatch[4],
      });
    }
  }

  // Group stage entries by path
  const pathStages = new Map<
    string,
    { ancestor?: { mode: string; oid: string }; ours?: { mode: string; oid: string }; theirs?: { mode: string; oid: string } }
  >();

  for (const entry of stageEntries) {
    if (!pathStages.has(entry.path)) {
      pathStages.set(entry.path, {});
    }
    const stages = pathStages.get(entry.path)!;
    const ref = { mode: entry.mode, oid: entry.oid };
    if (entry.stage === 1) stages.ancestor = ref;
    else if (entry.stage === 2) stages.ours = ref;
    else if (entry.stage === 3) stages.theirs = ref;
  }

  // Build conflict files from CONFLICT messages
  for (const msg of conflictMessages) {
    const parsed = parseConflictMessage(msg);
    if (parsed) {
      const file: ConflictFile = {
        path: parsed.path,
        conflictType: parsed.type,
        lineRanges: [],
        stages: pathStages.get(parsed.path),
      };
      files.push(file);
    }
  }

  // Also add any staged files not covered by CONFLICT messages
  for (const [path, stages] of pathStages) {
    if (!files.some((f) => f.path === path)) {
      files.push({
        path,
        conflictType: inferConflictType(stages),
        lineRanges: [],
        stages,
      });
    }
  }

  return files;
}

/**
 * Parse a single CONFLICT message line to extract path and type.
 *
 * Examples:
 *   "CONFLICT (content): Merge conflict in file.txt"
 *   "CONFLICT (modify/delete): file.txt deleted in HEAD and modified in branch."
 *   "CONFLICT (rename/rename): Rename file.txt->file2.txt in branch1. Rename file.txt->file3.txt in branch2."
 *   "CONFLICT (file/directory): ..."
 *   "CONFLICT (add/add): Merge conflict in newfile.txt"
 *   "CONFLICT (binary): Merge conflict in image.png"
 */
export function parseConflictMessage(
  msg: string,
): { path: string; type: ConflictType } | null {
  // Extract the conflict type descriptor: "CONFLICT (content):" or "CONFLICT (modify/delete):"
  const typeMatch = msg.match(/^CONFLICT\s*\(([^)]+)\):/);
  if (!typeMatch) return null;

  const descriptor = typeMatch[1].toLowerCase();
  const afterColon = msg.substring(msg.indexOf(':') + 1).trim();

  // Map descriptor to ConflictType
  const type = descriptorToConflictType(descriptor);

  // Extract the file path from the message
  const path = extractPathFromMessage(afterColon, descriptor);
  if (!path) return null;

  return { path, type };
}

function descriptorToConflictType(descriptor: string): ConflictType {
  if (descriptor === 'content' || descriptor === 'add/add') return ConflictType.Content;
  if (descriptor.includes('rename')) return ConflictType.Rename;
  if (descriptor.includes('delete')) return ConflictType.Delete;
  if (descriptor === 'binary') return ConflictType.Binary;
  if (descriptor.includes('directory') || descriptor === 'file/directory')
    return ConflictType.Directory;
  if (descriptor.includes('mode')) return ConflictType.ModeChange;
  return ConflictType.Content; // Default
}

function extractPathFromMessage(afterColon: string, descriptor: string): string | null {
  // "Merge conflict in <path>"
  const mergeConflictMatch = afterColon.match(/Merge conflict in (.+?)\.?$/);
  if (mergeConflictMatch) return mergeConflictMatch[1].trim();

  // "modify/delete": "<path> deleted in ..."
  if (descriptor.includes('delete')) {
    const deleteMatch = afterColon.match(/^(\S+)\s+deleted/);
    if (deleteMatch) return deleteMatch[1];
  }

  // "rename/rename" or "rename/delete": various patterns
  if (descriptor.includes('rename')) {
    // "Rename <old>-><new> in ..."
    const renameMatch = afterColon.match(/Rename\s+\S+->(\S+)\s+in/);
    if (renameMatch) return renameMatch[1];
    // Or just the first file mentioned
    const firstFile = afterColon.match(/(\S+)/);
    if (firstFile) return firstFile[1];
  }

  // Fallback: first word that looks like a file path
  const fallback = afterColon.match(/(\S+\.\S+)/);
  if (fallback) return fallback[1];

  // Last resort: first non-empty word
  const word = afterColon.match(/(\S+)/);
  return word?.[1] ?? null;
}

function inferConflictType(stages: {
  ancestor?: { mode: string; oid: string };
  ours?: { mode: string; oid: string };
  theirs?: { mode: string; oid: string };
}): ConflictType {
  if (!stages.ours && stages.theirs) return ConflictType.Delete;
  if (stages.ours && !stages.theirs) return ConflictType.Delete;
  if (stages.ours && stages.theirs && stages.ours.mode !== stages.theirs.mode)
    return ConflictType.ModeChange;
  return ConflictType.Content;
}

// ──────────────────────────────────────────────────────────
// Line range extraction (M1.3)
// ──────────────────────────────────────────────────────────

/**
 * For content-type conflicts that have stage entries, extract the merged
 * file content (with conflict markers) and parse line ranges.
 */
async function extractLineRanges(files: ConflictFile[], cwd: string): Promise<void> {
  for (const file of files) {
    if (file.conflictType !== ConflictType.Content) continue;

    // We need the OID of the "ours" side to locate merged content with markers.
    // merge-tree --write-tree merges into a tree — the stage 2 (ours) OID
    // points to our version, stage 3 to theirs. For the actual merged content
    // with conflict markers, we use the tree OID from the first line of output
    // combined with the path. But since we don't have the tree OID here,
    // we'll look for the conflicted blob by checking if the ours OID exists.
    const oursOid = file.stages?.ours?.oid;
    const theirsOid = file.stages?.theirs?.oid;

    if (!oursOid || !theirsOid) continue;

    // Try to get content with conflict markers by merging the blobs directly
    const ancestorOid = file.stages?.ancestor?.oid;
    const ranges = await extractConflictMarkerRanges(ancestorOid, oursOid, theirsOid, cwd);
    if (ranges.length > 0) {
      file.lineRanges = ranges;
    }
  }
}

/**
 * Use `git merge-file` on blob contents to produce conflict markers,
 * then parse the markers to extract line ranges.
 */
async function extractConflictMarkerRanges(
  ancestorOid: string | undefined,
  oursOid: string,
  theirsOid: string,
  cwd: string,
): Promise<LineRange[]> {
  try {
    // Get the content of both sides
    const [oursContent, theirsContent, ancestorContent] = await Promise.all([
      catFile(oursOid, cwd),
      catFile(theirsOid, cwd),
      ancestorOid ? catFile(ancestorOid, cwd) : Promise.resolve(''),
    ]);

    // If we can't read the blobs, skip line ranges
    if (oursContent === null || theirsContent === null) return [];

    // Parse where the two versions differ to estimate conflict line ranges
    // For accuracy, we look at the "ours" content and find regions that differ
    return estimateConflictRanges(oursContent, theirsContent, ancestorContent ?? '');
  } catch {
    return [];
  }
}

/**
 * Estimate conflict line ranges by comparing ours vs theirs content.
 * Identifies contiguous regions where the files differ.
 */
function estimateConflictRanges(
  ours: string,
  theirs: string,
  _ancestor: string,
): LineRange[] {
  const oursLines = ours.split('\n');
  const theirsLines = theirs.split('\n');
  const ranges: LineRange[] = [];

  let inDiff = false;
  let diffStart = 0;
  const maxLen = Math.max(oursLines.length, theirsLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oursLine = oursLines[i] ?? '';
    const theirsLine = theirsLines[i] ?? '';
    const differs = oursLine !== theirsLine;

    if (differs && !inDiff) {
      inDiff = true;
      diffStart = i + 1; // 1-based
    } else if (!differs && inDiff) {
      inDiff = false;
      ranges.push({ startLine: diffStart, endLine: i }); // i is 1-based since diffStart was i+1
    }
  }

  if (inDiff) {
    ranges.push({ startLine: diffStart, endLine: maxLen });
  }

  return ranges;
}

/**
 * Parse conflict markers from text content and extract line ranges.
 * Handles standard 7-character conflict markers.
 */
export function parseConflictMarkers(content: string): LineRange[] {
  const lines = content.split('\n');
  const ranges: LineRange[] = [];
  let conflictStart: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('<<<<<<<')) {
      conflictStart = i + 1; // 1-based
    } else if (line.startsWith('>>>>>>>') && conflictStart !== null) {
      ranges.push({ startLine: conflictStart, endLine: i + 1 }); // 1-based inclusive
      conflictStart = null;
    }
  }

  return ranges;
}

// ──────────────────────────────────────────────────────────
// Git helpers
// ──────────────────────────────────────────────────────────

async function resolveRefs(
  currentRef: string,
  targetRef: string,
  cwd: string,
): Promise<[string, string]> {
  const [currentResult, targetResult] = await Promise.all([
    execGit(['rev-parse', '--verify', currentRef], cwd),
    execGit(['rev-parse', '--verify', targetRef], cwd),
  ]);

  if (currentResult.exitCode !== 0) {
    throw new Error(`Cannot resolve ref '${currentRef}': ${currentResult.stderr.trim()}`);
  }
  if (targetResult.exitCode !== 0) {
    throw new Error(`Cannot resolve ref '${targetRef}': ${targetResult.stderr.trim()}`);
  }

  return [currentResult.stdout.trim(), targetResult.stdout.trim()];
}

async function getMergeBase(ref1: string, ref2: string, cwd: string): Promise<string | null> {
  const result = await execGit(['merge-base', ref1, ref2], cwd);
  if (result.exitCode !== 0) return null;
  return result.stdout.trim();
}

async function getChangedFiles(
  baseRef: string,
  headRef: string,
  cwd: string,
): Promise<string[]> {
  const result = await execGit(['diff', '--name-only', baseRef, headRef], cwd);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

async function catFile(oid: string, cwd: string): Promise<string | null> {
  const result = await execGit(['cat-file', '-p', oid], cwd);
  if (result.exitCode !== 0) return null;
  return result.stdout;
}
