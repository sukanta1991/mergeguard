import { describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { ConflictCodeLensProvider } from '../../src/ui/codeLens';
import { ConflictType, RiskLevel } from '../../src/core/types';
import type { ScanResult, ConflictResult, ConflictFile, LineRange } from '../../src/core/types';

const GIT_ROOT = '/repo';

function makeFile(
  path: string,
  conflictType: ConflictType = ConflictType.Content,
  lineRanges: LineRange[] = [],
): ConflictFile {
  return { path, conflictType, lineRanges };
}

function makeResult(branch: string, files: ConflictFile[]): ConflictResult {
  return {
    branch,
    currentSHA: 'aaa',
    targetSHA: 'bbb',
    files,
    riskScore: files.length > 0 ? 50 : 0,
    riskLevel: files.length > 0 ? RiskLevel.Medium : RiskLevel.None,
    timestamp: Date.now(),
    status: 'success',
  };
}

function makeScan(results: ConflictResult[]): ScanResult {
  return {
    results,
    overallRiskScore: Math.max(0, ...results.map((r) => r.riskScore)),
    overallRiskLevel: RiskLevel.Medium,
    totalConflictFiles: results.reduce((s, r) => s + r.files.length, 0),
    timestamp: Date.now(),
    durationMs: 100,
  };
}

function makeDocument(filePath: string): vscode.TextDocument {
  return {
    uri: { fsPath: `${GIT_ROOT}/${filePath}`, scheme: 'file' },
    languageId: 'typescript',
  } as unknown as vscode.TextDocument;
}

describe('ConflictCodeLensProvider', () => {
  let provider: ConflictCodeLensProvider;

  beforeEach(() => {
    provider = new ConflictCodeLensProvider();
  });

  it('returns no lenses when no scan results', () => {
    const lenses = provider.provideCodeLenses(makeDocument('src/app.ts'));
    expect(lenses).toEqual([]);
  });

  it('returns no lenses for a file without conflicts', () => {
    provider.update(makeScan([makeResult('main', [makeFile('other.ts')])]), GIT_ROOT);
    const lenses = provider.provideCodeLenses(makeDocument('src/app.ts'));
    expect(lenses).toEqual([]);
  });

  it('returns no lenses when disabled', () => {
    provider.update(
      makeScan([makeResult('main', [makeFile('src/app.ts', ConflictType.Content, [{ startLine: 10, endLine: 20 }])])]),
      GIT_ROOT,
    );
    provider.setEnabled(false);
    const lenses = provider.provideCodeLenses(makeDocument('src/app.ts'));
    expect(lenses).toEqual([]);
  });

  it('returns file-level lens at line 0', () => {
    provider.update(
      makeScan([makeResult('main', [makeFile('src/app.ts', ConflictType.Content, [{ startLine: 10, endLine: 20 }])])]),
      GIT_ROOT,
    );
    const lenses = provider.provideCodeLenses(makeDocument('src/app.ts'));
    expect(lenses.length).toBeGreaterThanOrEqual(1);
    const fileLens = lenses[0];
    expect(fileLens.command?.title).toContain('MergeGuard');
    expect(fileLens.command?.title).toContain('1 conflict');
    expect(fileLens.range.start.line).toBe(0);
  });

  it('returns region-level lens with branch name', () => {
    provider.update(
      makeScan([makeResult('main', [makeFile('src/app.ts', ConflictType.Content, [{ startLine: 10, endLine: 20 }])])]),
      GIT_ROOT,
    );
    const lenses = provider.provideCodeLenses(makeDocument('src/app.ts'));
    // First lens is file-level, second is region-level
    expect(lenses.length).toBe(2);
    const regionLens = lenses[1];
    expect(regionLens.command?.title).toContain('Conflicts with main');
    expect(regionLens.command?.title).toContain('lines 10–20');
  });

  it('shows plural "conflicts" when multiple regions exist', () => {
    provider.update(
      makeScan([
        makeResult('main', [
          makeFile('src/app.ts', ConflictType.Content, [
            { startLine: 5, endLine: 10 },
            { startLine: 20, endLine: 30 },
          ]),
        ]),
      ]),
      GIT_ROOT,
    );
    const lenses = provider.provideCodeLenses(makeDocument('src/app.ts'));
    expect(lenses[0].command?.title).toContain('2 conflicts');
  });

  it('merges branches that conflict at the same region', () => {
    provider.update(
      makeScan([
        makeResult('main', [makeFile('src/app.ts', ConflictType.Content, [{ startLine: 10, endLine: 20 }])]),
        makeResult('develop', [makeFile('src/app.ts', ConflictType.Content, [{ startLine: 10, endLine: 20 }])]),
      ]),
      GIT_ROOT,
    );
    const lenses = provider.provideCodeLenses(makeDocument('src/app.ts'));
    // File-level + one merged region
    expect(lenses.length).toBe(2);
    expect(lenses[1].command?.title).toContain('2 branches conflict');
  });

  it('handles whole-file conflict (no lineRanges)', () => {
    provider.update(
      makeScan([makeResult('main', [makeFile('src/app.ts', ConflictType.Content, [])])]),
      GIT_ROOT,
    );
    const lenses = provider.provideCodeLenses(makeDocument('src/app.ts'));
    expect(lenses.length).toBe(2);
    expect(lenses[1].command?.title).toContain('Conflicts with main');
    // No "(lines ...)" for whole-file
    expect(lenses[1].command?.title).not.toContain('lines');
  });

  it('region lens opens previewConflict command', () => {
    provider.update(
      makeScan([makeResult('main', [makeFile('src/app.ts', ConflictType.Content, [{ startLine: 5, endLine: 15 }])])]),
      GIT_ROOT,
    );
    const lenses = provider.provideCodeLenses(makeDocument('src/app.ts'));
    const regionLens = lenses[1];
    expect(regionLens.command?.command).toBe('mergeguard.previewConflict');
    expect(regionLens.command?.arguments).toEqual(['src/app.ts', 'main']);
  });

  it('file-level lens opens tree view', () => {
    provider.update(
      makeScan([makeResult('main', [makeFile('src/app.ts', ConflictType.Content, [{ startLine: 1, endLine: 5 }])])]),
      GIT_ROOT,
    );
    const lenses = provider.provideCodeLenses(makeDocument('src/app.ts'));
    expect(lenses[0].command?.command).toBe('mergeguard.conflictsView.focus');
  });

  it('fires change event on update', () => {
    let fired = false;
    provider.onDidChangeCodeLenses(() => {
      fired = true;
    });
    provider.update(makeScan([]), GIT_ROOT);
    expect(fired).toBe(true);
  });

  it('fires change event on clear', () => {
    let fired = false;
    provider.onDidChangeCodeLenses(() => {
      fired = true;
    });
    provider.clear();
    expect(fired).toBe(true);
  });

  it('fires change event when toggling enabled', () => {
    let count = 0;
    provider.onDidChangeCodeLenses(() => count++);
    provider.setEnabled(false);
    provider.setEnabled(true);
    expect(count).toBe(2);
  });

  it('does not fire change event when setting same enabled value', () => {
    let count = 0;
    provider.onDidChangeCodeLenses(() => count++);
    provider.setEnabled(true); // already true by default
    expect(count).toBe(0);
  });

  it('ignores files outside git root', () => {
    provider.update(
      makeScan([makeResult('main', [makeFile('src/app.ts')])]),
      GIT_ROOT,
    );
    const doc = {
      uri: { fsPath: '/other/src/app.ts', scheme: 'file' },
    } as unknown as vscode.TextDocument;
    const lenses = provider.provideCodeLenses(doc);
    expect(lenses).toEqual([]);
  });

  it('dispose does not throw', () => {
    expect(() => provider.dispose()).not.toThrow();
  });

  it('handles multiple files in the same scan', () => {
    provider.update(
      makeScan([
        makeResult('main', [
          makeFile('src/a.ts', ConflictType.Content, [{ startLine: 1, endLine: 5 }]),
          makeFile('src/b.ts', ConflictType.Rename),
        ]),
      ]),
      GIT_ROOT,
    );
    const lensesA = provider.provideCodeLenses(makeDocument('src/a.ts'));
    const lensesB = provider.provideCodeLenses(makeDocument('src/b.ts'));
    expect(lensesA.length).toBe(2);
    expect(lensesB.length).toBe(2);
  });
});
