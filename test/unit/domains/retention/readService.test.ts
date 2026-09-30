import type { ReleaseDefinition, RetentionLease } from '../../../../src/ado/types.js';
import { describe, expect, it } from 'vitest';
import { RetentionReadService, shapeLease } from '../../../../src/domains/retention/readService.js';
import { FakeAdoClient } from '../../../fakes/FakeAdoClient.js';

const VALID_UNTIL = new Date('2026-12-31T00:00:00.000Z');

describe('shapeLease', () => {
  it('classifies well-known owner-id prefixes and falls back to \'other\'', () => {
    const leases: RetentionLease[] = [
      { leaseId: 1, ownerId: 'RM:3:12', validUntil: VALID_UNTIL },
      { leaseId: 2, ownerId: 'Pipeline:7', validUntil: VALID_UNTIL },
      { leaseId: 3, ownerId: 'Branch:repo:refs/heads/main', validUntil: VALID_UNTIL },
      { leaseId: 4, ownerId: 'User:1b2c…', validUntil: VALID_UNTIL },
      { leaseId: 5, ownerId: 'Something', validUntil: VALID_UNTIL },
    ];

    const shaped = leases.map(shapeLease);

    expect(shaped.map(lease => lease.ownerType)).toEqual([
      'RM',
      'Pipeline',
      'Branch',
      'User',
      'other',
    ]);
    for (const lease of shaped) {
      expect(lease.validUntil).toBe(VALID_UNTIL.toISOString());
      expect(lease.protectPipeline).toBe(false);
    }
  });

  it('defaults protectPipeline to false when absent and keeps it true when set', () => {
    expect(shapeLease({ leaseId: 1, ownerId: 'RM:1:1' }).protectPipeline).toBe(false);
    expect(shapeLease({ leaseId: 1, ownerId: 'RM:1:1', protectPipeline: true }).protectPipeline).toBe(true);
  });
});

describe('retentionReadService.listBuildLeases', () => {
  it('shapes each lease from the client', async () => {
    const fake = new FakeAdoClient();
    fake.setBuildLeases('P', 42, [
      { leaseId: 9, ownerId: 'Pipeline:7', definitionId: 7, runId: 42, validUntil: VALID_UNTIL },
    ]);
    const svc = new RetentionReadService(fake);

    const result = await svc.listBuildLeases({ project: 'P', buildId: 42 });

    expect(result).toEqual([
      {
        leaseId: 9,
        ownerId: 'Pipeline:7',
        ownerType: 'Pipeline',
        definitionId: 7,
        runId: 42,
        validUntil: VALID_UNTIL.toISOString(),
        protectPipeline: false,
        createdOn: undefined,
      },
    ]);
  });
});

describe('retentionReadService.findBuildRetainers', () => {
  it('finds release definitions that still reference the build definition as a Build artifact', async () => {
    const fake = new FakeAdoClient();
    const defs: ReleaseDefinition[] = [
      {
        id: 50,
        name: 'Deploy API',
        artifacts: [
          {
            type: 'Build',
            alias: '_api',
            isPrimary: true,
            definitionReference: { definition: { id: '7', name: 'api' } },
          },
        ],
      },
      {
        id: 76,
        name: 'Deploy Old',
        artifacts: [
          {
            type: 'Build',
            alias: '_old',
            definitionReference: { definition: { id: '7' } },
          },
          {
            type: 'Git',
            alias: '_src',
            definitionReference: { definition: { id: '7' } },
          },
        ],
      },
      {
        id: 80,
        name: 'Deploy Other',
        artifacts: [
          {
            type: 'Build',
            alias: '_other',
            definitionReference: { definition: { id: '8' } },
          },
        ],
      },
    ];
    fake.setReleaseDefinitionsWithArtifacts('P', defs);
    const svc = new RetentionReadService(fake);

    const result = await svc.findBuildRetainers({ project: 'P', buildDefinitionId: 7 });

    expect(result).toEqual([
      { releaseDefinitionId: 50, name: 'Deploy API', artifactAlias: '_api', isPrimary: true },
      { releaseDefinitionId: 76, name: 'Deploy Old', artifactAlias: '_old', isPrimary: false },
    ]);
  });
});
