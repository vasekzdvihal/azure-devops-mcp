import type {
  Build,
  BuildDefinition,
  Release,
  ReleaseApproval,
  ReleaseDefinition,
} from '../../../../src/ado/types.js';
import { describe, expect, it } from 'vitest';
import { ReleaseDefinitionSource } from '../../../../src/ado/types.js';
import { ReleasesWriteService } from '../../../../src/domains/releases/writeService.js';
import { FakeAdoClient } from '../../../fakes/FakeAdoClient.js';

function makeSvc() {
  const fake = new FakeAdoClient();
  const svc = new ReleasesWriteService(fake);
  return { svc, fake };
}

// Give a definition some named stages so the default (inert) create path can
// enumerate them for `manualEnvironments`.
function defWithStages(project: string, definitionId: number, fake: FakeAdoClient, names: string[]) {
  fake.setReleaseDefinition(project, definitionId, {
    id: definitionId,
    environments: names.map((name, i) => ({ id: i + 1, name })),
  } as unknown as ReleaseDefinition);
}

describe('releasesWriteService.createRelease', () => {
  it('forwards definitionId + description + variables', async () => {
    const { svc, fake } = makeSvc();
    defWithStages('p', 11, fake, ['Staging', 'Production']);
    fake.setNextCreatedRelease({ id: 5, name: 'Release-5', environments: [] } as unknown as Release);
    const result = await svc.createRelease({
      project: 'p',
      definitionId: 11,
      description: 'test run',
      variables: { ENV: { value: 'stg' } },
    });
    const call = fake.getCreatedReleases()[0]!;
    expect(call.project).toBe('p');
    expect(call.metadata.definitionId).toBe(11);
    expect(call.metadata.description).toBe('test run');
    expect(call.metadata.variables).toEqual({ ENV: { value: 'stg' } });
    expect(result.releaseId).toBe(5);
    expect(result.name).toBe('Release-5');
  });

  it('holds every stage as manual by default so creation deploys nothing', async () => {
    const { svc, fake } = makeSvc();
    defWithStages('p', 11, fake, ['Staging', 'Production']);
    fake.setNextCreatedRelease({ id: 10, name: 'Release-10', environments: [] } as unknown as Release);
    await svc.createRelease({ project: 'p', definitionId: 11 });
    expect(fake.getCreatedReleases()[0]!.metadata.manualEnvironments).toEqual([
      'Staging',
      'Production',
    ]);
  });

  it('autoDeploy:true honors the definition triggers (no manualEnvironments, no definition fetch)', async () => {
    const { svc, fake } = makeSvc();
    fake.setNextCreatedRelease({ id: 12, name: 'Release-12', environments: [] } as unknown as Release);
    // No definition configured — if the service fetched it, the fake would throw.
    await svc.createRelease({ project: 'p', definitionId: 11, autoDeploy: true });
    expect(fake.getCreatedReleases()[0]!.metadata.manualEnvironments).toBeUndefined();
  });

  it('shapes artifacts to { alias, instanceReference: { id, name } } using getBuild for the name', async () => {
    const { svc, fake } = makeSvc();
    defWithStages('p', 1, fake, ['Dev']);
    fake.setNextCreatedRelease({ id: 6, name: 'R6', environments: [] } as unknown as Release);
    fake.setNextBuild({ id: 100, buildNumber: '20260518.1' } as Build);
    await svc.createRelease({
      project: 'p',
      definitionId: 1,
      artifacts: [{ alias: 'drop', buildId: 100 }],
    });
    const sent = fake.getCreatedReleases()[0]!.metadata.artifacts!;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      alias: 'drop',
      instanceReference: { id: '100', name: '20260518.1' },
    });
  });

  it('omits artifacts entirely when not provided', async () => {
    const { svc, fake } = makeSvc();
    defWithStages('p', 1, fake, ['Dev']);
    fake.setNextCreatedRelease({ id: 1 } as unknown as Release);
    await svc.createRelease({ project: 'p', definitionId: 1 });
    expect(fake.getCreatedReleases()[0]!.metadata.artifacts).toBeUndefined();
  });

  it('maps environment status numbers to readable strings', async () => {
    const { svc, fake } = makeSvc();
    defWithStages('p', 1, fake, ['Dev', 'Prod']);
    fake.setNextCreatedRelease({
      id: 7,
      environments: [
        { id: 1, name: 'Dev', status: 1 }, // NotStarted
        { id: 2, name: 'Prod', status: 2 }, // InProgress (unrealistic at create time but exercises the map)
      ],
    } as unknown as Release);
    const result = await svc.createRelease({ project: 'p', definitionId: 1 });
    expect(result.environments[0]?.status).toBe('notStarted');
    expect(result.environments[1]?.status).toBe('inProgress');
  });
});

