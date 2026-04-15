import * as vscode from 'vscode';
import type { BranchInfo } from '../core/types';
import type { BranchMonitor } from '../core/branchMonitor';

/**
 * TreeDataProvider for the "Tracked Branches" sidebar view.
 * Shows which branches are being monitored for conflicts.
 */
export class TrackedBranchesTreeProvider implements vscode.TreeDataProvider<BranchTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private branches: BranchInfo[] = [];

  constructor(private readonly branchMonitor: BranchMonitor) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  updateBranches(branches: BranchInfo[]): void {
    this.branches = branches;
    this.refresh();
  }

  async loadAndRefresh(): Promise<void> {
    try {
      this.branches = await this.branchMonitor.getTrackedBranches();
    } catch {
      this.branches = [];
    }
    this.refresh();
  }

  getTreeItem(element: BranchTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): BranchTreeItem[] {
    return this.branches.map((b) => new BranchTreeItem(b));
  }
}

class BranchTreeItem extends vscode.TreeItem {
  constructor(branch: BranchInfo) {
    super(branch.name, vscode.TreeItemCollapsibleState.None);
    this.description = branch.sha.slice(0, 8);
    this.iconPath = new vscode.ThemeIcon(
      branch.isRemote ? 'cloud' : 'git-branch',
    );
    this.tooltip = `${branch.name} (${branch.sha.slice(0, 8)})${branch.isRemote ? ' — remote' : ''}`;
    this.contextValue = 'trackedBranch';
    this.accessibilityInformation = {
      label: `Tracked branch ${branch.name}, SHA ${branch.sha.slice(0, 8)}`,
    };
  }
}
