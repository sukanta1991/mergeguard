import * as vscode from 'vscode';
import type { ScanResult } from '../core/types';
import { RiskLevel } from '../core/types';

const STATE_KEY = 'mergeguard.seenConflicts';
const DISMISSED_KEY = 'mergeguard.dismissedBranches';

/** Notification level configuration. */
export type NotificationLevel = 'all' | 'high' | 'badge' | 'silent';

/** A fingerprint representing a unique conflict (branch + file). */
interface ConflictFingerprint {
  branch: string;
  file: string;
}

/**
 * Tracks previously seen conflicts and only notifies for NEW ones.
 *
 * Supports configurable notification levels:
 *  - `all`    — toast for every new conflict
 *  - `high`   — toast only for high-risk new conflicts
 *  - `badge`  — update badge only, no toast
 *  - `silent` — no notifications at all
 */
export class NotificationManager implements vscode.Disposable {
  private seenFingerprints: Set<string>;
  private dismissedBranches: Set<string>;
  private newConflictCount = 0;

  constructor(private readonly workspaceState: vscode.Memento) {
    this.seenFingerprints = new Set(
      workspaceState.get<string[]>(STATE_KEY, []),
    );
    this.dismissedBranches = new Set(
      workspaceState.get<string[]>(DISMISSED_KEY, []),
    );
  }

  /**
   * Process a new scan result — detect new conflicts and notify accordingly.
   * Returns the number of new conflicts detected.
   */
  async processScan(scan: ScanResult): Promise<number> {
    const config = vscode.workspace.getConfiguration('mergeguard');
    const level = config.get<NotificationLevel>('notificationLevel', 'all');

    if (level === 'silent') {
      this.updateSeen(scan);
      return 0;
    }

    const newConflicts = this.detectNewConflicts(scan);
    this.newConflictCount = newConflicts.length;

    if (newConflicts.length > 0 && level !== 'badge') {
      await this.showNotifications(newConflicts, scan, level);
    }

    this.updateSeen(scan);
    return newConflicts.length;
  }

  /** Get the count of new conflicts from the last scan. */
  getNewConflictCount(): number {
    return this.newConflictCount;
  }

  /** Dismiss all notifications for a branch. */
  async dismissBranch(branch: string): Promise<void> {
    this.dismissedBranches.add(branch);
    await this.workspaceState.update(DISMISSED_KEY, [...this.dismissedBranches]);
  }

  /** Check if a branch has been dismissed. */
  isDismissed(branch: string): boolean {
    return this.dismissedBranches.has(branch);
  }

  /** Clear all dismissed branches. */
  async clearDismissed(): Promise<void> {
    this.dismissedBranches.clear();
    await this.workspaceState.update(DISMISSED_KEY, []);
  }

  /** Reset all seen state (useful for testing or user reset). */
  async reset(): Promise<void> {
    this.seenFingerprints.clear();
    this.dismissedBranches.clear();
    this.newConflictCount = 0;
    await this.workspaceState.update(STATE_KEY, []);
    await this.workspaceState.update(DISMISSED_KEY, []);
  }

  // ── Internal ─────────────────────────────────

  private detectNewConflicts(
    scan: ScanResult,
  ): Array<ConflictFingerprint & { riskLevel: RiskLevel }> {
    const newOnes: Array<ConflictFingerprint & { riskLevel: RiskLevel }> = [];

    for (const result of scan.results) {
      if (result.status === 'error') continue;
      if (this.dismissedBranches.has(result.branch)) continue;

      for (const file of result.files) {
        const fp = fingerprint(result.branch, file.path);
        if (!this.seenFingerprints.has(fp)) {
          newOnes.push({ branch: result.branch, file: file.path, riskLevel: result.riskLevel });
        }
      }
    }

    return newOnes;
  }

  private async showNotifications(
    newConflicts: Array<ConflictFingerprint & { riskLevel: RiskLevel }>,
    scan: ScanResult,
    level: NotificationLevel,
  ): Promise<void> {
    // Group by branch
    const byBranch = new Map<string, string[]>();
    for (const c of newConflicts) {
      // In 'high' mode, only show high-risk conflicts
      if (level === 'high' && c.riskLevel !== RiskLevel.High) continue;

      const files = byBranch.get(c.branch) ?? [];
      files.push(c.file);
      byBranch.set(c.branch, files);
    }

    for (const [branch, files] of byBranch) {
      const fileList = files.length <= 3
        ? files.join(', ')
        : `${files.slice(0, 3).join(', ')} and ${files.length - 3} more`;

      const message = vscode.l10n.t('New conflict detected: `{0}` conflicts on {1}', branch, fileList);

      const action = await vscode.window.showWarningMessage(
        message,
        vscode.l10n.t('Show'),
        vscode.l10n.t("Don't show for this branch"),
      );

      if (action === 'Show') {
        await vscode.commands.executeCommand('mergeguard.previewConflict', files[0], branch);
      } else if (action === "Don't show for this branch") {
        await this.dismissBranch(branch);
      }
    }
  }

  private updateSeen(scan: ScanResult): void {
    // Rebuild seen set to only contain current conflicts
    // (so resolved conflicts are "forgotten" and re-detected if they return)
    this.seenFingerprints.clear();
    for (const result of scan.results) {
      if (result.status === 'error') continue;
      for (const file of result.files) {
        this.seenFingerprints.add(fingerprint(result.branch, file.path));
      }
    }
    void this.workspaceState.update(STATE_KEY, [...this.seenFingerprints]);
  }

  dispose(): void {
    // No resources to release
  }
}

function fingerprint(branch: string, filePath: string): string {
  return `${branch}::${filePath}`;
}
