import type { RetentionLease } from '../../../../src/ado/types.js';
import { describe, expect, it } from 'vitest';
import { RetentionWriteService } from '../../../../src/domains/retention/writeService.js';
import { FakeAdoClient } from '../../../fakes/FakeAdoClient.js';

describe('retentionWriteService.deleteBuildLease', () => {
  it('deletes a non-protecting lease and returns it shaped', async () => {
    const fake = new FakeAdoClient();
    fake.setBuildLeases('P', 500, [
      { leaseId: 11, ownerId: 'User:abc', protectPipeline: false },
    ]);
    const svc = new RetentionWriteService(fake);

    const result = await svc.deleteBuildLease({ project: 'P', buildId: 500, leaseId: 11 });

    expect(result).toEqual({
      deleted: true,
      lease: {
        leaseId: 11,
        ownerId: 'User:abc',
        ownerType: 'User',
        definitionId: undefined,
        runId: undefined,
        validUntil: undefined,
        protectPipeline: false,
        createdOn: undefined,
      },
    });
    expect(fake.getDeletedLeaseIds()).toEqual([11]);
  });

  it('rejects when the lease id is not on the given build and deletes nothing', async () => {
    const fake = new FakeAdoClient();
    fake.setBuildLeases('P', 500, [
      { leaseId: 11, ownerId: 'User:abc', protectPipeline: false },
    ]);
    const svc = new RetentionWriteService(fake);

    await expect(
      svc.deleteBuildLease({ project: 'P', buildId: 500, leaseId: 99 }),
    ).rejects.toThrow(/lease 99 is not on build 500/);
    expect(fake.getDeletedLeaseIds()).toEqual([]);
  });

  it('refuses a pipeline-protecting lease without force and deletes nothing', async () => {
    const fake = new FakeAdoClient();
    fake.setBuildLeases('P', 500, [
      { leaseId: 12, ownerId: 'Pipeline:7', protectPipeline: true },
    ]);
    const svc = new RetentionWriteService(fake);

    await expect(
      svc.deleteBuildLease({ project: 'P', buildId: 500, leaseId: 12 }),
    ).rejects.toThrow(/protects the pipeline.*Pipeline:7.*force: true/);
    expect(fake.getDeletedLeaseIds()).toEqual([]);
  });

  it('deletes a pipeline-protecting lease when force is true', async () => {
    const fake = new FakeAdoClient();
    fake.setBuildLeases('P', 500, [
      { leaseId: 12, ownerId: 'Pipeline:7', protectPipeline: true },
    ]);
    const svc = new RetentionWriteService(fake);

    const result = await svc.deleteBuildLease({
      project: 'P',
      buildId: 500,
      leaseId: 12,
      force: true,
    });

    expect(result.deleted).toBe(true);
    expect(result.lease.leaseId).toBe(12);
    expect(fake.getDeletedLeaseIds()).toEqual([12]);
  });

  it('refuses to delete a matched lease with no real ADO lease id and deletes nothing', async () => {
    const fake = new FakeAdoClient();
    // shapeLease maps a missing leaseId to 0 — the write service must not forward that to the wire.
    fake.setBuildLeases('P', 500, [
      { ownerId: 'User:zero', protectPipeline: false } as RetentionLease,
    ]);
    const svc = new RetentionWriteService(fake);

    await expect(
      svc.deleteBuildLease({ project: 'P', buildId: 500, leaseId: 0 }),
    ).rejects.toThrow(/no id returned by Azure DevOps/);
    expect(fake.getDeletedLeaseIds()).toEqual([]);
  });

  it('fails closed on a raw lease with protectPipeline omitted entirely, without force', async () => {
    const fake = new FakeAdoClient();
    // No `protectPipeline` field at all — shapeLease would shape this to `false`, but the write
    // service must decide from the raw lease and treat "unknown" the same as "protected".
    fake.setBuildLeases('P', 500, [
      { leaseId: 13, ownerId: 'Branch:repo:refs/heads/main' } as RetentionLease,
    ]);
    const svc = new RetentionWriteService(fake);

    await expect(
      svc.deleteBuildLease({ project: 'P', buildId: 500, leaseId: 13 }),
    ).rejects.toThrow(/protects the pipeline/);
    expect(fake.getDeletedLeaseIds()).toEqual([]);
  });

  it('deletes a raw lease with protectPipeline omitted entirely when force is true', async () => {
    const fake = new FakeAdoClient();
    fake.setBuildLeases('P', 500, [
      { leaseId: 13, ownerId: 'Branch:repo:refs/heads/main' } as RetentionLease,
    ]);
    const svc = new RetentionWriteService(fake);

    const result = await svc.deleteBuildLease({
      project: 'P',
      buildId: 500,
      leaseId: 13,
      force: true,
    });

    expect(result.deleted).toBe(true);
    expect(result.lease.leaseId).toBe(13);
    expect(fake.getDeletedLeaseIds()).toEqual([13]);
  });
});
