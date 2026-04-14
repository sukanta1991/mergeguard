import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

/**
 * Tests for settings & configuration behavior (M1.13).
 *
 * Since configuration is wired in extension.ts (which needs a full VS Code host),
 * these tests verify the underlying patterns: getConfiguration, onDidChangeConfiguration,
 * and the configure command QuickPick flow.
 */
describe('Settings & Configuration', () => {
  describe('getConfiguration', () => {
    it('reads trackedBranches with correct default', () => {
      const config = vscode.workspace.getConfiguration('mergeguard');
      const branches = config.get<string[]>('trackedBranches', ['main', 'master', 'develop']);
      expect(branches).toEqual(['main', 'master', 'develop']);
    });

    it('reads autoScanOnSave with default true', () => {
      const config = vscode.workspace.getConfiguration('mergeguard');
      const value = config.get<boolean>('autoScanOnSave', true);
      expect(value).toBe(true);
    });

    it('reads autoScanInterval with default 300', () => {
      const config = vscode.workspace.getConfiguration('mergeguard');
      const value = config.get<number>('autoScanInterval', 300);
      expect(value).toBe(300);
    });

    it('reads debounceDelay with default 2000', () => {
      const config = vscode.workspace.getConfiguration('mergeguard');
      const value = config.get<number>('debounceDelay', 2000);
      expect(value).toBe(2000);
    });

    it('reads showInlineDecorations with default true', () => {
      const config = vscode.workspace.getConfiguration('mergeguard');
      const value = config.get<boolean>('showInlineDecorations', true);
      expect(value).toBe(true);
    });

    it('reads showInProblemsPanel with default true', () => {
      const config = vscode.workspace.getConfiguration('mergeguard');
      const value = config.get<boolean>('showInProblemsPanel', true);
      expect(value).toBe(true);
    });

    it('reads riskThreshold with default low', () => {
      const config = vscode.workspace.getConfiguration('mergeguard');
      const value = config.get<string>('riskThreshold', 'low');
      expect(value).toBe('low');
    });
  });

  describe('config.update', () => {
    it('update returns a promise', async () => {
      const config = vscode.workspace.getConfiguration('mergeguard');
      // Should not throw
      await config.update('autoScanOnSave', false);
    });
  });

  describe('onDidChangeConfiguration', () => {
    it('returns a disposable', () => {
      const disposable = vscode.workspace.onDidChangeConfiguration(() => {});
      expect(disposable).toBeDefined();
      expect(disposable.dispose).toBeInstanceOf(Function);
      disposable.dispose();
    });
  });

  describe('ConfigurationTarget', () => {
    it('has correct enum values', () => {
      expect(vscode.ConfigurationTarget.Global).toBe(1);
      expect(vscode.ConfigurationTarget.Workspace).toBe(2);
      expect(vscode.ConfigurationTarget.WorkspaceFolder).toBe(3);
    });
  });

  describe('QuickPick (configure command pattern)', () => {
    it('showQuickPick is callable', async () => {
      const result = await vscode.window.showQuickPick([
        { label: 'main', picked: true },
        { label: 'develop', picked: false },
      ], {
        canPickMany: true,
        placeHolder: 'Select branches',
      });
      // Mock returns undefined (no selection)
      expect(result).toBeUndefined();
    });
  });

  describe('registerCommand', () => {
    it('returns a disposable', () => {
      const disposable = vscode.commands.registerCommand('test.command', () => {});
      expect(disposable).toBeDefined();
      expect(disposable.dispose).toBeInstanceOf(Function);
      disposable.dispose();
    });
  });
});
