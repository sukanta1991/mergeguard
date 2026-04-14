import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import {
  buildPreviewUri,
  SCHEME,
  ConflictPreviewProvider,
} from '../../src/ui/conflictPreview';

// Mock the conflictContent module
vi.mock('../../src/core/conflictContent', () => ({
  getMergedFileContent: vi.fn().mockResolvedValue('// merged content with <<<<<<< markers'),
  getFileAtRef: vi.fn().mockResolvedValue('// file content at ref'),
  getMergeBase: vi.fn().mockResolvedValue('abc1234567890123456789012345678901234567'),
  getThreeWayContent: vi.fn().mockResolvedValue({
    base: '// base',
    ours: '// ours',
    theirs: '// theirs',
  }),
}));

describe('conflictPreview', () => {
  describe('SCHEME', () => {
    it('is "mergeguard"', () => {
      expect(SCHEME).toBe('mergeguard');
    });
  });

  describe('buildPreviewUri', () => {
    it('creates a URI with correct scheme', () => {
      const uri = buildPreviewUri({
        filePath: 'src/app.ts',
        branch: 'main',
        currentRef: 'feature/test',
        gitRoot: '/repo',
        type: 'merged',
      });
      expect(uri.scheme).toBe('mergeguard');
    });

    it('encodes filePath in the path', () => {
      const uri = buildPreviewUri({
        filePath: 'src/app.ts',
        branch: 'main',
        currentRef: 'feature/test',
        gitRoot: '/repo',
        type: 'merged',
      });
      expect(uri.path).toContain('src/app.ts');
    });

    it('includes branch in the query', () => {
      const uri = buildPreviewUri({
        filePath: 'src/app.ts',
        branch: 'main',
        currentRef: 'feature/test',
        gitRoot: '/repo',
        type: 'merged',
      });
      expect(uri.query).toContain('branch=main');
    });

    it('includes type in the query', () => {
      const uri = buildPreviewUri({
        filePath: 'src/app.ts',
        branch: 'main',
        currentRef: 'feature/test',
        gitRoot: '/repo',
        type: 'theirs',
      });
      expect(uri.query).toContain('type=theirs');
    });

    it('handles all four types', () => {
      for (const type of ['merged', 'base', 'ours', 'theirs'] as const) {
        const uri = buildPreviewUri({
          filePath: 'file.ts',
          branch: 'main',
          currentRef: 'dev',
          gitRoot: '/repo',
          type,
        });
        expect(uri.query).toContain(`type=${type}`);
      }
    });
  });

  describe('ConflictPreviewProvider', () => {
    let provider: ConflictPreviewProvider;

    beforeEach(() => {
      provider = new ConflictPreviewProvider();
    });

    it('returns fallback for non-mergeguard scheme', async () => {
      const uri = vscode.Uri.file('/some/file.ts');
      const content = await provider.provideTextDocumentContent(uri);
      expect(content).toContain('Failed to parse');
    });

    it('provides merged content for a valid URI', async () => {
      const uri = buildPreviewUri({
        filePath: 'src/app.ts',
        branch: 'main',
        currentRef: 'feature/test',
        gitRoot: '/repo',
        type: 'merged',
      });
      const content = await provider.provideTextDocumentContent(uri);
      expect(content).toContain('merged content');
    });

    it('provides base content for base type', async () => {
      const uri = buildPreviewUri({
        filePath: 'src/app.ts',
        branch: 'main',
        currentRef: 'feature/test',
        gitRoot: '/repo',
        type: 'base',
      });
      const content = await provider.provideTextDocumentContent(uri);
      expect(content).toContain('file content');
    });

    it('provides ours content', async () => {
      const uri = buildPreviewUri({
        filePath: 'src/app.ts',
        branch: 'main',
        currentRef: 'feature/test',
        gitRoot: '/repo',
        type: 'ours',
      });
      const content = await provider.provideTextDocumentContent(uri);
      expect(content).toContain('file content');
    });

    it('provides theirs content', async () => {
      const uri = buildPreviewUri({
        filePath: 'src/app.ts',
        branch: 'main',
        currentRef: 'feature/test',
        gitRoot: '/repo',
        type: 'theirs',
      });
      const content = await provider.provideTextDocumentContent(uri);
      expect(content).toContain('file content');
    });

    it('dispose does not throw', () => {
      expect(() => provider.dispose()).not.toThrow();
    });

    it('has onDidChange event', () => {
      expect(provider.onDidChange).toBeDefined();
    });
  });
});
