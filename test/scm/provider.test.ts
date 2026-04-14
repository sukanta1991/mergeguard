import { describe, it, expect } from 'vitest';
import {
  parseRemoteUrl,
  registerSCMProviderFactory,
  createSCMProvider,
} from '../../src/scm/provider';
import type { SCMProvider, PR, PRMetadata, RemoteInfo, SCMType } from '../../src/scm/provider';

// ── parseRemoteUrl ───────────────────────────────────────

describe('parseRemoteUrl', () => {
  it('parses GitHub HTTPS URL', () => {
    const info = parseRemoteUrl('https://github.com/owner/repo.git');
    expect(info).toEqual({
      type: 'github',
      owner: 'owner',
      repo: 'repo',
      apiBase: 'https://api.github.com',
    });
  });

  it('parses GitHub HTTPS URL without .git suffix', () => {
    const info = parseRemoteUrl('https://github.com/owner/repo');
    expect(info).toEqual({
      type: 'github',
      owner: 'owner',
      repo: 'repo',
      apiBase: 'https://api.github.com',
    });
  });

  it('parses GitHub SSH URL', () => {
    const info = parseRemoteUrl('git@github.com:owner/repo.git');
    expect(info).toEqual({
      type: 'github',
      owner: 'owner',
      repo: 'repo',
      apiBase: 'https://api.github.com',
    });
  });

  it('parses GitLab HTTPS URL', () => {
    const info = parseRemoteUrl('https://gitlab.com/owner/repo.git');
    expect(info).toEqual({
      type: 'gitlab',
      owner: 'owner',
      repo: 'repo',
      apiBase: 'https://gitlab.com/api/v4',
    });
  });

  it('parses GitLab SSH URL', () => {
    const info = parseRemoteUrl('git@gitlab.com:owner/repo.git');
    expect(info).toEqual({
      type: 'gitlab',
      owner: 'owner',
      repo: 'repo',
      apiBase: 'https://gitlab.com/api/v4',
    });
  });

  it('parses Bitbucket HTTPS URL', () => {
    const info = parseRemoteUrl('https://bitbucket.org/owner/repo.git');
    expect(info).toEqual({
      type: 'bitbucket',
      owner: 'owner',
      repo: 'repo',
      apiBase: 'https://api.bitbucket.org/2.0',
    });
  });

  it('parses Azure DevOps URL', () => {
    const info = parseRemoteUrl('https://dev.azure.com/org/project.git');
    expect(info).toEqual({
      type: 'azureDevops',
      owner: 'org',
      repo: 'project',
      apiBase: 'https://dev.azure.com/org',
    });
  });

  it('returns unknown for self-hosted URLs', () => {
    const info = parseRemoteUrl('https://git.example.com/team/project.git');
    expect(info).toBeDefined();
    expect(info!.type).toBe('unknown');
    expect(info!.owner).toBe('team');
    expect(info!.repo).toBe('project');
  });

  it('returns undefined for invalid URLs', () => {
    expect(parseRemoteUrl('not-a-url')).toBeUndefined();
  });

  it('returns undefined for URL with single path segment', () => {
    expect(parseRemoteUrl('https://github.com/owner')).toBeUndefined();
  });
});

// ── Factory ──────────────────────────────────────────────

describe('createSCMProvider / registerSCMProviderFactory', () => {
  it('returns undefined for unregistered type', async () => {
    const info: RemoteInfo = { type: 'bitbucket', owner: 'o', repo: 'r', apiBase: '' };
    const provider = await createSCMProvider(info);
    expect(provider).toBeUndefined();
  });

  it('creates provider from registered factory', async () => {
    const mockProvider: SCMProvider = {
      type: 'github' as SCMType,
      isAuthenticated: async () => true,
      getOpenPRs: async () => [],
      getPRBranches: async () => [],
      getPRMetadata: async () => undefined,
      dispose: () => {},
    };

    registerSCMProviderFactory('github', async () => mockProvider);

    const info: RemoteInfo = { type: 'github', owner: 'o', repo: 'r', apiBase: '' };
    const provider = await createSCMProvider(info);
    expect(provider).toBe(mockProvider);
  });
});
