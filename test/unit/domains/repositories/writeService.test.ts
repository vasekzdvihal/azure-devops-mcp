import type { GitRepository } from '../../../../src/ado/types.js';
import { describe, expect, it } from 'vitest';
import { RepositoriesWriteService } from '../../../../src/domains/repositories/writeService.js';
import { FakeAdoClient } from '../../../fakes/FakeAdoClient.js';

describe('repositoriesWriteService.setDefaultBranch', () => {
  it('sets the default branch by short name and returns previous/current', async () => {
    const fake = new FakeAdoClient();
    const repo: GitRepository = {
      id: 'r1',
      name: 'NewtonLens',
      defaultBranch: 'refs/heads/cleanup-docker-standalone',
    };
    fake.setRepositories('P', [repo]);
    fake.setBranches('P', 'r1', [{ name: 'refs/heads/main' }]);

    const svc = new RepositoriesWriteService(fake);
    const result = await svc.setDefaultBranch({ project: 'P', repository: 'NewtonLens', branch: 'main' });

    expect(result).toEqual({ repository: 'NewtonLens', previous: 'cleanup-docker-standalone', current: 'main' });
    expect(fake.getRepositoryUpdates()).toEqual([
      { project: 'P', repositoryId: 'r1', defaultBranch: 'refs/heads/main' },
    ]);
  });

  it('accepts a full refs/heads/ branch ref and behaves the same', async () => {
    const fake = new FakeAdoClient();
    const repo: GitRepository = {
      id: 'r1',
      name: 'NewtonLens',
      defaultBranch: 'refs/heads/cleanup-docker-standalone',
    };
    fake.setRepositories('P', [repo]);
    fake.setBranches('P', 'r1', [{ name: 'refs/heads/main' }]);

    const svc = new RepositoriesWriteService(fake);
    const result = await svc.setDefaultBranch({ project: 'P', repository: 'NewtonLens', branch: 'refs/heads/main' });

    expect(result).toEqual({ repository: 'NewtonLens', previous: 'cleanup-docker-standalone', current: 'main' });
    expect(fake.getRepositoryUpdates()).toEqual([
      { project: 'P', repositoryId: 'r1', defaultBranch: 'refs/heads/main' },
    ]);
  });

  it('rejects when the branch does not exist and records no update', async () => {
    const fake = new FakeAdoClient();
    const repo: GitRepository = { id: 'r1', name: 'NewtonLens', defaultBranch: 'refs/heads/main' };
    fake.setRepositories('P', [repo]);
    fake.setBranches('P', 'r1', []);

    const svc = new RepositoriesWriteService(fake);
    await expect(
      svc.setDefaultBranch({ project: 'P', repository: 'NewtonLens', branch: 'main' }),
    ).rejects.toThrow(/branch 'main' does not exist in NewtonLens/);
    expect(fake.getRepositoryUpdates()).toEqual([]);
  });

  it('rejects when the repository name is not found in the project', async () => {
    const fake = new FakeAdoClient();
    fake.setRepositories('P', [{ id: 'r1', name: 'NewtonLens' }]);

    const svc = new RepositoriesWriteService(fake);
    await expect(
      svc.setDefaultBranch({ project: 'P', repository: 'Nope', branch: 'main' }),
    ).rejects.toThrow(/repository 'Nope' not found in project 'P'/);
  });
});
