import type { AdoClient } from '../../ado/client.js';
import type {
  Artifact,
  ConfigurationVariableValue,
  ReleaseDefinitionEnvironment,
  ReleaseEnvironmentUpdateMetadata,
  ReleaseStartMetadata,
} from '../../ado/types.js';
import { stripForClone } from './cloneDefinition.js';

// Reverse-mapping tables — VALUES verified against SDK ReleaseInterfaces.d.ts.
//
// ReleaseStatus: Undefined=0, Draft=1, Active=2, Abandoned=4
// ApprovalStatus: Undefined=0, Pending=1, Approved=2, Rejected=4, Reassigned=6, Canceled=7, Skipped=8
// EnvironmentStatus: Undefined=0, NotStarted=1, InProgress=2, Succeeded=4, Canceled=8, Rejected=16,
//                    Queued=32, Scheduled=64, PartiallySucceeded=128

const RELEASE_STATUS_FROM_ENUM: Record<number, string> = {
  0: 'undefined',
  1: 'draft',
  2: 'active',
  4: 'abandoned',
};

const APPROVAL_STATUS_FROM_ENUM: Record<number, string> = {
  0: 'undefined',
  1: 'pending',
  2: 'approved',
  4: 'rejected',
  6: 'reassigned',
  7: 'canceled',
  8: 'skipped',
};

const ENVIRONMENT_STATUS_FROM_ENUM: Record<number, string> = {
  0: 'undefined',
  1: 'notStarted',
  2: 'inProgress',
  4: 'succeeded',
  8: 'canceled',
  16: 'rejected',
  32: 'queued',
  64: 'scheduled',
  128: 'partiallySucceeded',
};

export interface ReleaseVariableInput {
  value: string;
  isSecret?: boolean;
  allowOverride?: boolean;
}

export interface UpdateReleaseVariablesResult {
  definitionId: number;
  variables: Record<string, { value: string | null; isSecret: boolean }>;
}

function mergeReleaseVariable(
  prev: ConfigurationVariableValue | undefined,
  value: ReleaseVariableInput,
): ConfigurationVariableValue {
  return {
    value: value.value,
    isSecret: value.isSecret ?? prev?.isSecret ?? false,
    allowOverride: value.allowOverride ?? prev?.allowOverride,
  };
}

function mergeReleaseVariables(
  existing: Record<string, ConfigurationVariableValue> | undefined,
  setOps: Record<string, ReleaseVariableInput> | undefined,
  removeOps: string[] | undefined,
): Record<string, ConfigurationVariableValue> {
  const merged: Record<string, ConfigurationVariableValue> = { ...(existing ?? {}) };
  for (const name of removeOps ?? []) {
    delete merged[name];
  }
  for (const [name, value] of Object.entries(setOps ?? {})) {
    merged[name] = mergeReleaseVariable(merged[name], value);
  }
  return merged;
}

function findDefinitionEnvironment(
  envs: ReleaseDefinitionEnvironment[],
  environmentName: string,
  definitionId: number,
): ReleaseDefinitionEnvironment & { id: number } {
  const target = envs.find(
    env => env.name?.toLowerCase() === environmentName.toLowerCase(),
  );
  if (!target || typeof target.id !== 'number') {
    const available = envs.map(env => env.name).filter(Boolean).join(', ');
    throw new Error(
      `Environment '${environmentName}' not found on release definition ${definitionId}. `
      + `Available: ${available || '(none)'}`,
    );
  }
  // The typeof check above narrows id, but TS can't carry that through `target`.
  return target as ReleaseDefinitionEnvironment & { id: number };
}

function findArtifactByAlias(
  artifacts: Artifact[],
  alias: string,
  definitionId: number,
): Artifact {
  const target = artifacts.find(artifact => artifact.alias === alias);
  if (!target) {
    const available = artifacts.map(artifact => artifact.alias).filter(Boolean).join(', ');
    throw new Error(
      `Artifact alias '${alias}' not found on release definition ${definitionId}. `
      + `Available: ${available || '(none)'}`,
    );
  }
  return target;
}

// Rebinds named artifact aliases to different build pipelines, resolving each pipeline's name
// via the ADO API. Validates every alias up front so an unknown alias fails fast without
// leaving a partial rewrite behind.
async function rebindArtifacts(args: {
  client: AdoClient;
  project: string;
  cloneFromDefinitionId: number;
  artifacts: Artifact[];
  overrides: { alias: string; buildDefinitionId: number }[];
}): Promise<void> {
  const { client, project, cloneFromDefinitionId, artifacts, overrides } = args;
  for (const override of overrides) {
    findArtifactByAlias(artifacts, override.alias, cloneFromDefinitionId);
  }
  for (const override of overrides) {
    const artifact = findArtifactByAlias(artifacts, override.alias, cloneFromDefinitionId);
    const buildDef = await client.getPipelineDefinition({
      project,
      definitionId: override.buildDefinitionId,
    });
    artifact.definitionReference = {
      ...(artifact.definitionReference ?? {}),
      definition: {
        id: String(override.buildDefinitionId),
        name: buildDef.name ?? String(override.buildDefinitionId),
      },
    };
  }
}