describe('releasesWriteService.deployStage', () => {
  it('resolves environmentName to environmentId via getRelease and sends status=inProgress', async () => {
    const { svc, fake } = makeSvc();
    // EnvironmentStatus.InProgress = 2 (verified from SDK ReleaseInterfaces.d.ts)
    fake.setRelease('p', 5, {
      id: 5,
      environments: [
        { id: 10, name: 'Dev' },
        { id: 20, name: 'Production' },
      ],
    } as unknown as Release);
    await svc.deployStage({
      project: 'p',
      releaseId: 5,
      environmentName: 'Production',
      comment: 'go',
    });
    const call = fake.getDeployedEnvironments()[0]!;
    expect(call.releaseId).toBe(5);
    expect(call.environmentId).toBe(20);
    expect(call.update.status).toBe(2); // EnvironmentStatus.InProgress
    expect(call.update.comment).toBe('go');
  });

  it('throws when environmentName not found', async () => {
    const { svc, fake } = makeSvc();
    fake.setRelease('p', 5, {
      id: 5,
      environments: [{ id: 10, name: 'Dev' }],
    } as unknown as Release);
    await expect(
      svc.deployStage({ project: 'p', releaseId: 5, environmentName: 'Production' }),
    ).rejects.toThrow(/Production/);
  });
});

describe('releasesWriteService.approveGate', () => {
  it('maps \'approved\' → ApprovalStatus enum and back', async () => {
    const { svc, fake } = makeSvc();
    // ApprovalStatus.Approved = 2 (verified from SDK ReleaseInterfaces.d.ts)
    fake.setNextUpdatedApproval({ id: 42, status: 2 } as ReleaseApproval);
    const result = await svc.approveGate({
      project: 'p',
      approvalId: 42,
      status: 'approved',
      comment: 'ok',
    });
    const call = fake.getApprovedGates()[0]!;
    expect(call.status).toBe('approved');
    expect(call.comment).toBe('ok');
    expect(result.approvalId).toBe(42);
    expect(result.status).toBe('approved');
  });

  it('maps \'rejected\' → ApprovalStatus enum and back', async () => {
    const { svc, fake } = makeSvc();
    // ApprovalStatus.Rejected = 4 (verified from SDK ReleaseInterfaces.d.ts)
    fake.setNextUpdatedApproval({ id: 1, status: 4 } as ReleaseApproval);
    const result = await svc.approveGate({ project: 'p', approvalId: 1, status: 'rejected' });
    expect(result.status).toBe('rejected');
  });
});

describe('releasesWriteService.cancelRelease', () => {
  it('calls client with project + releaseId + comment and returns shaped result', async () => {
    const { svc, fake } = makeSvc();
    // ReleaseStatus.Abandoned = 4 (verified from SDK ReleaseInterfaces.d.ts)
    fake.setNextCancelledRelease({ id: 9, status: 4, name: 'R9' } as unknown as Release);
    const result = await svc.cancelRelease({ project: 'p', releaseId: 9, comment: 'ship later' });
    expect(fake.getCancelledReleases()).toEqual([{ project: 'p', releaseId: 9, comment: 'ship later' }]);
    expect(result.releaseId).toBe(9);
    expect(result.status).toBe('abandoned');
  });
});

function makeReleaseDef(opts: {
  variables?: Record<string, { value?: string | null; isSecret?: boolean }>;
  environments?: Array<{ id: number; name: string; variables?: Record<string, { value?: string | null; isSecret?: boolean }> }>;
  revision?: number;
}): ReleaseDefinition {
  return {
    id: 99,
    name: 'release-def',
    revision: opts.revision ?? 3,
    variables: opts.variables,
    environments: opts.environments,
  } as ReleaseDefinition;
}

