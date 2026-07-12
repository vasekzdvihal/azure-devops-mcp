import type {
  Deployment,
  Release,
  ReleaseApproval,
  ReleaseDefinition,
} from '../../../../src/ado/types.js';
import { describe, expect, it } from 'vitest';
import { ReleasesReadService } from '../../../../src/domains/releases/readService.js';
import { FakeAdoClient } from '../../../fakes/FakeAdoClient.js';

describe('releasesReadService.listDefinitions', () => {
  it('shapes release definitions to compact summaries', async () => {
    const fake = new FakeAdoClient();
    const defs: ReleaseDefinition[] = [
      {
        id: 1,
        name: 'Newton.n2-Deploy',
        path: '\\Newton',
        createdBy: { displayName: 'Alice', id: 'a1' },
        createdOn: new Date('2026-01-15T08:00:00Z'),
        modifiedOn: new Date('2026-04-01T14:00:00Z'),
      },
    ];
    fake.setReleaseDefinitions('MyProj', defs);
    const svc = new ReleasesReadService(fake);

    const result = await svc.listDefinitions({ project: 'MyProj' });

    expect(result).toEqual([
      {
        id: 1,
        name: 'Newton.n2-Deploy',
        path: '\\Newton',
        createdBy: 'Alice',
        createdOn: '2026-01-15T08:00:00.000Z',
        modifiedOn: '2026-04-01T14:00:00.000Z',
      },
    ]);
  });
});