function projectReleaseVariables(
  vars: Record<string, ConfigurationVariableValue> | undefined,
): Record<string, { value: string | null; isSecret: boolean }> {
  const out: Record<string, { value: string | null; isSecret: boolean }> = {};
  for (const [name, value] of Object.entries(vars ?? {})) {
    out[name] = {
      value: value.isSecret ? null : (value.value ?? null),
      isSecret: !!value.isSecret,
    };
  }
  return out;
}

export interface CreateReleaseResult {
  releaseId: number;
  name?: string;
  environments: { id: number; name: string; status?: string }[];
}

export interface DeployStageResult {
  releaseId: number;
  environmentId: number;
  environmentName: string;
}

export interface ApproveGateResult {
  approvalId: number;
  status: string;
}

export interface CancelReleaseResult {
  releaseId: number;
  status: string;
}

export interface CreateReleaseDefinitionResult {
  definitionId: number;
  name: string;
  path?: string;
  url?: string;
  environments: string[];
  artifacts: Array<{ alias: string; sourcePipeline?: string }>;
}

export interface DeleteReleaseDefinitionResult {
  definitionId: number;
  deleted: true;
}

export class ReleasesWriteService {
  constructor(private readonly client: AdoClient) {}

  async createRelease(args: {
    project: string;
    definitionId: number;
    description?: string;
    artifacts?: { alias: string; buildId: number }[];
    variables?: Record<string, { value: string; isSecret?: boolean }>;
    autoDeploy?: boolean;
  }): Promise<CreateReleaseResult> {
    let shapedArtifacts: ReleaseStartMetadata['artifacts'] | undefined;
    if (args.artifacts && args.artifacts.length > 0) {
      shapedArtifacts = [];
      for (const artifact of args.artifacts) {
        const build = await this.client.getBuild({
          project: args.project,
          buildId: artifact.buildId,
        });
        shapedArtifacts.push({
          alias: artifact.alias,
          instanceReference: {
            id: String(artifact.buildId),
            name: build.buildNumber ?? String(artifact.buildId),
          },
        });
      }
    }

    // Safety: creation is inert by default. Without this, a definition whose stages carry a
    // "ReleaseStarted" trigger deploys — potentially to Production — the instant the release is
    // created, which contradicts the suite's contract that `deploy_release_stage` is the one gated
    // deploy action. We hold every stage as manual by enumerating the definition's environment
    // names; `autoDeploy: true` opts back into the definition's own triggers.
    let manualEnvironments: string[] | undefined;
    if (!args.autoDeploy) {
      const definition = await this.client.getReleaseDefinition({
        project: args.project,
        definitionId: args.definitionId,
      });
      const names = (definition.environments ?? [])
        .map(env => env.name)
        .filter((name): name is string => !!name);
      manualEnvironments = names.length > 0 ? names : undefined;
    }

    const metadata: ReleaseStartMetadata = {
      definitionId: args.definitionId,
      description: args.description,
      artifacts: shapedArtifacts,
      variables: args.variables,
      manualEnvironments,
    };

    const release = await this.client.createRelease({
      project: args.project,
      metadata,
    });

    return {
      releaseId: release.id ?? 0,
      name: release.name,
      environments: (release.environments ?? []).map(env => ({
        id: env.id ?? 0,
        name: env.name ?? '',
        status:
            typeof env.status === 'number'
              ? (ENVIRONMENT_STATUS_FROM_ENUM[env.status] ?? 'unknown')
              : undefined,
      })),
    };
  }

  async deployStage(args: {
    project: string;
    releaseId: number;
    environmentName: string;
    comment?: string;
  }): Promise<DeployStageResult> {
    const release = await this.client.getRelease({
      project: args.project,
      releaseId: args.releaseId,
    });

    const env = (release.environments ?? []).find(
      env => env.name?.toLowerCase() === args.environmentName.toLowerCase(),
    );

    if (!env || typeof env.id !== 'number') {
      const available = (release.environments ?? [])
        .map(env => env.name)
        .filter(Boolean)
        .join(', ');
      throw new Error(
        `Environment '${args.environmentName}' not found on release ${args.releaseId}. `
        + `Available: ${available || '(none)'}`,
      );
    }

    // EnvironmentStatus.InProgress = 2 (verified from SDK ReleaseInterfaces.d.ts)
    const update: ReleaseEnvironmentUpdateMetadata = {
      status: 2,
      comment: args.comment,
    };

    await this.client.updateReleaseEnvironment({
      project: args.project,
      releaseId: args.releaseId,
      environmentId: env.id,
      update,
    });

    return {
      releaseId: args.releaseId,
      environmentId: env.id,
      environmentName: env.name ?? args.environmentName,
    };
  }

