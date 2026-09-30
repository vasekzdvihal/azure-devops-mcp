import { describe, expect, it } from 'vitest';
import { CommitsWriteService } from '../../../../src/domains/commits/writeService.js';
import { FakeAdoClient } from '../../../fakes/FakeAdoClient.js';

const REPO = { project: 'P', repo: 'R' };
const ZERO = '0'.repeat(40);
const SHA = 'a'.repeat(40);

describe('commitsWriteService.createBranch', () => {
  it('resolves `from` branch to its head sha and creates refs/heads/<name>', async () => {
    const fake = new FakeAdoClient();
    fake.setBranches(REPO.project, REPO.repo, [{ name: 'master', commit: { commitId: SHA } }]);
    fake.setNextRefUpdateResults([{ name: 'refs/heads/main', success: true, updateStatus: 0, newObjectId: SHA }]);
    const svc = new CommitsWriteService(fake, async () => REPO);
    const result = await svc.createBranch({ name: 'refs/heads/main', from: 'master' });
    expect(fake.getRefUpdateCalls()).toEqual([{
      project: 'P',
      repository: 'R',
      updates: [{ name: 'refs/heads/main', oldObjectId: ZERO, newObjectId: SHA }],
    }]);
    expect(result).toEqual({ name: 'main', objectId: SHA });
  });

  it('uses a 40-hex `from` as the sha without a branch lookup', async () => {
    const fake = new FakeAdoClient();
    fake.setNextRefUpdateResults([{ success: true, updateStatus: 0 }]);
    const svc = new CommitsWriteService(fake, async () => REPO);
    await svc.createBranch({ name: 'main', from: SHA.toUpperCase() });
    expect(fake.getRefUpdateCalls()[0]?.updates[0]?.newObjectId).toBe(SHA);
  });

  it('throws when the source branch does not exist', async () => {
    const svc = new CommitsWriteService(new FakeAdoClient(), async () => REPO);
    await expect(svc.createBranch({ name: 'main', from: 'nope' })).rejects.toThrow(/source branch 'nope' not found/);
  });

  it('throws when updateRefs reports success:false with HTTP 200', async () => {
    const fake = new FakeAdoClient();
    fake.setNextRefUpdateResults([{ success: false, updateStatus: 12 /* RefNameConflict */, customMessage: 'exists' }]);
    const svc = new CommitsWriteService(fake, async () => REPO);
    await expect(svc.createBranch({ name: 'main', from: SHA })).rejects.toThrow(
      'create_branch: Azure DevOps rejected creating \'main\' (refNameConflict): exists.',
    );
  });
});