describe('releasesReadService.getDefinition', () => {
  it('shapes a release definition with environments, approvals, artifacts and variables', async () => {
    const fake = new FakeAdoClient();
    const def: ReleaseDefinition = {
      id: 9,
      name: 'Newton.n2-Deploy',
      path: '\\Newton',
      description: 'Production release pipeline',
      releaseNameFormat: 'Release-$(rev:r)',
      createdBy: { displayName: 'Alice', id: 'a1' },
      modifiedBy: { displayName: 'Mallory', id: 'm1' },
      createdOn: new Date('2026-01-15T08:00:00Z'),
      modifiedOn: new Date('2026-04-01T14:00:00Z'),
      variables: {
        region: { value: 'westeurope', allowOverride: true },
        dbPassword: { isSecret: true, value: 'REDACTED' },
      },
      variableGroups: [42, 43],
      artifacts: [
        {
          alias: '_Newton.n2-CI',
          type: 'Build',
          sourceId: 'proj-guid:10',
          definitionReference: {
            definition: { id: '10', name: 'Newton.n2-CI' },
          },
        },
      ],
      triggers: [
        { triggerType: 1, artifactAlias: '_Newton.n2-CI' }, // ArtifactSource
        { triggerType: 2 }, // Schedule
      ] as unknown as ReleaseDefinition['triggers'],
      environments: [
        {
          id: 100,
          name: 'Dev',
          rank: 1,
          queueId: 5,
          // No approval entries → fully automated stage.
          preDeployApprovals: { approvals: [] },
          postDeployApprovals: { approvals: [{ isAutomated: true }] },
          deployPhases: [
            {
              workflowTasks: [
                { name: 'Download artifact', refName: 'download', enabled: true },
                { name: 'Run smoke tests', refName: 'smoke' },
              ],
            },
          ],
        } as unknown as ReleaseDefinition['environments'][number],
        {
          id: 200,
          name: 'Production',
          rank: 2,
          preDeployApprovals: {
            approvals: [
              { isAutomated: false, approver: { displayName: 'Carol' } },
              { isAutomated: false, approver: { displayName: 'Dan' } },
            ],
          },
          postDeployApprovals: { approvals: [] },
          deployPhases: [
            {
              workflowTasks: [
                { name: 'Deploy', enabled: true },
                { name: 'Notify', enabled: false },
              ],
            },
            { workflowTasks: [{ name: 'Smoke' }] },
          ],
        } as unknown as ReleaseDefinition['environments'][number],
      ] as ReleaseDefinition['environments'],
    };
    fake.setReleaseDefinition('MyProj', 9, def);
    const svc = new ReleasesReadService(fake);

    const result = await svc.getDefinition({ project: 'MyProj', definitionId: 9 });

    expect(result.id).toBe(9);
    expect(result.name).toBe('Newton.n2-Deploy');
    expect(result.modifiedBy).toBe('Mallory');
    expect(result.releaseNameFormat).toBe('Release-$(rev:r)');
    expect(result.variables).toEqual([
      { name: 'region', isSecret: false, allowOverride: true, value: 'westeurope' },
      { name: 'dbPassword', isSecret: true, allowOverride: false },
    ]);
    expect(result.variableGroupIds).toEqual([42, 43]);
    expect(result.artifacts).toEqual([
      {
        alias: '_Newton.n2-CI',
        type: 'Build',
        sourceId: 'proj-guid:10',
        sourceDefinitionId: '10',
        sourceDefinitionName: 'Newton.n2-CI',
      },
    ]);
    expect(result.triggers).toEqual([
      { type: 'artifactSource', artifactAlias: '_Newton.n2-CI' },
      { type: 'schedule' },
    ]);
    expect(result.environments).toEqual([
      {
        id: 100,
        name: 'Dev',
        rank: 1,
        queueId: 5,
        preApprovals: { isAutomated: true, approvers: [] },
        postApprovals: { isAutomated: true, approvers: [] },
        deployTaskCount: 2,
      },
      {
        id: 200,
        name: 'Production',
        rank: 2,
        queueId: undefined,
        preApprovals: { isAutomated: false, approvers: ['Carol', 'Dan'] },
        postApprovals: { isAutomated: true, approvers: [] },
        deployTaskCount: 3,
      },
    ]);
  });

  it('includes deploy task names when verbose=true', async () => {
    const fake = new FakeAdoClient();
    const def: ReleaseDefinition = {
      id: 9,
      name: 'Newton.n2-Deploy',
      environments: [
        {
          id: 100,
          name: 'Dev',
          preDeployApprovals: { approvals: [] },
          postDeployApprovals: { approvals: [] },
          deployPhases: [
            {
              workflowTasks: [
                { name: 'Deploy', refName: 'deploy', enabled: true },
                { name: 'Notify', refName: 'notify', enabled: false },
                { name: 'Smoke' }, // missing `enabled` → defaults to true
              ],
            },
          ],
        } as unknown as ReleaseDefinition['environments'][number],
      ] as ReleaseDefinition['environments'],
    };
    fake.setReleaseDefinition('MyProj', 9, def);
    const svc = new ReleasesReadService(fake);

    const result = await svc.getDefinition({
      project: 'MyProj',
      definitionId: 9,
      verbose: true,
    });

    expect(result.environments[0]?.deployTasks).toEqual([
      { displayName: 'Deploy', refName: 'deploy', enabled: true },
      { displayName: 'Notify', refName: 'notify', enabled: false },
      { displayName: 'Smoke', refName: undefined, enabled: true },
    ]);
  });
});

describe('releasesReadService.list', () => {
  it('maps enum status to ADO enum on the way in and string on the way out', async () => {
    const fake = new FakeAdoClient();
    const releases: Release[] = [
      {
        id: 1001,
        name: 'Release-42',
        status: 2, // active
        releaseDefinition: { id: 9, name: 'Newton.n2-Deploy' },
        createdBy: { displayName: 'Bob', id: 'b1' },
        createdOn: new Date('2026-04-20T09:00:00Z'),
        description: 'Scheduled deploy',
      },
    ];
    fake.setReleases('MyProj', releases);
    const svc = new ReleasesReadService(fake);

    const result = await svc.list({ project: 'MyProj', status: 'active', top: 10 });

    expect(result).toEqual([
      {
        id: 1001,
        name: 'Release-42',
        definitionId: 9,
        definitionName: 'Newton.n2-Deploy',
        status: 'active',
        createdBy: 'Bob',
        createdOn: '2026-04-20T09:00:00.000Z',
        description: 'Scheduled deploy',
      },
    ]);
  });
});

