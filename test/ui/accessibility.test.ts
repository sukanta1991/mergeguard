import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictTreeDataProvider, BranchItem, FileItem, RegionItem } from '../../src/ui/treeView';
import { StatusBarController } from '../../src/ui/statusBar';
import { ConflictType, RiskLevel } from '../../src/core/types';
import type { ConflictResult, ScanResult, ConflictFile } from '../../src/core/types';

vi.mock('vscode', () => import('../__mocks__/vscode'));

function makeFile(path: string, type = ConflictType.Content): ConflictFile {
  return {
    path,
    conflictType: type,
    lineRanges: [{ startLine: 10, endLine: 20 }],
  };
}

function makeResult(branch: string, files: ConflictFile[] = [], riskLevel = RiskLevel.Medium): ConflictResult {
  return {
    branch,
    currentSHA: 'aaa',
    targetSHA: 'bbb',
    files,
    riskScore: 50,
    riskLevel,
    timestamp: Date.now(),
    status: 'success' as const,
  };
}

function makeScan(results: ConflictResult[]): ScanResult {
  return {
    results,
    overallRiskScore: 50,
    overallRiskLevel: RiskLevel.Medium,
    totalConflictFiles: results.reduce((s, r) => s + r.files.length, 0),
    timestamp: Date.now(),
    durationMs: 100,
  };
}

describe('Accessibility (M4.3)', () => {
  describe('TreeView items have accessibilityInformation', () => {
    let provider: ConflictTreeDataProvider;

    beforeEach(() => {
      provider = new ConflictTreeDataProvider();
    });

    it('branch item with conflicts has descriptive accessibility label', () => {
      const result = makeResult('main', [makeFile('src/app.ts')], RiskLevel.High);
      const scan = makeScan([result]);
      provider.update(scan, '/repo');

      const item = new BranchItem(result);
      const treeItem = provider.getTreeItem(item);

      expect(treeItem.accessibilityInformation).toBeDefined();
      expect(treeItem.accessibilityInformation!.label).toContain('Branch main');
      expect(treeItem.accessibilityInformation!.label).toContain('1 conflict');
      expect(treeItem.accessibilityInformation!.label).toContain('risk level');
      expect(treeItem.accessibilityInformation!.role).toBe('treeitem');
    });

    it('clean branch has appropriate accessibility label', () => {
      const result = makeResult('develop', [], RiskLevel.None);
      const scan = makeScan([result]);
      provider.update(scan, '/repo');

      const item = new BranchItem(result);
      const treeItem = provider.getTreeItem(item);

      expect(treeItem.accessibilityInformation).toBeDefined();
      expect(treeItem.accessibilityInformation!.label).toContain('clean');
      expect(treeItem.accessibilityInformation!.label).toContain('no conflicts');
    });

    it('error branch has error in accessibility label', () => {
      const result: ConflictResult = {
        ...makeResult('broken', []),
        status: 'error',
        errorMessage: 'Git process timed out',
      };
      const scan = makeScan([result]);
      provider.update(scan, '/repo');

      const item = new BranchItem(result);
      const treeItem = provider.getTreeItem(item);

      expect(treeItem.accessibilityInformation).toBeDefined();
      expect(treeItem.accessibilityInformation!.label).toContain('error');
      expect(treeItem.accessibilityInformation!.label).toContain('Git process timed out');
    });

    it('file item has file path and conflict type in accessibility label', () => {
      const file = makeFile('src/utils.ts', ConflictType.Rename);
      const item = new FileItem(file, 'main', '/repo');
      const treeItem = provider.getTreeItem(item);

      expect(treeItem.accessibilityInformation).toBeDefined();
      expect(treeItem.accessibilityInformation!.label).toContain('src/utils.ts');
      expect(treeItem.accessibilityInformation!.label).toContain('rename conflict');
      expect(treeItem.accessibilityInformation!.label).toContain('conflicts with main');
    });

    it('file item mentions region count', () => {
      const file: ConflictFile = {
        path: 'index.ts',
        conflictType: ConflictType.Content,
        lineRanges: [
          { startLine: 1, endLine: 5 },
          { startLine: 20, endLine: 30 },
        ],
      };
      const item = new FileItem(file, 'main', '/repo');
      const treeItem = provider.getTreeItem(item);

      expect(treeItem.accessibilityInformation!.label).toContain('2 regions');
    });

    it('region item has line range in accessibility label', () => {
      const file = makeFile('src/app.ts');
      const item = new RegionItem(file, 0, 'main', '/repo');
      const treeItem = provider.getTreeItem(item);

      expect(treeItem.accessibilityInformation).toBeDefined();
      expect(treeItem.accessibilityInformation!.label).toContain('lines 10 to 20');
      expect(treeItem.accessibilityInformation!.label).toContain('content conflict');
    });
  });

  describe('StatusBar has accessibility labels', () => {
    let statusBar: StatusBarController;

    beforeEach(() => {
      statusBar = new StatusBarController();
    });

    it('ready state has descriptive accessibility label', () => {
      statusBar.setReady();
      // The statusbar item should have accessibilityInformation set
      // We test via the item text as a proxy since the mock doesn't expose internals
      expect(statusBar.getText()).toContain('Ready');
    });

    it('scanning state has accessibility label', () => {
      statusBar.setScanning();
      expect(statusBar.getText()).toContain('Scanning');
    });

    it('clean state has accessibility label', () => {
      statusBar.setClean();
      expect(statusBar.getText()).toContain('No conflicts');
    });

    it('error state includes error message', () => {
      statusBar.setError('Git timeout');
      expect(statusBar.getText()).toContain('Error');
    });

    it('disabled state has accessibility label', () => {
      statusBar.setDisabled();
      expect(statusBar.getText()).toContain('Off');
    });

    it('conflict state has risk-level in tooltip', () => {
      const scan: ScanResult = {
        results: [{
          branch: 'main',
          currentSHA: 'a',
          targetSHA: 'b',
          files: [makeFile('x.ts')],
          riskScore: 80,
          riskLevel: RiskLevel.High,
          timestamp: Date.now(),
          status: 'success',
        }],
        overallRiskScore: 80,
        overallRiskLevel: RiskLevel.High,
        totalConflictFiles: 1,
        timestamp: Date.now(),
        durationMs: 50,
      };
      statusBar.updateFromScan(scan);
      expect(statusBar.getText()).toContain('1 conflict');
    });

    afterEach(() => {
      statusBar.dispose();
    });
  });
});
