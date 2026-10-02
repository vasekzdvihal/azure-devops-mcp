import { GitVersionType } from 'azure-devops-node-api/interfaces/GitInterfaces.js';
import { describe, expect, it } from 'vitest';
import { branchDiffDescriptors, commitQueryCriteria } from '../../../src/ado/queryShapes.js';
import { captureVersioningArgs } from '../../helpers/sdkWire.js';

/**
 * Runs a real SDK GitApi method (shared harness, test/helpers/sdkWire.ts) stopped at
 * `getVersioningData`, returning the query values the SDK derived from our arguments — i.e. what
 * would actually go on the wire.
 */
async function captureQueryValues(
  invoke: Parameters<typeof captureVersioningArgs<'git'>>[1],
): Promise<Record<string, unknown>> {
  const args = await captureVersioningArgs('git', invoke);
  const queryParams: unknown = args.at(-1);
  if (typeof queryParams !== 'object' || queryParams === null) {
    throw new Error('query values were not captured');
  }
  return { ...queryParams };
}

describe('branchDiffDescriptors', () => {
  it('carries the branches in version/versionType, which is what the sdk serializes', () => {
    const { base, target } = branchDiffDescriptors('main', 'staging');
    expect(base).toEqual({ version: 'main', versionType: GitVersionType.Branch });
    expect(target).toEqual({ version: 'staging', versionType: GitVersionType.Branch });
  });

  it('does not use the baseVersion/targetVersion fields the sdk ignores', () => {
    const { base, target } = branchDiffDescriptors('main', 'staging');
    expect(base).not.toHaveProperty('baseVersion');
    expect(base).not.toHaveProperty('baseVersionType');
    expect(target).not.toHaveProperty('targetVersion');
    expect(target).not.toHaveProperty('targetVersionType');
  });

  it('makes the real sdk getCommitDiffs send both branches as query params', async () => {
    const { base, target } = branchDiffDescriptors('main', 'staging');
    const query = await captureQueryValues(async git => git.getCommitDiffs('repo', 'proj', true, 0, 0, base, target));
    expect(query).toMatchObject({
      baseVersion: 'main',
      baseVersionType: GitVersionType.Branch,
      targetVersion: 'staging',
      targetVersionType: GitVersionType.Branch,
    });
  });
});

describe('commitQueryCriteria', () => {
  it('puts branch in itemVersion when notInBranch is absent', () => {
    expect(commitQueryCriteria({ branch: 'staging' })).toEqual({
      itemVersion: { version: 'staging', versionType: GitVersionType.Branch },
    });
  });

  it('puts notInBranch in itemVersion and branch in compareVersion when notInBranch is given', () => {
    expect(commitQueryCriteria({ branch: 'staging', notInBranch: 'main' })).toEqual({
      itemVersion: { version: 'main', versionType: GitVersionType.Branch },
      compareVersion: { version: 'staging', versionType: GitVersionType.Branch },
    });
  });

  it('passes dates and author through unchanged', () => {
    expect(
      commitQueryCriteria({
        branch: 'develop',
        fromDate: '2026-09-01T00:00:00Z',
        toDate: '2026-09-24T00:00:00Z',
        author: 'Jane Doe',
      }),
    ).toEqual({
      itemVersion: { version: 'develop', versionType: GitVersionType.Branch },
      fromDate: '2026-09-01T00:00:00Z',
      toDate: '2026-09-24T00:00:00Z',
      author: 'Jane Doe',
    });
  });

  it('sends no version fields when neither branch is given', () => {
    expect(commitQueryCriteria({ author: 'Jane Doe' })).toEqual({ author: 'Jane Doe' });
  });

  it('makes the real sdk getCommits nest the range under searchCriteria', async () => {
    const criteria = commitQueryCriteria({ branch: 'staging', notInBranch: 'main' });
    const query = await captureQueryValues(async git => git.getCommits('repo', criteria, 'proj'));
    expect(query).toMatchObject({
      searchCriteria: {
        itemVersion: { version: 'main', versionType: GitVersionType.Branch },
        compareVersion: { version: 'staging', versionType: GitVersionType.Branch },
      },
    });
  });
});
