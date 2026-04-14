import * as vscode from 'vscode';
import { ConflictType } from '../core/types';
import type { DecorationController } from './decorations';

/**
 * Describes a conflict type in human-readable terms for the hover tooltip.
 */
function conflictDescription(type: ConflictType): string {
  switch (type) {
    case ConflictType.Content:
      return 'Content conflict — both branches modified this region';
    case ConflictType.Rename:
      return 'Rename conflict — file was renamed differently on each branch';
    case ConflictType.Delete:
      return 'Delete conflict — file was modified on one branch and deleted on the other';
    case ConflictType.Binary:
      return 'Binary conflict — binary file was modified on both branches';
    case ConflictType.Directory:
      return 'Directory/file conflict — path is a directory on one branch and a file on the other';
    case ConflictType.ModeChange:
      return 'Mode change conflict — file permissions changed differently on each branch';
  }
}

/**
 * HoverProvider that shows conflict details when hovering over decorated conflict regions.
 */
export class ConflictHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly decorationController: DecorationController,
    private readonly gitRoot: string,
  ) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const relativePath = this.toRelativePath(document.uri.fsPath);
    if (!relativePath) return undefined;

    const infos = this.decorationController.getConflictsForFile(relativePath);
    if (infos.length === 0) return undefined;

    // Find infos whose line ranges cover the hovered position
    const matchingInfos = infos.filter((info) =>
      info.file.lineRanges.some(
        (lr) => position.line >= lr.startLine - 1 && position.line <= lr.endLine - 1,
      ),
    );

    // If no line-range match but conflict has no ranges (whole-file conflict), show for the whole file
    const relevantInfos =
      matchingInfos.length > 0
        ? matchingInfos
        : infos.filter((i) => i.file.lineRanges.length === 0);

    if (relevantInfos.length === 0) return undefined;

    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportThemeIcons = true;

    for (let i = 0; i < relevantInfos.length; i++) {
      const info = relevantInfos[i];
      if (i > 0) md.appendMarkdown('\n\n---\n\n');

      md.appendMarkdown(`$(warning) **Potential merge conflict with \`${info.branch}\`**\n\n`);
      md.appendMarkdown(`${conflictDescription(info.file.conflictType)}\n\n`);

      // Line range detail
      const ranges = info.file.lineRanges.filter(
        (lr) => position.line >= lr.startLine - 1 && position.line <= lr.endLine - 1,
      );
      if (ranges.length > 0) {
        const r = ranges[0];
        md.appendMarkdown(`Lines ${r.startLine}–${r.endLine} affected\n\n`);
      }

      // Action links

      md.appendMarkdown(
        `[$(diff) Preview Conflict](command:mergeguard.previewConflict?${encodeURIComponent(JSON.stringify([info.file.path, info.branch]))} "Open diff preview")`,
      );
      md.appendMarkdown('&nbsp;&nbsp;');
      md.appendMarkdown(
        `[$(diff-multiple) Three-Way Diff](command:mergeguard.threeWayDiff?${encodeURIComponent(JSON.stringify([info.file.path, info.branch]))} "Open three-way diff")`,
      );
    }

    return new vscode.Hover(md);
  }

  private toRelativePath(absPath: string): string | undefined {
    if (!this.gitRoot) return undefined;
    const prefix = this.gitRoot.endsWith('/') ? this.gitRoot : this.gitRoot + '/';
    if (absPath.startsWith(prefix)) {
      return absPath.slice(prefix.length);
    }
    return undefined;
  }
}

// Export for testing
export { conflictDescription };
