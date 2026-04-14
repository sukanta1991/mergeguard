import { describe, it, expect, beforeEach } from 'vitest';
import { StatusBarController } from '../../src/ui/statusBar';
import { RiskLevel } from '../../src/core/types';
import type { ScanResult, ConflictResult } from '../../src/core/types';
import { ConflictType } from '../../src/core/types';

function makeConflictResult(
  branch: string,
  fileCount: number,
  status: 'success' | 'error' | 'fallback' = 'success',
): ConflictResult {
  return {
    branch,
    currentSHA: 'aaa',
    targetSHA: 'bbb',
    files: Array.from({ length: fileCount }, (_, i) => ({
      path: `file${i}.ts`,
      conflictType: ConflictType.Content,
      lineRanges: [],
      stages: {},
    })),
    riskScore: 0,
    riskLevel: RiskLevel.None,
    timestamp: Date.now(),
    status,
  };
}

function makeScan(
  results: ConflictResult[],
  overallLevel: RiskLevel = RiskLevel.None,
): ScanResult {
  const totalConflictFiles = results.reduce((sum, r) => sum + r.files.length, 0);
  return {
    results,
    overallRiskScore: 0,
    overallRiskLevel: overallLevel,
    totalConflictFiles,
    timestamp: Date.now(),
    durationMs: 100,
  };
}

describe('StatusBarController', () => {
  let controller: StatusBarController;

  beforeEach(() => {
    controller = new StatusBarController();
  });

  // ── Initial state ──────────────────────────────

  it('starts in "ready" state', () => {
    expect(controller.getState()).toBe('ready');
    expect(controller.getText()).toContain('Ready');
  });

  // ── State transitions ─────────────────────────

  it('setScanning shows spinning icon', () => {
    controller.setScanning();
    expect(controller.getState()).toBe('scanning');
    expect(controller.getText()).toContain('Scanning');
    expect(controller.getText()).toContain('$(sync~spin)');
  });

  it('setClean shows check icon', () => {
    controller.setClean();
    expect(controller.getState()).toBe('clean');
    expect(controller.getText()).toContain('No conflicts');
    expect(controller.getText()).toContain('$(check)');
  });

  it('setError shows alert icon', () => {
    controller.setError('Git not found');
    expect(controller.getState()).toBe('error');
    expect(controller.getText()).toContain('Error');
    expect(controller.getText()).toContain('$(alert)');
    expect(controller.getTooltip()).toContain('Git not found');
  });

  it('setError with no message uses default', () => {
    controller.setError();
    expect(controller.getTooltip()).toContain('error occurred');
  });

  it('setDisabled shows circle-slash icon', () => {
    controller.setDisabled();
    expect(controller.getState()).toBe('disabled');
    expect(controller.getText()).toContain('Off');
    expect(controller.getText()).toContain('$(circle-slash)');
  });

  // ── updateFromScan ─────────────────────────────

  it('shows clean state when no conflicts', () => {
    const scan = makeScan([makeConflictResult('main', 0)]);
    controller.updateFromScan(scan);
    expect(controller.getState()).toBe('clean');
  });

  it('shows conflict count for low risk', () => {
    const scan = makeScan([makeConflictResult('main', 2)], RiskLevel.Low);
    controller.updateFromScan(scan);
    expect(controller.getState()).toBe('conflict');
    expect(controller.getText()).toContain('2 conflicts');
    expect(controller.getText()).toContain('$(warning)');
  });

  it('shows singular "conflict" for 1 file', () => {
    const scan = makeScan([makeConflictResult('main', 1)], RiskLevel.Low);
    controller.updateFromScan(scan);
    expect(controller.getText()).toContain('1 conflict');
    expect(controller.getText()).not.toContain('1 conflicts');
  });

  it('shows warning icon for medium risk', () => {
    const scan = makeScan([makeConflictResult('main', 3)], RiskLevel.Medium);
    controller.updateFromScan(scan);
    expect(controller.getText()).toContain('$(warning)');
  });

  it('shows error icon for high risk', () => {
    const scan = makeScan([makeConflictResult('main', 7)], RiskLevel.High);
    controller.updateFromScan(scan);
    expect(controller.getText()).toContain('$(error)');
  });

  // ── Tooltip ────────────────────────────────────

  it('tooltip lists per-branch conflict summary', () => {
    const scan = makeScan([
      makeConflictResult('main', 3),
      makeConflictResult('develop', 1),
    ], RiskLevel.Medium);
    controller.updateFromScan(scan);
    const tip = controller.getTooltip() as string;
    expect(tip).toContain('3 files conflict with main');
    expect(tip).toContain('1 file conflict with develop');
  });

  it('tooltip omits branches with zero conflicts', () => {
    const scan = makeScan([
      makeConflictResult('main', 2),
      makeConflictResult('develop', 0),
    ], RiskLevel.Low);
    controller.updateFromScan(scan);
    const tip = controller.getTooltip() as string;
    expect(tip).toContain('main');
    expect(tip).not.toContain('develop');
  });

  // ── State cycling ──────────────────────────────

  it('can transition through all states', () => {
    controller.setScanning();
    expect(controller.getState()).toBe('scanning');
    controller.setClean();
    expect(controller.getState()).toBe('clean');
    controller.setError();
    expect(controller.getState()).toBe('error');
    controller.setDisabled();
    expect(controller.getState()).toBe('disabled');
    controller.setReady();
    expect(controller.getState()).toBe('ready');
  });

  // ── Dispose ────────────────────────────────────

  it('dispose does not throw', () => {
    expect(() => controller.dispose()).not.toThrow();
  });
});