describe('releasesReadService.get', () => {
  it('returns stages + artifacts with flattened environment info', async () => {
    const fake = new FakeAdoClient();
    const release: Release = {
      id: 1001,
      name: 'Release-42',
      status: 2,
      releaseDefinition: { id: 9, name: 'Newton.n2-Deploy' },
      createdBy: { displayName: 'Bob', id: 'b1' },
      createdOn: new Date('2026-04-20T09:00:00Z'),
      description: 'Scheduled deploy',
      environments: [
        {
          name: 'Dev',
          status: 4, // succeeded
          postDeployApprovals: [],
          deploySteps: [
            {
              requestedBy: { displayName: 'Bob' },
              lastModifiedOn: new Date('2026-04-20T09:15:00Z'),
            },
          ],
        },
        {
          name: 'Production',
          status: 4,
          deploySteps: [
            {
              requestedBy: { displayName: 'Carol' },
              lastModifiedOn: new Date('2026-04-20T10:00:00Z'),
            },
          ],
        },
      ],
      artifacts: [
        {
          alias: '_Newton.n2-CI',
          definitionReference: {
            version: { id: '12345', name: '20260420.1' },
            branch: { id: 'refs/heads/main', name: 'main' },
          },
        },
      ],
    };
    fake.setRelease('MyProj', 1001, release);
    const svc = new ReleasesReadService(fake);

    const result = await svc.get({ project: 'MyProj', releaseId: 1001 });

    expect(result.id).toBe(1001);
    expect(result.name).toBe('Release-42');
    expect(result.stages).toEqual([
      {
        environmentName: 'Dev',
        status: 'succeeded',
        deploymentStatus: undefined,
        deployedBy: 'Bob',
        completedOn: '2026-04-20T09:15:00.000Z',
      },
      {
        environmentName: 'Production',
        status: 'succeeded',
        deploymentStatus: undefined,
        deployedBy: 'Carol',
        completedOn: '2026-04-20T10:00:00.000Z',
      },
    ]);
    expect(result.artifacts).toEqual([
      {
        alias: '_Newton.n2-CI',
        sourceBuildId: '12345',
        sourceBranch: 'refs/heads/main',
        sourceVersion: undefined,
      },
    ]);
  });
});

describe('releasesReadService.get — pending stage', () => {
  it('maps EnvironmentStatus 1 to \'notStarted\'', async () => {
    const fake = new FakeAdoClient();
    const release: Release = {
      id: 9999,
      name: 'Pending-Release',
      status: 2,
      releaseDefinition: { id: 9 },
      environments: [{ name: 'Dev', status: 1 }],
      artifacts: [],
    };
    fake.setRelease('MyProj', 9999, release);
    const svc = new ReleasesReadService(fake);

    const result = await svc.get({ project: 'MyProj', releaseId: 9999 });

    expect(result.stages[0]?.status).toBe('notStarted');
  });
});

