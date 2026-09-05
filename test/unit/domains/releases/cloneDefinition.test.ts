import type { ReleaseDefinition } from '../../../../src/ado/types.js';
import { describe, expect, it } from 'vitest';
import { ReleaseDefinitionSource } from '../../../../src/ado/types.js';
import { stripForClone } from '../../../../src/domains/releases/cloneDefinition.js';

// A definition with every server-owned field populated, so each strip rule has something
// to remove. Deploy phases / tasks / queue ids are the "must survive" payload.
function fixture(): ReleaseDefinition {
  return {
    id: 42,
    revision: 7,
    name: 'Web - Prod',
    path: '\\Web',
    url: 'https://vsrm/x/definitions/42',
    _links: { self: { href: 'https://vsrm/x/definitions/42' } },
    createdBy: { id: 'u1', displayName: 'Someone' },
    createdOn: new Date('2026-01-01T00:00:00Z'),
    modifiedBy: { id: 'u2', displayName: 'Else' },
    modifiedOn: new Date('2026-02-01T00:00:00Z'),
    lastRelease: { id: 900, name: 'Release-900' },
    isDeleted: false,
    comment: 'last edit',
    source: ReleaseDefinitionSource.UserInterface,
    releaseNameFormat: 'Release-$(rev:r)',
    tags: ['web'],
    properties: {},
    variables: { ENV: { value: 'prod' }, KEY: { value: null as unknown as string, isSecret: true } },
    variableGroups: [3],
    triggers: [
      { triggerType: 1, artifactAlias: '_web-ci' } as never,
      { triggerType: 2, schedule: { daysToRelease: 31, jobId: 'sched-job-guid', startHours: 2, startMinutes: 0, timeZoneId: 'UTC' } } as never,
    ],
    artifacts: [
      {
        alias: '_web-ci',
        type: 'Build',
        isPrimary: true,
        definitionReference: {
          definition: { id: '15', name: 'web-ci' },
          project: { id: 'p-guid', name: 'Proj' },
        },
      },
    ],
    environments: [
      {
        id: 101,
        name: 'Staging',
        rank: 1,
        owner: { id: 'u1', displayName: 'Someone' },
        badgeUrl: 'https://vsrm/badge/101',
        currentRelease: { id: 900 },
        deployStep: { id: 555, tasks: [] },
        preDeployApprovals: {
          approvals: [{ id: 201, rank: 1, isAutomated: true }],
          approvalOptions: { requiredApproverCount: 0 },
        },
        postDeployApprovals: {
          approvals: [{ id: 202, rank: 1, isAutomated: false, approver: { id: 'u3' } }],
        },
        preDeploymentGates: { id: 301, gates: [] },
        postDeploymentGates: { id: 302, gates: [] },
        environmentTriggers: [
          { definitionEnvironmentId: 101, releaseDefinitionId: 42, triggerType: 1, triggerContent: '{}' },
        ],
        conditions: [{ name: 'ReleaseStarted', conditionType: 1, value: '' }],
        deployPhases: [
          {
            rank: 1,
            phaseType: 1,
            name: 'Run on agent',
            deploymentInput: { queueId: 15, condition: 'succeeded()' },
            workflowTasks: [
              { taskId: 't-guid', version: '1.*', name: 'Deploy', enabled: true, inputs: { arg: 'b' } },
            ],
          } as never,
        ],
        retentionPolicy: { daysToKeep: 30, releasesToKeep: 3, retainBuild: true },
        executionPolicy: { concurrencyCount: 1, queueDepthCount: 0 },
        environmentOptions: { emailNotificationType: 'OnlyOnFailure' } as never,
        demands: [],
        schedules: [{ daysToRelease: 1, jobId: 'job-guid', startHours: 3, startMinutes: 0, timeZoneId: 'UTC' }],
        properties: {},
        variables: { REGION: { value: 'eu' } },
        variableGroups: [4],
      },
      {
        id: 102,
        name: 'Production',
        rank: 2,
        owner: { id: 'u1' },
        preDeployApprovals: { approvals: [{ id: 203, rank: 1, isAutomated: false, approver: { id: 'u3' } }] },
        postDeployApprovals: { approvals: [{ id: 204, rank: 1, isAutomated: true }] },
        conditions: [{ name: 'Staging', conditionType: 2, value: '4' }],
        deployPhases: [],
        environmentTriggers: [],
      },
    ],
  } as unknown as ReleaseDefinition;
}

