import * as vscode from 'vscode';
import {
  getMergedFileContent,
  getFileAtRef,
  getThreeWayContent,
  getMergeBase,
} from '../core/conflictContent';

// ── URI scheme ───────────────────────────────────────────
export const SCHEME = 'mergeguard';

/**
 * Encode preview parameters into a mergeguard: URI.
 *
 * Format: mergeguard:/preview/<filePath>?branch=<branch>&ref=<ref>&gitRoot=<root>&type=<merged|base|theirs>
 */
export function buildPreviewUri(opts: {
  filePath: string;
  branch: string;
  currentRef: string;
  gitRoot: string;
  type: 'merged' | 'base' | 'theirs' | 'ours';
}): vscode.Uri {
  const query = [
    `branch=${encodeURIComponent(opts.branch)}`,
    `ref=${encodeURIComponent(opts.currentRef)}`,
    `gitRoot=${encodeURIComponent(opts.gitRoot)}`,
    `type=${opts.type}`,
  ].join('&');

  return vscode.Uri.parse(`${SCHEME}:/preview/${opts.filePath}?${query}`);
}

/** Parse a mergeguard: URI back into its components. */
function parsePreviewUri(uri: vscode.Uri): {
  filePath: string;
  branch: string;
  currentRef: string;
  gitRoot: string;
  type: 'merged' | 'base' | 'theirs' | 'ours';
} | null {
  if (uri.scheme !== SCHEME) return null;

  const filePath = uri.path.replace(/^\/preview\//, '');
  const params = new URLSearchParams(uri.query);

  const branch = params.get('branch');
  const currentRef = params.get('ref');
  const gitRoot = params.get('gitRoot');
  const type = params.get('type') as 'merged' | 'base' | 'theirs' | 'ours';

  if (!branch || !currentRef || !gitRoot || !type) return null;

  return { filePath, branch, currentRef, gitRoot, type };
}

/**
 * TextDocumentContentProvider for mergeguard: URIs.
 * Provides virtual document content for diff previews.
 */
export class ConflictPreviewProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const parsed = parsePreviewUri(uri);
    if (!parsed) return '// Failed to parse preview URI';

    const { filePath, branch, currentRef, gitRoot, type } = parsed;

    switch (type) {
      case 'merged': {
        const content = await getMergedFileContent(currentRef, branch, filePath, gitRoot);
        return content ?? `// Could not retrieve merged content for ${filePath}`;
      }
      case 'base': {
        const baseRef = await getMergeBase(currentRef, branch, gitRoot);
        if (!baseRef) return `// No merge-base found between ${currentRef} and ${branch}`;
        const content = await getFileAtRef(baseRef, filePath, gitRoot);
        return content ?? `// File does not exist at merge-base`;
      }
      case 'ours': {
        const content = await getFileAtRef(currentRef, filePath, gitRoot);
        return content ?? `// File does not exist on ${currentRef}`;
      }
      case 'theirs': {
        const content = await getFileAtRef(branch, filePath, gitRoot);
        return content ?? `// File does not exist on ${branch}`;
      }
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

/**
 * Open a diff view: current file (ours) vs merged-with-conflicts.
 */
export async function openConflictPreview(
  filePath: string,
  branch: string,
  currentRef: string,
  gitRoot: string,
): Promise<void> {
  const leftUri = vscode.Uri.file(`${gitRoot}/${filePath}`);
  const rightUri = buildPreviewUri({
    filePath,
    branch,
    currentRef,
    gitRoot,
    type: 'merged',
  });

  const title = `${filePath} ↔ merge with ${branch}`;
  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
}

/**
 * Open a three-way diff for a conflicted file.
 * Opens two side-by-side diffs:
 *   Tab 1: base ↔ ours (current branch changes)
 *   Tab 2: base ↔ theirs (target branch changes)
 */
export async function openThreeWayDiff(
  filePath: string,
  branch: string,
  currentRef: string,
  gitRoot: string,
): Promise<void> {
  const baseUri = buildPreviewUri({ filePath, branch, currentRef, gitRoot, type: 'base' });
  const oursUri = buildPreviewUri({ filePath, branch, currentRef, gitRoot, type: 'ours' });
  const theirsUri = buildPreviewUri({ filePath, branch, currentRef, gitRoot, type: 'theirs' });

  // Tab 1: base ↔ ours
  await vscode.commands.executeCommand(
    'vscode.diff',
    baseUri,
    oursUri,
    `${filePath}: base ↔ ${currentRef} (ours)`,
  );

  // Tab 2: base ↔ theirs
  await vscode.commands.executeCommand(
    'vscode.diff',
    baseUri,
    theirsUri,
    `${filePath}: base ↔ ${branch} (theirs)`,
  );
}
