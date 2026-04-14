import { spawn } from 'node:child_process';
import * as vscode from 'vscode';

/** Result of running a git command. */
export interface GitExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Callback invoked for each line of streaming output. */
export type StreamLineCallback = (line: string) => void;

/** Default timeout for git operations (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Execute a git command and return the result.
 *
 * @param args - Git arguments (e.g. ['status', '--porcelain'])
 * @param cwd - Working directory for the git command
 * @param timeoutMs - Optional timeout in ms (default: 30s)
 */
export function execGit(
  args: string[],
  cwd: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<GitExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('Git is not installed or not found in PATH.'));
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code ?? 1,
      });
    });
  });
}

/**
 * Execute a git command with streaming line-by-line output parsing.
 * Useful for commands that produce large output (e.g. `git log`, large diffs).
 *
 * Lines are delivered to `onLine` as they arrive, without buffering the entire output.
 * The returned promise resolves with the exit code once the process completes.
 *
 * @param args - Git arguments
 * @param cwd - Working directory
 * @param onLine - Callback invoked for each complete line of stdout
 * @param timeoutMs - Optional timeout in ms (default: 30s)
 * @returns Exit code and any stderr output
 */
export function execGitStreaming(
  args: string[],
  cwd: string,
  onLine: StreamLineCallback,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    const stderrChunks: Buffer[] = [];
    let remainder = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = remainder + chunk.toString('utf-8');
      const lines = text.split('\n');
      // Last element is either '' (if chunk ended with \n) or a partial line
      remainder = lines.pop() ?? '';
      for (const line of lines) {
        onLine(line);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('Git is not installed or not found in PATH.'));
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      // Flush any remaining partial line
      if (remainder.length > 0) {
        onLine(remainder);
        remainder = '';
      }
      resolve({
        exitCode: code ?? 1,
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });
  });
}

/**
 * Get the installed git version string.
 * Returns null if git is not available.
 */
export async function getGitVersion(cwd: string): Promise<string | null> {
  try {
    const result = await execGit(['--version'], cwd);
    if (result.exitCode !== 0) {
      return null;
    }
    // "git version 2.43.0" → "2.43.0"
    const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Check whether the installed git version supports `merge-tree --write-tree` (requires >= 2.38).
 */
export async function checkMergeTreeSupport(cwd: string): Promise<boolean> {
  const version = await getGitVersion(cwd);
  if (!version) {
    return false;
  }
  return compareVersions(version, '2.38.0') >= 0;
}

/**
 * Find all git repository roots in the current workspace.
 * Handles multi-root workspaces by checking each workspace folder.
 */
export async function findGitRoots(): Promise<string[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return [];
  }

  const roots: string[] = [];

  for (const folder of workspaceFolders) {
    const cwd = folder.uri.fsPath;
    try {
      const result = await execGit(['rev-parse', '--show-toplevel'], cwd);
      if (result.exitCode === 0) {
        const root = result.stdout.trim();
        if (root && !roots.includes(root)) {
          roots.push(root);
        }
      }
    } catch {
      // Not a git repo — skip
    }
  }

  return roots;
}

/**
 * Compare two semver version strings.
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}
