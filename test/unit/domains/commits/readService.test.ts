import type { GitBranchStats, GitCommitRef } from '../../../../src/ado/types.js';
import { describe, expect, it } from 'vitest';
import { CommitsReadService } from '../../../../src/domains/commits/readService.js';
import { FakeAdoClient } from '../../../fakes/FakeAdoClient.js';

const REPO = { project: 'MyProject', repo: 'MyRepo' };

describe('commitsReadService.listBranches', () => {
  it('resolves repo from cwd when no args and shapes branches', async () => {
    const fake = new FakeAdoClient();
    const branches: GitBranchStats[] = [
      {
        name: 'main',
        commit: { commitId: 'abc123' },
        aheadCount: 0,
        behindCount: 0,
        isBaseVersion: true,
      },
      {
        name: 'feature/x',
        commit: { commitId: 'def456' },
        aheadCount: 3,
        behindCount: 1,
        isBaseVersion: false,
      },
    ];
    fake.setBranches(REPO.project, REPO.repo, branches);
    const svc = new CommitsReadService(fake, async () => REPO);

    const result = await svc.listBranches({});

    expect(result).toEqual([
      {
        name: 'main',
        lastCommitId: 'abc123',
        aheadCount: 0,
        behindCount: 0,
        isBaseVersion: true,
      },
      {
        name: 'feature/x',
        lastCommitId: 'def456',
        aheadCount: 3,
        behindCount: 1,
        isBaseVersion: false,
      },
    ]);
  });

  it('honors explicit project + repository args over cwd detection', async () => {
    const fake = new FakeAdoClient();
    fake.setBranches('OtherProj', 'OtherRepo', [
      { name: 'main', commit: { commitId: 'z' } },
    ]);
    const svc = new CommitsReadService(fake, async () => REPO);

    const result = await svc.listBranches({
      project: 'OtherProj',
      repository: 'OtherRepo',
    });

    expect(result).toEqual([
      {
        name: 'main',
        lastCommitId: 'z',
        aheadCount: undefined,
        behindCount: undefined,
        isBaseVersion: undefined,
      },
    ]);
  });
});

describe('commitsReadService.listCommits', () => {
  it('forwards branch/date/author filters and shapes commits', async () => {
    const fake = new FakeAdoClient();
    const commits: GitCommitRef[] = [
      {
        commitId: 'abc123',
        comment: 'fix(foo): tweak',
        author: {
          name: 'Alice',
          email: 'alice@example.com',
          date: new Date('2026-04-21T10:00:00Z'),
        },
        committer: {
          name: 'Alice',
          email: 'alice@example.com',
          date: new Date('2026-04-21T10:00:00Z'),
        },
        changeCounts: { Add: 2, Edit: 3, Delete: 0 },
        url: 'https://example.com/_apis/git/commits/abc123',
      },
    ];
    fake.setCommits(REPO.project, REPO.repo, commits);
    const svc = new CommitsReadService(fake, async () => REPO);

    const result = await svc.listCommits({
      branch: 'main',
      fromDate: '2026-04-20T00:00:00Z',
      toDate: '2026-04-22T00:00:00Z',
      author: 'alice',
      top: 10,
    });

    expect(result).toEqual([
      {
        commitId: 'abc123',
        comment: 'fix(foo): tweak',
        author: {
          name: 'Alice',
          email: 'alice@example.com',
          date: '2026-04-21T10:00:00.000Z',
        },
        committer: {
          name: 'Alice',
          email: 'alice@example.com',
          date: '2026-04-21T10:00:00.000Z',
        },
        changeCounts: { Add: 2, Edit: 3, Delete: 0 },
        url: 'https://example.com/_apis/git/commits/abc123',
      },
    ]);
  });
});

describe('commitsReadService.listCommits notInBranch', () => {
  it('passes branch + notInBranch as short names and returns author email', async () => {
    const fake = new FakeAdoClient();
    fake.setCommits(REPO.project, REPO.repo, [
      { commitId: 'x1', comment: 'fix', author: { name: 'Ann', email: 'ann@corp.cz', date: new Date('2026-09-01T00:00:00Z') } },
    ]);
    const svc = new CommitsReadService(fake, async () => REPO);
    const result = await svc.listCommits({ branch: 'refs/heads/staging', notInBranch: 'develop' });
    expect(fake.getListCommitsCalls()[0]).toMatchObject({ branch: 'staging', notInBranch: 'develop' });
    expect(result[0]?.author?.email).toBe('ann@corp.cz');
  });

  it('rejects notInBranch without branch', async () => {
    const svc = new CommitsReadService(new FakeAdoClient(), async () => REPO);
    await expect(svc.listCommits({ notInBranch: 'develop' })).rejects.toThrow(
      /`notInBranch` requires `branch`/,
    );
  });
});

