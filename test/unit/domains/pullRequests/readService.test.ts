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

  it('includes a clickable webUrl built from repository.webUrl + pullRequestId', async () => {
    const fake = makeFake();
    const prs: GitPullRequest[] = [
      {
        pullRequestId: 9013,
        title: 'Add feature X',
        status: 1,
        repository: { webUrl: 'https://tfs/c/P/_git/N2' },
      },
    ];
    fake.setPullRequests(REPO.project, REPO.repo, prs);
    const svc = new PullRequestsReadService(fake, async () => REPO);
    const result = await svc.list({});
    expect(result[0]?.webUrl).toBe('https://tfs/c/P/_git/N2/pullrequest/9013');
  });

  it('leaves webUrl undefined when the pr has no repository.webUrl', async () => {
    const fake = makeFake();
    const prs: GitPullRequest[] = [
      { pullRequestId: 44, title: 'No repo url', status: 1 },
    ];
    fake.setPullRequests(REPO.project, REPO.repo, prs);
    const svc = new PullRequestsReadService(fake, async () => REPO);
    const result = await svc.list({});
    expect(result[0]?.webUrl).toBeUndefined();
  });
});

describe('pullRequestsReadService.get', () => {
  it('carries the same webUrl as the list shaper', async () => {
    const fake = makeFake();
    fake.setPullRequest({
      ...REPO,
      repository: REPO.repo,
      pullRequestId: 9013,
      pr: {
        pullRequestId: 9013,
        title: 'Add feature X',
        status: 1,
        repository: { webUrl: 'https://tfs/c/P/_git/N2' },
      },
    });
    const svc = new PullRequestsReadService(fake, async () => REPO);
    const result = await svc.get({ pullRequestId: 9013 });
    expect(result.webUrl).toBe('https://tfs/c/P/_git/N2/pullrequest/9013');
  });

  it('returns the merge commits (head sha = lastMergeSourceCommit.commitId)', async () => {
    const fake = makeFake();
    const head = 'a'.repeat(40);
    const base = 'b'.repeat(40);
    const merge = 'c'.repeat(40);
    fake.setPullRequest({
      ...REPO,
      repository: REPO.repo,
      pullRequestId: 251,
      pr: {
        pullRequestId: 251,
        title: 'Head commit',
        status: 1,
        lastMergeSourceCommit: { commitId: head, url: 'https://tfs/_apis/git/commits/a' },
        lastMergeTargetCommit: { commitId: base },
        lastMergeCommit: { commitId: merge, author: { name: 'Alice' }, comment: 'Merge' },
      },
    });
    const svc = new PullRequestsReadService(fake, async () => REPO);
    const result = await svc.get({ pullRequestId: 251 });
    expect(result.lastMergeSourceCommit).toEqual({
      commitId: head,
      url: 'https://tfs/_apis/git/commits/a',
    });
    expect(result.lastMergeTargetCommit).toEqual({ commitId: base });
    // Only commitId + url are kept — no author/comment noise.
    expect(result.lastMergeCommit).toEqual({ commitId: merge });
  });

  it('omits the merge commits when ADO has not computed them yet', async () => {
    const fake = makeFake();
    fake.setPullRequest({
      ...REPO,
      repository: REPO.repo,
      pullRequestId: 252,
      pr: { pullRequestId: 252, title: 'Queued', status: 1, mergeStatus: 1 },
    });
    const svc = new PullRequestsReadService(fake, async () => REPO);
    const result = await svc.get({ pullRequestId: 252 });
    expect(result).not.toHaveProperty('lastMergeSourceCommit');
    expect(result).not.toHaveProperty('lastMergeTargetCommit');
    expect(result).not.toHaveProperty('lastMergeCommit');
    expect(result.mergeStatus).toBe('queued');
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
