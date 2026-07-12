import type { GitRepository } from '../../../../src/ado/types.js';
import { describe, expect, it } from 'vitest';
import { RepositoriesService } from '../../../../src/domains/repositories/service.js';
import { FakeAdoClient } from '../../../fakes/FakeAdoClient.js';

describe('repositoriesService.list', () => {
  it('returns shaped repos from the client for the given project', async () => {
    const fake = new FakeAdoClient();
    const repos: GitRepository[] = [
      { id: 'r1', name: 'RepoOne', defaultBranch: 'refs/heads/main', webUrl: 'https://x/r1' },
      { id: 'r2', name: 'RepoTwo', defaultBranch: 'refs/heads/master', webUrl: 'https://x/r2' },
    ];
    fake.setRepositories('MyProject', repos);

    const svc = new RepositoriesService(fake);
    const result = await svc.list({ project: 'MyProject' });
    expect(result).toEqual([
      { id: 'r1', name: 'RepoOne', defaultBranch: 'main', webUrl: 'https://x/r1' },
      { id: 'r2', name: 'RepoTwo', defaultBranch: 'master', webUrl: 'https://x/r2' },
    ]);
  });

  it('returns empty array when project has no repos configured', async () => {
    const fake = new FakeAdoClient();
    const svc = new RepositoriesService(fake);
    expect(await svc.list({ project: 'Empty' })).toEqual([]);
  });

  it('strips the refs/heads/ prefix from defaultBranch', async () => {
    const fake = new FakeAdoClient();
    fake.setRepositories('P', [
      { id: 'r', name: 'Repo', defaultBranch: 'refs/heads/develop' },
    ]);
    const svc = new RepositoriesService(fake);
    const result = await svc.list({ project: 'P' });
    expect(result[0]?.defaultBranch).toBe('develop');
  });

  it('handles missing defaultBranch gracefully', async () => {
    const fake = new FakeAdoClient();
    fake.setRepositories('P', [{ id: 'r', name: 'Repo' }]);
    const svc = new RepositoriesService(fake);
    const result = await svc.list({ project: 'P' });
    expect(result[0]?.defaultBranch).toBeUndefined();
  });
});