describe('stripForClone — top level', () => {
  it('removes id, revision, url, _links, audit fields, lastRelease, isDeleted, comment', () => {
    const out = stripForClone(fixture()) as Record<string, unknown>;
    for (const key of ['id', 'revision', 'url', '_links', 'createdBy', 'createdOn', 'modifiedBy', 'modifiedOn', 'lastRelease', 'isDeleted', 'comment']) {
      expect(out, key).not.toHaveProperty(key);
    }
  });

  it('sets source to RestApi', () => {
    expect(stripForClone(fixture()).source).toBe(ReleaseDefinitionSource.RestApi);
  });

  it('keeps name, path, triggers, artifacts, variables, variableGroups, releaseNameFormat, tags, properties byte-for-byte', () => {
    const input = fixture();
    const out = stripForClone(input);
    expect(out.name).toBe(input.name);
    expect(out.path).toBe(input.path);
    expect(out.triggers?.[0]).toEqual(input.triggers?.[0]);
    expect(out.artifacts).toEqual(input.artifacts);
    expect(out.variables).toEqual(input.variables);
    expect(out.variableGroups).toEqual(input.variableGroups);
    expect(out.releaseNameFormat).toBe(input.releaseNameFormat);
    expect(out.tags).toEqual(input.tags);
    expect(out.properties).toEqual(input.properties);
  });

  it('does not mutate its input', () => {
    const input = fixture();
    const snapshot = JSON.stringify(input);
    stripForClone(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('removes jobId from a scheduled release trigger but keeps the trigger and its schedule', () => {
    const triggers = stripForClone(fixture()).triggers ?? [];
    expect(triggers).toHaveLength(2);
    expect(triggers[0]).toEqual({ triggerType: 1, artifactAlias: '_web-ci' });
    const scheduled = triggers[1] as { triggerType: number; schedule: Record<string, unknown> };
    expect(scheduled.triggerType).toBe(2);
    expect(scheduled.schedule).not.toHaveProperty('jobId');
    expect(scheduled.schedule).toMatchObject({ daysToRelease: 31, startHours: 2, timeZoneId: 'UTC' });
  });
});

describe('stripForClone — per environment', () => {
  it('sets environment id to 0', () => {
    const envs = stripForClone(fixture()).environments ?? [];
    expect(envs.map(env => env.id)).toEqual([0, 0]);
  });

  it('sets every approval id and gate-step id to 0', () => {
    const [staging] = stripForClone(fixture()).environments ?? [];
    // Non-null assertions (not optional chaining) here: the fixture guarantees these blocks
    // exist, and eslint's complexity rule counts `?.`/`??` as branches, not `!`.
    expect(staging!.preDeployApprovals!.approvals!.map(approval => approval.id)).toEqual([0]);
    expect(staging!.postDeployApprovals!.approvals!.map(approval => approval.id)).toEqual([0]);
    expect(staging!.preDeploymentGates!.id).toBe(0);
    expect(staging!.postDeploymentGates!.id).toBe(0);
  });

  it('removes badgeUrl, currentRelease, deployStep', () => {
    const [staging] = stripForClone(fixture()).environments ?? [];
    const env = staging as Record<string, unknown>;
    expect(env).not.toHaveProperty('badgeUrl');
    expect(env).not.toHaveProperty('currentRelease');
    expect(env).not.toHaveProperty('deployStep');
  });

  it('empties environmentTriggers', () => {
    const envs = stripForClone(fixture()).environments ?? [];
    expect(envs.map(env => env.environmentTriggers)).toEqual([[], []]);
  });

  it('keeps rank, owner, name, variables, variableGroups, conditions, policies, options, demands, properties', () => {
    const [inStaging] = fixture().environments ?? [];
    const [outStaging] = stripForClone(fixture()).environments ?? [];
    for (const key of ['rank', 'owner', 'name', 'variables', 'variableGroups', 'conditions', 'retentionPolicy', 'executionPolicy', 'environmentOptions', 'demands', 'properties'] as const) {
      expect(outStaging?.[key], key).toEqual(inStaging?.[key]);
    }
  });

  it('removes the server-assigned jobId from each schedule but keeps the schedule', () => {
    const [staging] = stripForClone(fixture()).environments ?? [];
    expect(staging?.schedules).toHaveLength(1);
    expect(staging?.schedules?.[0]).not.toHaveProperty('jobId');
    expect(staging?.schedules?.[0]).toMatchObject({ daysToRelease: 1, startHours: 3, timeZoneId: 'UTC' });
  });

  it('keeps deployPhases including queueId and workflowTasks byte-for-byte', () => {
    const [inStaging] = fixture().environments ?? [];
    const [outStaging] = stripForClone(fixture()).environments ?? [];
    expect(outStaging?.deployPhases).toEqual(inStaging?.deployPhases);
  });

  it('keeps approval options and approver identities while zeroing ids', () => {
    const [staging] = stripForClone(fixture()).environments ?? [];
    expect(staging?.preDeployApprovals?.approvalOptions).toEqual({ requiredApproverCount: 0 });
    expect(staging?.postDeployApprovals?.approvals?.[0]?.approver).toEqual({ id: 'u3' });
  });

  it('tolerates environments with missing optional blocks', () => {
    const def = { name: 'x', environments: [{ id: 5, name: 'Only' }] } as unknown as ReleaseDefinition;
    const out = stripForClone(def);
    expect(out.environments?.[0]).toEqual({ id: 0, name: 'Only', environmentTriggers: [] });
  });
});
