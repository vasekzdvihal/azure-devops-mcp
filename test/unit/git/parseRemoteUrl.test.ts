import { describe, expect, it } from 'vitest';
import { parseRemoteUrl } from '../../../src/git/parseRemoteUrl.js';

describe('parseRemoteUrl', () => {
  // ADO Services HTTPS
  it('parses dev.azure.com HTTPS URL', () => {
    expect(parseRemoteUrl('https://dev.azure.com/myorg/MyProject/_git/MyRepo')).toEqual({
      project: 'MyProject',
      repo: 'MyRepo',
    });
  });

  it('uRL-decodes project and repo names', () => {
    expect(parseRemoteUrl('https://dev.azure.com/myorg/My%20Project/_git/My%20Repo')).toEqual({
      project: 'My Project',
      repo: 'My Repo',
    });
  });

  it('strips trailing .git', () => {
    expect(parseRemoteUrl('https://dev.azure.com/myorg/MyProject/_git/MyRepo.git')).toEqual({
      project: 'MyProject',
      repo: 'MyRepo',
    });
  });

  // ADO Services legacy visualstudio.com
  it('parses *.visualstudio.com HTTPS URL', () => {
    expect(parseRemoteUrl('https://myorg.visualstudio.com/MyProject/_git/MyRepo')).toEqual({
      project: 'MyProject',
      repo: 'MyRepo',
    });
  });

  // ADO Services SSH
  it('parses ssh.dev.azure.com SSH URL', () => {
    expect(parseRemoteUrl('git@ssh.dev.azure.com:v3/myorg/MyProject/MyRepo')).toEqual({
      project: 'MyProject',
      repo: 'MyRepo',
    });
  });

  it('parses vs-ssh.visualstudio.com SSH URL', () => {
    expect(parseRemoteUrl('myorg@vs-ssh.visualstudio.com:v3/myorg/MyProject/MyRepo')).toEqual({
      project: 'MyProject',
      repo: 'MyRepo',
    });
  });

  // ADO Server HTTPS — with /tfs/ collection prefix
  it('parses on-prem HTTPS with /tfs/ collection', () => {
    expect(
      parseRemoteUrl('https://tfs.company.com/tfs/DefaultCollection/MyProject/_git/MyRepo'),
    ).toEqual({ project: 'MyProject', repo: 'MyRepo' });
  });

  // ADO Server HTTPS — without /tfs/ prefix
  it('parses on-prem HTTPS without /tfs/ prefix', () => {
    expect(
      parseRemoteUrl('https://ado.company.com/DefaultCollection/MyProject/_git/MyRepo'),
    ).toEqual({ project: 'MyProject', repo: 'MyRepo' });
  });

  // ADO Server SSH
  it('parses on-prem SSH URL', () => {
    expect(
      parseRemoteUrl('ssh://tfs.company.com:22/tfs/DefaultCollection/MyProject/_git/MyRepo'),
    ).toEqual({ project: 'MyProject', repo: 'MyRepo' });
  });

  // Non-ADO URLs return null
  it('returns null for github.com URL', () => {
    expect(parseRemoteUrl('https://github.com/owner/repo.git')).toBeNull();
  });

  it('returns null for gitlab URL', () => {
    expect(parseRemoteUrl('git@gitlab.com:owner/repo.git')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseRemoteUrl('')).toBeNull();
  });

  it('returns null for malformed URL', () => {
    expect(parseRemoteUrl('not-a-url')).toBeNull();
  });

  // Defense against the on-prem regex misclassifying GitHub-shaped URLs that
  // happen to contain /_git/ — the host deny-list keeps us honest.
  it('returns null even for github.com URLs that contain /_git/', () => {
    expect(parseRemoteUrl('https://github.com/owner/proj/_git/repo')).toBeNull();
  });

  it('returns null for gitlab.com URLs that contain /_git/', () => {
    expect(parseRemoteUrl('https://gitlab.com/owner/proj/_git/repo')).toBeNull();
  });

  // Trailing slash should be normalized away.
  it('ignores a trailing slash on the URL', () => {
    expect(parseRemoteUrl('https://dev.azure.com/myorg/MyProject/_git/MyRepo/')).toEqual({
      project: 'MyProject',
      repo: 'MyRepo',
    });
  });
});