  async approveGate(args: {
    project: string;
    approvalId: number;
    status: 'approved' | 'rejected';
    comment?: string;
  }): Promise<ApproveGateResult> {
    const result = await this.client.updateReleaseApproval({
      project: args.project,
      approvalId: args.approvalId,
      status: args.status,
      comment: args.comment,
    });

    return {
      approvalId: result.id ?? args.approvalId,
      status: APPROVAL_STATUS_FROM_ENUM[(result.status as number) ?? 0] ?? 'unknown',
    };
  }

  async cancelRelease(args: {
    project: string;
    releaseId: number;
    comment?: string;
  }): Promise<CancelReleaseResult> {
    const release = await this.client.cancelRelease(args);

    return {
      releaseId: release.id ?? args.releaseId,
      status: RELEASE_STATUS_FROM_ENUM[(release.status as number) ?? 0] ?? 'unknown',
    };
  }

  async createDefinition(args: {
    project: string;
    cloneFromDefinitionId: number;
    name: string;
    description?: string;
    path?: string;
    artifactSources?: { alias: string; buildDefinitionId: number }[];
    variables?: Record<string, ReleaseVariableInput>;
  }): Promise<CreateReleaseDefinitionResult> {
    const source = await this.client.getReleaseDefinition({
      project: args.project,
      definitionId: args.cloneFromDefinitionId,
    });

    const clone = stripForClone(source);
    clone.name = args.name;
    if (args.description !== undefined) {
      clone.description = args.description;
    }
    if (args.path !== undefined) {
      clone.path = args.path;
    }

    await rebindArtifacts({
      client: this.client,
      project: args.project,
      cloneFromDefinitionId: args.cloneFromDefinitionId,
      artifacts: clone.artifacts ?? [],
      overrides: args.artifactSources ?? [],
    });

    if (args.variables) {
      clone.variables = mergeReleaseVariables(clone.variables, args.variables, undefined);
    }

    const created = await this.client.createReleaseDefinition({
      project: args.project,
      definition: clone,
    });

    return {
      definitionId: created.id ?? 0,
      name: created.name ?? args.name,
      path: created.path,
      url: created.url,
      environments: (created.environments ?? [])
        .map(env => env.name)
        .filter((name): name is string => !!name),
      artifacts: (created.artifacts ?? []).map(artifact => ({
        alias: artifact.alias ?? '',
        sourcePipeline: artifact.definitionReference?.definition?.name,
      })),
    };
  }

  async updateVariables(args: {
    project: string;
    definitionId: number;
    set?: Record<string, ReleaseVariableInput>;
    remove?: string[];
  }): Promise<UpdateReleaseVariablesResult> {
    const setCount = Object.keys(args.set ?? {}).length;
    const removeCount = (args.remove ?? []).length;
    if (setCount + removeCount === 0) {
      throw new Error('updateVariables: provide at least one of set or remove');
    }

    const definition = await this.client.getReleaseDefinition({
      project: args.project,
      definitionId: args.definitionId,
    });

    const mergedVars = mergeReleaseVariables(definition.variables, args.set, args.remove);

    const updated = await this.client.updateReleaseDefinition({
      project: args.project,
      definition: { ...definition, variables: mergedVars },
    });

    return {
      definitionId: args.definitionId,
      variables: projectReleaseVariables(updated.variables),
    };
  }

  async updateEnvironmentVariables(args: {
    project: string;
    definitionId: number;
    environmentName: string;
    set?: Record<string, ReleaseVariableInput>;
    remove?: string[];
  }): Promise<{
    definitionId: number;
    environmentId: number;
    environmentName: string;
    variables: Record<string, { value: string | null; isSecret: boolean }>;
  }> {
    const setCount = Object.keys(args.set ?? {}).length;
    const removeCount = (args.remove ?? []).length;
    if (setCount + removeCount === 0) {
      throw new Error('updateEnvironmentVariables: provide at least one of set or remove');
    }

    const definition = await this.client.getReleaseDefinition({
      project: args.project,
      definitionId: args.definitionId,
    });

    const envs = definition.environments ?? [];
    const target = findDefinitionEnvironment(envs, args.environmentName, args.definitionId);

    const mergedVars = mergeReleaseVariables(target.variables, args.set, args.remove);

    // Replace the target env's variables in place; other envs are untouched.
    const nextEnvs = envs.map(env =>
      env.id === target.id ? { ...env, variables: mergedVars } : env,
    );

    const updated = await this.client.updateReleaseDefinition({
      project: args.project,
      definition: { ...definition, environments: nextEnvs },
    });

    const updatedTarget
      = (updated.environments ?? []).find(env => env.id === target.id) ?? target;

    return {
      definitionId: args.definitionId,
      environmentId: target.id,
      environmentName: target.name ?? args.environmentName,
      variables: projectReleaseVariables(updatedTarget.variables),
    };
  }
}