describe('commitsReadService.listBranches filters', () => {
  const branches: GitBranchStats[] = [
    { name: 'main', commit: { commitId: 'a' }, aheadCount: 0, behindCount: 0, isBaseVersion: true },
    { name: 'staging', commit: { commitId: 'b' }, aheadCount: 48, behindCount: 0 },
    { name: 'feature/login', commit: { commitId: 'c' }, aheadCount: 2, behindCount: 5 },
  ];

  it('names → exact allowlist plus missing list', async () => {
    const fake = new FakeAdoClient();
    fake.setBranches(REPO.project, REPO.repo, branches);
    const svc = new CommitsReadService(fake, async () => REPO);
    const result = await svc.listBranches({ names: ['main', 'refs/heads/staging', 'develop'] });
    expect(result).toEqual({
      branches: [
        { name: 'main', lastCommitId: 'a', aheadCount: 0, behindCount: 0, isBaseVersion: true },
        { name: 'staging', lastCommitId: 'b', aheadCount: 48, behindCount: 0, isBaseVersion: undefined },
      ],
      missing: ['develop'],
    });
  });

  it('nameContains → case-insensitive substring, plain array', async () => {
    const fake = new FakeAdoClient();
    fake.setBranches(REPO.project, REPO.repo, branches);
    const svc = new CommitsReadService(fake, async () => REPO);
    const result = await svc.listBranches({ nameContains: 'LOGIN' });
    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<{ name: string }>).map(branch => branch.name)).toEqual(['feature/login']);
  });

  it('branch names returned with a refs/heads/ prefix still match names and are not reported missing', async () => {
    const fake = new FakeAdoClient();
    fake.setBranches(REPO.project, REPO.repo, [{ name: 'refs/heads/develop', commit: { commitId: 'd' } }]);
    const svc = new CommitsReadService(fake, async () => REPO);
    const result = await svc.listBranches({ names: ['develop'] });
    expect(result).toMatchObject({ branches: [{ name: 'develop' }], missing: [] });
  });

  it('baseBranch is passed to the client as a short name', async () => {
    const fake = new FakeAdoClient();
    fake.setBranches(REPO.project, REPO.repo, branches);
    const svc = new CommitsReadService(fake, async () => REPO);
    await svc.listBranches({ baseBranch: 'refs/heads/staging' });
    expect(fake.getListBranchesCalls()).toEqual([
      { project: REPO.project, repository: REPO.repo, baseBranch: 'staging' },
    ]);
  });
});

describe('commitsReadService.compareBranches', () => {
  it('returns counts + named changeCounts, no commits by default', async () => {
    const fake = new FakeAdoClient();
    fake.setCommitDiffs(REPO.project, REPO.repo, {
      aheadCount: 3,
      behindCount: 1,
      commonCommit: 'cc',
      changeCounts: { 1: 2, 2: 5, 16: 1 },
    });
    const svc = new CommitsReadService(fake, async () => REPO);
    const result = await svc.compareBranches({ base: 'refs/heads/develop', target: 'staging' });
    expect(result).toEqual({
      base: 'develop',
      target: 'staging',
      aheadCount: 3,
      behindCount: 1,
      commonCommit: 'cc',
      changeCounts: { Add: 2, Edit: 5, Delete: 1 },
    });
    expect(fake.getListCommitsCalls()).toEqual([]);
  });

  it('includeCommits → commits in target not in base', async () => {
    const fake = new FakeAdoClient();
    fake.setCommitDiffs(REPO.project, REPO.repo, { aheadCount: 1, behindCount: 0 });
    fake.setCommits(REPO.project, REPO.repo, [{ commitId: 'k', author: { name: 'B', email: 'b@x.cz' } }]);
    const svc = new CommitsReadService(fake, async () => REPO);
    const result = await svc.compareBranches({ base: 'develop', target: 'staging', includeCommits: true, top: 10 });
    expect(fake.getListCommitsCalls()[0]).toMatchObject({ branch: 'staging', notInBranch: 'develop', top: 10 });
    expect(result.commits?.[0]?.author?.email).toBe('b@x.cz');
  });
});
