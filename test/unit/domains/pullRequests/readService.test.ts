import type {
  GitPullRequest,
  GitPullRequestChange,
  GitPullRequestCommentThread,
  GitPullRequestIteration,
} from '../../../../src/ado/types.js';
import { describe, expect, it } from 'vitest';
import { PullRequestsReadService } from '../../../../src/domains/pullRequests/readService.js';
import { FakeAdoClient } from '../../../fakes/FakeAdoClient.js';

const REPO = { project: 'MyProject', repo: 'MyRepo' };

function makeFake(): FakeAdoClient {
  return new FakeAdoClient();
}

describe('pullRequestsReadService.list', () => {
  it('returns shaped PR summaries', async () => {
    const fake = makeFake();
    const prs: GitPullRequest[] = [
      {
        pullRequestId: 42,
        title: 'Add feature X',
        status: 1, // active
        createdBy: { displayName: 'Alice', id: 'a1' },
        sourceRefName: 'refs/heads/feature',
        targetRefName: 'refs/heads/main',
        creationDate: new Date('2026-04-22T10:00:00Z'),
        url: 'https://example.com/_apis/git/pr/42',
      },
    ];
    fake.setPullRequests(REPO.project, REPO.repo, prs);
    const svc = new PullRequestsReadService(fake, async () => REPO);
    const result = await svc.list({});
    expect(result[0]).toMatchObject({
      id: 42,
      title: 'Add feature X',
      status: 'active',
      author: 'Alice',
      sourceBranch: 'feature',
      targetBranch: 'main',
    });
  });
});

describe('pullRequestsReadService.getDiff', () => {
  it('fetches base + target content and returns a unified diff', async () => {
    const fake = makeFake();
    const pr: GitPullRequest = {
      pullRequestId: 7,
      lastMergeSourceCommit: { commitId: 'targetSHA' },
      lastMergeTargetCommit: { commitId: 'baseSHA' },
    };
    fake.setPullRequest({ ...REPO, repository: REPO.repo, pullRequestId: 7, pr });
    fake.setFileContent({
      project: REPO.project,
      repository: REPO.repo,
      path: 'src/foo.ts',
      commitSha: 'baseSHA',
      content: 'old\n',
    });
    fake.setFileContent({
      project: REPO.project,
      repository: REPO.repo,
      path: 'src/foo.ts',
      commitSha: 'targetSHA',
      content: 'new\n',
    });
    const svc = new PullRequestsReadService(fake, async () => REPO);
    const diff = await svc.getDiff({ pullRequestId: 7, path: 'src/foo.ts' });
    expect(diff).toMatch(/-old/);
    expect(diff).toMatch(/\+new/);
  });

  it('throws when PR has no merge commits yet', async () => {
    const fake = makeFake();
    fake.setPullRequest({
      ...REPO,
      repository: REPO.repo,
      pullRequestId: 8,
      pr: { pullRequestId: 8 } as GitPullRequest,
    });
    const svc = new PullRequestsReadService(fake, async () => REPO);
    await expect(svc.getDiff({ pullRequestId: 8, path: 'x' })).rejects.toThrow(/SHA/);
  });
});

describe('pullRequestsReadService.listChanges', () => {
  it('returns shaped change list', async () => {
    const fake = makeFake();
    const changes: GitPullRequestChange[] = [
      { changeType: 2 /* edit */, item: { path: '/src/foo.ts' } },
      { changeType: 1 /* add */, item: { path: '/src/new.ts' } },
    ];
    fake.setPullRequestChanges({ ...REPO, repository: REPO.repo, pullRequestId: 9, changes });
    const svc = new PullRequestsReadService(fake, async () => REPO);
    const result = await svc.listChanges({ pullRequestId: 9 });
    expect(result).toEqual([
      { path: '/src/foo.ts', changeType: 'edit' },
      { path: '/src/new.ts', changeType: 'add' },
    ]);
  });
});

describe('pullRequestsReadService.listComments', () => {
  it('returns shaped comment threads', async () => {
    const fake = makeFake();
    const threads: GitPullRequestCommentThread[] = [
      {
        id: 1,
        status: 1, // active
        threadContext: { filePath: '/src/foo.ts', rightFileStart: { line: 10, offset: 1 } },
        comments: [
          {
            author: { displayName: 'Bob' },
            content: 'Looks good',
            publishedDate: new Date('2026-04-22T11:00:00Z'),
          },
        ],
      },
    ];
    fake.setPullRequestThreads({ ...REPO, repository: REPO.repo, pullRequestId: 10, threads });
    const svc = new PullRequestsReadService(fake, async () => REPO);
    const result = await svc.listComments({ pullRequestId: 10 });
    expect(result[0]).toMatchObject({
      threadId: 1,
      status: 'active',
      filePath: '/src/foo.ts',
      line: 10,
      comments: [{ author: 'Bob', content: 'Looks good' }],
    });
  });
});

describe('pullRequestsReadService.getIterations', () => {
  it('returns shaped iteration summaries', async () => {
    const fake = makeFake();
    const iterations: GitPullRequestIteration[] = [
      { id: 1, description: 'Initial push', createdDate: new Date('2026-04-22T09:00:00Z') },
      { id: 2, description: 'Address feedback', createdDate: new Date('2026-04-22T15:00:00Z') },
    ];
    fake.setPullRequestIterations({
      ...REPO,
      repository: REPO.repo,
      pullRequestId: 11,
      iterations,
    });
    const svc = new PullRequestsReadService(fake, async () => REPO);
    const result = await svc.getIterations({ pullRequestId: 11 });
    expect(result).toEqual([
      {
        id: 1,
        description: 'Initial push',
        createdDate: '2026-04-22T09:00:00.000Z',
      },
      {
        id: 2,
        description: 'Address feedback',
        createdDate: '2026-04-22T15:00:00.000Z',
      },
    ]);
  });
});