describe('releasesWriteService.updateVariables', () => {
  it('preserves existing secrets when updating an unrelated plain var (LOAD-BEARING)', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 99, makeReleaseDef({
      variables: {
        existingSecret: { isSecret: true, value: null },
        plainVar: { value: 'foo' },
      },
    }));

    await svc.updateVariables({
      project: 'p',
      definitionId: 99,
      set: { plainVar: { value: 'bar' } },
    });

    const sent = fake.getReleaseDefUpdates()[0]!.definition.variables!;
    expect(sent.existingSecret).toBeDefined();
    expect(sent.existingSecret.isSecret).toBe(true);
    expect(sent.plainVar.value).toBe('bar');
  });

  it('preserves isSecret:true when updating a secret without re-asserting', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 99, makeReleaseDef({
      variables: { token: { isSecret: true, value: null } },
    }));
    await svc.updateVariables({
      project: 'p',
      definitionId: 99,
      set: { token: { value: 'new' } },
    });
    const sent = fake.getReleaseDefUpdates()[0]!.definition.variables!;
    expect(sent.token.isSecret).toBe(true);
    expect(sent.token.value).toBe('new');
  });

  it('removes named variables', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 99, makeReleaseDef({
      variables: { keep: { value: 'k' }, drop: { value: 'd' } },
    }));
    await svc.updateVariables({ project: 'p', definitionId: 99, remove: ['drop'] });
    const sent = fake.getReleaseDefUpdates()[0]!.definition.variables!;
    expect(sent.keep).toBeDefined();
    expect(sent.drop).toBeUndefined();
  });

  it('round-trips revision', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 99, makeReleaseDef({ revision: 17, variables: { alpha: { value: '1' } } }));
    await svc.updateVariables({ project: 'p', definitionId: 99, set: { alpha: { value: '2' } } });
    expect(fake.getReleaseDefUpdates()[0]!.definition.revision).toBe(17);
  });

  it('throws when both set and remove are empty/missing', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 99, makeReleaseDef({ variables: {} }));
    await expect(svc.updateVariables({ project: 'p', definitionId: 99 })).rejects.toThrow(
      /at least one of set or remove/,
    );
  });
});

describe('releasesWriteService.updateEnvironmentVariables', () => {
  it('mutates only the target environment\'s variables (preserves others)', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 99, makeReleaseDef({
      environments: [
        { id: 1, name: 'Dev', variables: { devOnly: { value: 'd' } } },
        {
          id: 2,
          name: 'Prod',
          variables: {
            prodSecret: { isSecret: true, value: null },
            plainVar: { value: 'old' },
          },
        },
      ],
    }));

    await svc.updateEnvironmentVariables({
      project: 'p',
      definitionId: 99,
      environmentName: 'Prod',
      set: { plainVar: { value: 'new' } },
    });

    const sentDef = fake.getReleaseDefUpdates()[0]!.definition;
    const dev = sentDef.environments!.find(env => env.name === 'Dev')!;
    const prod = sentDef.environments!.find(env => env.name === 'Prod')!;
    // Dev's variables untouched.
    expect(dev.variables).toEqual({ devOnly: { value: 'd' } });
    // Prod's secret preserved, plain variable updated.
    expect(prod.variables!.prodSecret).toBeDefined();
    expect(prod.variables!.prodSecret.isSecret).toBe(true);
    expect(prod.variables!.plainVar.value).toBe('new');
  });

  it('matches the environment name case-insensitively', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 99, makeReleaseDef({
      environments: [{ id: 1, name: 'Production', variables: {} }],
    }));
    await svc.updateEnvironmentVariables({
      project: 'p',
      definitionId: 99,
      environmentName: 'PRODUCTION',
      set: { x: { value: '1' } },
    });
    expect(fake.getReleaseDefUpdates()).toHaveLength(1);
  });

  it('throws with the available environment list when the name doesn\'t match', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 99, makeReleaseDef({
      environments: [
        { id: 1, name: 'Dev', variables: {} },
        { id: 2, name: 'Prod', variables: {} },
      ],
    }));
    await expect(
      svc.updateEnvironmentVariables({
        project: 'p',
        definitionId: 99,
        environmentName: 'Staging',
        set: { x: { value: '1' } },
      }),
    ).rejects.toThrow(/Staging.*Dev, Prod/);
  });

  it('removes per-environment variables', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 99, makeReleaseDef({
      environments: [{ id: 1, name: 'Dev', variables: { keep: { value: 'k' }, drop: { value: 'd' } } }],
    }));
    await svc.updateEnvironmentVariables({
      project: 'p',
      definitionId: 99,
      environmentName: 'Dev',
      remove: ['drop'],
    });
    const env = fake.getReleaseDefUpdates()[0]!.definition.environments!.find(env => env.name === 'Dev')!;
    expect(env.variables!.keep).toBeDefined();
    expect(env.variables!.drop).toBeUndefined();
  });

  it('throws when both set and remove are empty/missing', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 99, makeReleaseDef({
      environments: [{ id: 1, name: 'Dev', variables: {} }],
    }));
    await expect(
      svc.updateEnvironmentVariables({
        project: 'p',
        definitionId: 99,
        environmentName: 'Dev',
      }),
    ).rejects.toThrow(/at least one of set or remove/);
  });
});