describe('releasesReadService.listDeployments', () => {
  it('flattens deployment entries and passes status filter through', async () => {
    const fake = new FakeAdoClient();
    const deployments: Deployment[] = [
      {
        id: 5001,
        deploymentStatus: 4, // succeeded
        release: {
          id: 1001,
          name: 'Release-42',
          artifacts: [
            {
              definitionReference: {
                version: { id: '12345', name: '20260420.1' },
                branch: { id: 'refs/heads/main', name: 'main' },
              },
            },
          ],
        },
        releaseDefinition: { id: 9, name: 'Newton.n2-Deploy' },
        releaseEnvironment: { id: 2, name: 'Production' },
        requestedBy: { displayName: 'Carol', id: 'c1' },
        requestedFor: { displayName: 'Carol', id: 'c1' },
        queuedOn: new Date('2026-04-20T09:55:00Z'),
        startedOn: new Date('2026-04-20T09:56:00Z'),
        completedOn: new Date('2026-04-20T10:00:00Z'),
      },
    ];
    fake.setDeployments('MyProj', deployments);
    const svc = new ReleasesReadService(fake);

    const result = await svc.listDeployments({
      project: 'MyProj',
      status: 'succeeded',
      top: 10,
    });

    expect(result).toEqual([
      {
        deploymentId: 5001,
        releaseId: 1001,
        releaseName: 'Release-42',
        definitionId: 9,
        definitionName: 'Newton.n2-Deploy',
        environmentName: 'Production',
        status: 'succeeded',
        requestedBy: 'Carol',
        requestedOn: '2026-04-20T09:55:00.000Z',
        startedOn: '2026-04-20T09:56:00.000Z',
        completedOn: '2026-04-20T10:00:00.000Z',
        sourceBuildId: '12345',
        sourceBranch: 'refs/heads/main',
        sourceVersion: undefined,
      },
    ]);
  });

  it('filters by environmentName case-insensitively client-side', async () => {
    const fake = new FakeAdoClient();
    const deployments: Deployment[] = [
      {
        id: 1,
        deploymentStatus: 4,
        release: { id: 100, name: 'R1' },
        releaseEnvironment: { name: 'Dev' },
      },
      {
        id: 2,
        deploymentStatus: 4,
        release: { id: 100, name: 'R1' },
        releaseEnvironment: { name: 'Production' },
      },
      {
        id: 3,
        deploymentStatus: 4,
        release: { id: 101, name: 'R2' },
        releaseEnvironment: { name: 'production' }, // lowercase variant
      },
    ];
    fake.setDeployments('MyProj', deployments);
    const svc = new ReleasesReadService(fake);

    const result = await svc.listDeployments({
      project: 'MyProj',
      environmentName: 'PRODUCTION',
    });

    expect(result.map(deployment => deployment.deploymentId)).toEqual([2, 3]);
  });
});

describe('releasesReadService.listPendingApprovals', () => {
  it('returns shaped approval list filtered by project', async () => {
    const fake = new FakeAdoClient();
    const svc = new ReleasesReadService(fake);
    fake.setPendingApprovals({ project: 'p' }, [
      {
        id: 1,
        release: { id: 10, name: 'R10' },
        releaseEnvironment: { id: 20, name: 'Prod' },
        approver: { displayName: 'Alice' },
        createdOn: new Date('2026-05-18T10:00:00Z'),
      } as unknown as ReleaseApproval,
    ]);
    const result = await svc.listPendingApprovals({ project: 'p' });
    expect(result).toEqual([
      {
        approvalId: 1,
        releaseId: 10,
        releaseName: 'R10',
        environmentName: 'Prod',
        approver: 'Alice',
        createdOn: '2026-05-18T10:00:00.000Z',
      },
    ]);
  });

  it('forwards releaseId + assignedTo to the client', async () => {
    const fake = new FakeAdoClient();
    const svc = new ReleasesReadService(fake);
    fake.setPendingApprovals({ project: 'p', releaseId: 5 }, []);
    await svc.listPendingApprovals({ project: 'p', releaseId: 5, assignedTo: 'Alice' });
    expect(fake.getPendingApprovalsCalls()).toEqual([
      { project: 'p', releaseId: 5, assignedTo: 'Alice' },
    ]);
  });

  it('handles missing approver gracefully', async () => {
    const fake = new FakeAdoClient();
    const svc = new ReleasesReadService(fake);
    fake.setPendingApprovals({ project: 'p' }, [
      {
        id: 99,
        release: { id: 7, name: 'R7' },
        releaseEnvironment: { id: 1, name: 'Stage' },
        // no approver, no createdOn
      } as unknown as ReleaseApproval,
    ]);
    const result = await svc.listPendingApprovals({ project: 'p' });
    expect(result[0]?.approver).toBeNull();
    expect(result[0]?.createdOn).toBeNull();
  });
});
