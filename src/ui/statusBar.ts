import * as vscode from 'vscode';
import { RiskLevel } from '../core/types';
import type { ScanResult } from '../core/types';

/** Possible display states for the status bar item. */
export type StatusBarState = 'ready' | 'scanning' | 'clean' | 'conflict' | 'error' | 'disabled';

/**
 * Manages the MergeGuard status bar item.
 * Displays the current conflict state and risk level with appropriate icons and colors.
 */
export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private state: StatusBarState = 'ready';

  constructor(private readonly focusCommand = 'mergeguard.conflictsView.focus') {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.name = 'Merge Guard';
    this.item.command = focusCommand;
    this.item.accessibilityInformation = { label: 'Merge Guard conflict status', role: 'button' };
    this.setReady();
    this.item.show();
  }

  /** Show the "Ready" idle state. */
  setReady(): void {
    this.state = 'ready';
    this.item.text = `$(git-merge) ${vscode.l10n.t('MergeGuard: Ready')}`;
    this.item.tooltip = vscode.l10n.t('MergeGuard — Click to open conflict panel');
    this.item.backgroundColor = undefined;
    this.item.accessibilityInformation = { label: 'Merge Guard: Ready. Click to open conflict panel.', role: 'button' };
  }

  /** Show the spinning scan indicator. */
  setScanning(): void {
    this.state = 'scanning';
    this.item.text = `$(sync~spin) ${vscode.l10n.t('MergeGuard: Scanning...')}`;
    this.item.tooltip = vscode.l10n.t('MergeGuard — Scanning for conflicts...');
    this.item.backgroundColor = undefined;
    this.item.accessibilityInformation = { label: 'Merge Guard: Scanning for conflicts.', role: 'button' };
  }

  /** Show the "no conflicts" clean state. */
  setClean(): void {
    this.state = 'clean';
    this.item.text = `$(check) ${vscode.l10n.t('MergeGuard: No conflicts')}`;
    this.item.tooltip = vscode.l10n.t('MergeGuard — No merge conflicts detected');
    this.item.backgroundColor = undefined;
    this.item.accessibilityInformation = { label: 'Merge Guard: No merge conflicts detected.', role: 'button' };
  }

  /** Show the error state. */
  setError(message?: string): void {
    this.state = 'error';
    this.item.text = `$(alert) ${vscode.l10n.t('MergeGuard: Error')}`;
    this.item.tooltip = `MergeGuard — ${message ?? vscode.l10n.t('An error occurred during scanning')}`;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.item.accessibilityInformation = { label: `Merge Guard: Error. ${message ?? 'An error occurred during scanning'}.`, role: 'button' };
  }

  /** Show the disabled state. */
  setDisabled(): void {
    this.state = 'disabled';
    this.item.text = `$(circle-slash) ${vscode.l10n.t('MergeGuard: Off')}`;
    this.item.tooltip = vscode.l10n.t('MergeGuard — Auto-scan is disabled. Click to open panel.');
    this.item.backgroundColor = undefined;
    this.item.accessibilityInformation = { label: 'Merge Guard: Auto-scan is disabled. Click to open panel.', role: 'button' };
  }

  /**
   * Update the status bar from a completed scan result.
   */
  updateFromScan(scan: ScanResult): void {
    if (scan.totalConflictFiles === 0) {
      this.setClean();
      return;
    }

    this.state = 'conflict';
    const n = scan.totalConflictFiles;
    const fileWord = n === 1 ? 'conflict' : 'conflicts';

    switch (scan.overallRiskLevel) {
      case RiskLevel.High:
        this.item.text = `$(error) MergeGuard: ${n} ${fileWord}`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
      case RiskLevel.Medium:
        this.item.text = `$(warning) MergeGuard: ${n} ${fileWord}`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        break;
      default:
        this.item.text = `$(warning) MergeGuard: ${n} ${fileWord}`;
        this.item.backgroundColor = undefined;
        break;
    }

    // Build tooltip summary per branch
    const lines = scan.results
      .filter((r) => r.files.length > 0)
      .map((r) => {
        const c = r.files.length;
        return `${c} file${c === 1 ? '' : 's'} conflict with ${r.branch}`;
      });

    this.item.tooltip = lines.length > 0
      ? `MergeGuard — ${lines.join(', ')}`
      : `MergeGuard — ${n} conflict${n === 1 ? '' : 's'} detected`;

    this.item.accessibilityInformation = {
      label: `Merge Guard: ${n} conflict${n === 1 ? '' : 's'} detected, risk level ${scan.overallRiskLevel}. Click to open panel.`,
      role: 'button',
    };
  }

  /** Get the current display state (useful for testing). */
  getState(): StatusBarState {
    return this.state;
  }

  /** Get the raw text content (useful for testing). */
  getText(): string {
    return this.item.text;
  }

  /** Get the tooltip (useful for testing). */
  getTooltip(): string | vscode.MarkdownString | undefined {
    return this.item.tooltip;
  }

  dispose(): void {
    this.item.dispose();
  }
}