function sourceDefinition(): ReleaseDefinition {
  return {
    id: 42,
    revision: 3,
    name: 'Web - Prod',
    path: '\\Web',
    url: 'https://vsrm/x/definitions/42',
    variables: { ENV: { value: 'prod' }, KEY: { value: null as unknown as string, isSecret: true } },
    artifacts: [
      {
        alias: '_web-ci',
        type: 'Build',
        definitionReference: {
          definition: { id: '15', name: 'web-ci' },
          project: { id: 'p-guid', name: 'p' },
        },
      },
      {
        alias: '_assets',
        type: 'Build',
        definitionReference: {
          definition: { id: '16', name: 'assets-ci' },
          project: { id: 'p-guid', name: 'p' },
        },
      },
    ],
    environments: [
      { id: 101, name: 'Staging', rank: 1, deployStep: { id: 5 }, environmentTriggers: [{ definitionEnvironmentId: 101 }] },
      { id: 102, name: 'Production', rank: 2 },
    ],
  } as unknown as ReleaseDefinition;
}

describe('releasesWriteService.createDefinition', () => {
  it('clones the source under the new name with stripped ids and posts it', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 42, sourceDefinition());
    fake.setNextCreatedReleaseDef({
      id: 57,
      name: 'Web - Prod (copy)',
      path: '\\Web',
      url: 'https://vsrm/x/definitions/57',
      environments: [{ id: 1, name: 'Staging' }, { id: 2, name: 'Production' }],
      artifacts: [{ alias: '_web-ci', definitionReference: { definition: { id: '15', name: 'web-ci' } } }, { alias: '_assets', definitionReference: { definition: { id: '16', name: 'assets-ci' } } }],
    } as unknown as ReleaseDefinition);

    const result = await svc.createDefinition({
      project: 'p',
      cloneFromDefinitionId: 42,
      name: 'Web - Prod (copy)',
    });

    const posted = fake.getCreatedReleaseDefs()[0]!;
    expect(posted.project).toBe('p');
    expect(posted.definition.name).toBe('Web - Prod (copy)');
    expect(posted.definition.path).toBe('\\Web');
    expect(posted.definition).not.toHaveProperty('id');
    expect(posted.definition).not.toHaveProperty('revision');
    expect(posted.definition.source).toBe(ReleaseDefinitionSource.RestApi);
    expect(posted.definition.environments?.map(env => env.id)).toEqual([0, 0]);
    expect(posted.definition.environments?.[0]).not.toHaveProperty('deployStep');
    expect(posted.definition.environments?.[0]?.environmentTriggers).toEqual([]);
    // Untouched artifacts survive.
    expect(posted.definition.artifacts?.[1]?.definitionReference?.definition).toEqual({ id: '16', name: 'assets-ci' });

    expect(result).toEqual({
      definitionId: 57,
      name: 'Web - Prod (copy)',
      path: '\\Web',
      url: 'https://vsrm/x/definitions/57',
      environments: ['Staging', 'Production'],
      artifacts: [
        { alias: '_web-ci', sourcePipeline: 'web-ci' },
        { alias: '_assets', sourcePipeline: 'assets-ci' },
      ],
    });
  });

  it('applies description and path overrides', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 42, sourceDefinition());
    await svc.createDefinition({
      project: 'p',
      cloneFromDefinitionId: 42,
      name: 'X',
      description: 'cloned by test',
      path: '\\Experiments',
    });
    const posted = fake.getCreatedReleaseDefs()[0]!.definition;
    expect(posted.description).toBe('cloned by test');
    expect(posted.path).toBe('\\Experiments');
  });

  it('rebinds only the named artifact alias to another build definition, resolving its name', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 42, sourceDefinition());
    fake.setPipelineDefinition('p', 99, { id: 99, name: 'web-ci-v2' } as BuildDefinition);
    await svc.createDefinition({
      project: 'p',
      cloneFromDefinitionId: 42,
      name: 'X',
      artifactSources: [{ alias: '_web-ci', buildDefinitionId: 99 }],
    });
    const artifacts = fake.getCreatedReleaseDefs()[0]!.definition.artifacts ?? [];
    expect(artifacts[0]?.definitionReference?.definition).toEqual({ id: '99', name: 'web-ci-v2' });
    expect(artifacts[0]?.definitionReference?.project).toEqual({ id: 'p-guid', name: 'p' });
    expect(artifacts[0]?.type).toBe('Build');
    expect(artifacts[1]?.definitionReference?.definition).toEqual({ id: '16', name: 'assets-ci' });
  });

  it('rejects an unknown artifact alias and lists the valid ones without posting', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 42, sourceDefinition());
    await expect(
      svc.createDefinition({
        project: 'p',
        cloneFromDefinitionId: 42,
        name: 'X',
        artifactSources: [{ alias: '_nope', buildDefinitionId: 99 }],
      }),
    ).rejects.toThrow(/Artifact alias '_nope' not found on release definition 42\. Available: _web-ci, _assets/);
    expect(fake.getCreatedReleaseDefs()).toHaveLength(0);
  });

  it('merges variables over the clone and preserves an untouched secret', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 42, sourceDefinition());
    await svc.createDefinition({
      project: 'p',
      cloneFromDefinitionId: 42,
      name: 'X',
      variables: { ENV: { value: 'staging' }, NEW: { value: '1' } },
    });
    const vars = fake.getCreatedReleaseDefs()[0]!.definition.variables ?? {};
    expect(vars.ENV).toEqual({ value: 'staging', isSecret: false, allowOverride: undefined });
    expect(vars.NEW).toEqual({ value: '1', isSecret: false, allowOverride: undefined });
    expect(vars.KEY).toEqual({ value: null, isSecret: true });
  });

  it('propagates a missing source definition', async () => {
    const { svc, fake } = makeSvc();
    fake.injectError('getReleaseDefinition', new Error('not found'));
    await expect(
      svc.createDefinition({ project: 'p', cloneFromDefinitionId: 1, name: 'X' }),
    ).rejects.toThrow('not found');
  });
});

describe('releasesWriteService.deleteDefinition', () => {
  it('forwards ids, comment and forceDelete and reports deleted: true', async () => {
    const { svc, fake } = makeSvc();
    const result = await svc.deleteDefinition({
      project: 'p',
      definitionId: 42,
      comment: 'obsolete',
      forceDelete: true,
    });
    expect(fake.getDeletedReleaseDefs()).toEqual([
      { project: 'p', definitionId: 42, comment: 'obsolete', forceDelete: true },
    ]);
    expect(result).toEqual({ definitionId: 42, deleted: true });
  });

  it('defaults forceDelete to false', async () => {
    const { svc, fake } = makeSvc();
    await svc.deleteDefinition({ project: 'p', definitionId: 42 });
    expect(fake.getDeletedReleaseDefs()[0]?.forceDelete).toBe(false);
  });

  it('propagates client errors unchanged', async () => {
    const { svc, fake } = makeSvc();
    fake.injectError('deleteReleaseDefinition', new Error('boom'));
    await expect(svc.deleteDefinition({ project: 'p', definitionId: 42 })).rejects.toThrow('boom');
  });
});
