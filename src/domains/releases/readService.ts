import type { AdoClient } from '../../ado/client.js';
import type {
  Artifact,
  Deployment,
  DeploymentStatus,
  EnvironmentStatus,
  Release,
  ReleaseApproval,
  ReleaseDefinition,
  ReleaseEnvironment,
  ReleaseStatus,
} from '../../ado/types.js';

// ReleaseTriggerType: 0=undefined, 1=artifactSource, 2=schedule, 3=sourceRepo,
// 4=containerImage, 5=package, 6=pullRequest.
const RELEASE_TRIGGER_TYPE_FROM_ENUM: Record<number, string> = {
  0: 'undefined',
  1: 'artifactSource',
  2: 'schedule',
  3: 'sourceRepo',
  4: 'containerImage',
  5: 'package',
  6: 'pullRequest',
};

const RELEASE_STATUS_TO_ENUM: Record<string, ReleaseStatus> = {
  draft: 1,
  active: 2,
  abandoned: 4,
};

const RELEASE_STATUS_FROM_ENUM: Record<number, string> = {
  0: 'undefined',
  1: 'draft',
  2: 'active',
  4: 'abandoned',
};

const DEPLOYMENT_STATUS_TO_ENUM: Record<string, DeploymentStatus> = {
  notDeployed: 1,
  inProgress: 2,
  succeeded: 4,
  partiallySucceeded: 8,
  failed: 16,
  all: 31,
};

const DEPLOYMENT_STATUS_FROM_ENUM: Record<number, string> = {
  0: 'undefined',
  1: 'notDeployed',
  2: 'inProgress',
  4: 'succeeded',
  8: 'partiallySucceeded',
  16: 'failed',
};

// EnvironmentStatus enum — per-stage status inside a release.
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

function toIso(date: Date | undefined): string | undefined {
  return date?.toISOString();
}

function deploymentStatusLabel(status: DeploymentStatus | undefined): string {
  return DEPLOYMENT_STATUS_FROM_ENUM[status ?? 0] ?? 'unknown';
}

function environmentStatusLabel(status: EnvironmentStatus | undefined): string {
  return ENVIRONMENT_STATUS_FROM_ENUM[status ?? 0] ?? 'unknown';
}

export interface ReleaseDefinitionSummary {
  id: number;
  name: string;
  path?: string;
  createdBy?: string;
  createdOn?: string;
  modifiedOn?: string;
}

export interface ReleaseVariableInfo {
  name: string;
  isSecret: boolean;
  allowOverride: boolean;
  /** Omitted when `isSecret` — ADO never returns secret values. */
  value?: string;
}

export interface ReleaseDefinitionApprovalsInfo {
  /** True when the stage transitions automatically (no approver gate). */
  isAutomated: boolean;
  approvers: string[];
}

export interface ReleaseDefinitionEnvironmentInfo {
  id?: number;
  name: string;
  rank?: number;
  queueId?: number;
  preApprovals: ReleaseDefinitionApprovalsInfo;
  postApprovals: ReleaseDefinitionApprovalsInfo;
  /** Total tasks across all deploy phases. */
  deployTaskCount: number;
  /** Only present when `verbose: true` was requested. */
  deployTasks?: Array<{ displayName: string; refName?: string; enabled: boolean }>;
}

export interface ReleaseDefinitionArtifactInfo {
  alias?: string;
  type?: string;
  sourceId?: string;
  sourceDefinitionId?: string;
  sourceDefinitionName?: string;
}

export interface ReleaseDefinitionTriggerInfo {
  type: string;
  artifactAlias?: string;
}

export interface ReleaseDefinitionDetail extends ReleaseDefinitionSummary {
  description?: string;
  releaseNameFormat?: string;
  modifiedBy?: string;
  variables: ReleaseVariableInfo[];
  variableGroupIds: number[];
  artifacts: ReleaseDefinitionArtifactInfo[];
  triggers: ReleaseDefinitionTriggerInfo[];
  environments: ReleaseDefinitionEnvironmentInfo[];
}

export interface ReleaseSummary {
  id: number;
  name: string;
  definitionId?: number;
  definitionName?: string;
  status: string;
  createdOn?: string;
  createdBy?: string;
  description?: string;
}

export interface ReleaseDetail extends ReleaseSummary {
  stages: Array<{
    environmentName: string;
    status: string;
    deploymentStatus?: string;
    deployedBy?: string;
    completedOn?: string;
  }>;
  artifacts: Array<{
    alias?: string;
    sourceBuildId?: string;
    sourceBranch?: string;
    sourceVersion?: string;
  }>;
}

export interface DeploymentSummary {
  deploymentId: number;
  releaseId?: number;
  releaseName?: string;
  definitionId?: number;
  definitionName?: string;
  environmentName?: string;
  status: string;
  requestedBy?: string;
  requestedOn?: string;
  startedOn?: string;
  completedOn?: string;
  sourceBuildId?: string;
  sourceBranch?: string;
  sourceVersion?: string;
}

export class ReleasesReadService {
  constructor(private readonly client: AdoClient) {}

  async listDefinitions(args: { project: string }): Promise<ReleaseDefinitionSummary[]> {
    const defs = await this.client.listReleaseDefinitions({ project: args.project });
    return defs.map(shapeDefinition);
  }

  async getDefinition(args: {
    project: string;
    definitionId: number;
    verbose?: boolean;
  }): Promise<ReleaseDefinitionDetail> {
    const def = await this.client.getReleaseDefinition({
      project: args.project,
      definitionId: args.definitionId,
    });
    return shapeDefinitionDetail(def, !!args.verbose);
  }

  async list(args: {
    project: string;
    definitionId?: number;
    status?: string;
    top?: number;
  }): Promise<ReleaseSummary[]> {
    const status = args.status ? RELEASE_STATUS_TO_ENUM[args.status] : undefined;
    const releases = await this.client.listReleases({
      project: args.project,
      definitionId: args.definitionId,
      status,
      top: args.top,
    });
    return releases.map(shapeRelease);
  }

  async get(args: { project: string; releaseId: number }): Promise<ReleaseDetail> {
    const release = await this.client.getRelease({
      project: args.project,
      releaseId: args.releaseId,
    });
    return shapeReleaseDetail(release);
  }

  async listDeployments(args: {
    project: string;
    definitionId?: number;
    environmentName?: string;
    status?: string;
    top?: number;
  }): Promise<DeploymentSummary[]> {
    const deploymentStatus = args.status
      ? DEPLOYMENT_STATUS_TO_ENUM[args.status]
      : undefined;
    const deployments = await this.client.listDeployments({
      project: args.project,
      definitionId: args.definitionId,
      deploymentStatus,
      top: args.top,
    });
    const shaped = deployments.map(shapeDeployment);
    if (!args.environmentName) {
      return shaped;
    }
    const target = args.environmentName.toLowerCase();
    return shaped.filter(deployment => deployment.environmentName?.toLowerCase() === target);
  }

  async listPendingApprovals(args: {
    project: string;
    releaseId?: number;
    assignedTo?: string;
  }): Promise<
    {
      approvalId: number;
      releaseId: number;
      releaseName: string;
      environmentName: string;
      approver: string | null;
      createdOn: string | null;
    }[]
  > {
    const approvals = await this.client.listPendingApprovals(args);
    return approvals.map(shapePendingApproval);
  }
}

function shapePendingApproval(approval: ReleaseApproval): {
  approvalId: number;
  releaseId: number;
  releaseName: string;
  environmentName: string;
  approver: string | null;
  createdOn: string | null;
} {
  return {
    approvalId: approval.id ?? 0,
    releaseId: approval.release?.id ?? 0,
    releaseName: approval.release?.name ?? '',
    environmentName: approval.releaseEnvironment?.name ?? '',
    approver: approval.approver?.displayName ?? null,
    createdOn: isoOrNull(approval.createdOn),
  };
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : (value ?? null);
}

function shapeDefinition(def: ReleaseDefinition): ReleaseDefinitionSummary {
  return {
    id: def.id ?? 0,
    name: def.name ?? '',
    path: def.path,
    createdBy: def.createdBy?.displayName,
    createdOn: def.createdOn?.toISOString(),
    modifiedOn: def.modifiedOn?.toISOString(),
  };
}

function shapeDefinitionDetail(def: ReleaseDefinition, verbose: boolean): ReleaseDefinitionDetail {
  const summary = shapeDefinition(def);

  const variables: ReleaseVariableInfo[] = Object.entries(def.variables ?? {}).map(
    ([name, value]) => ({
      name,
      isSecret: !!value?.isSecret,
      allowOverride: !!value?.allowOverride,
      ...(value?.isSecret ? {} : { value: value?.value }),
    }),
  );

  const artifacts: ReleaseDefinitionArtifactInfo[] = (def.artifacts ?? []).map((artifact: Artifact) => {
    const ref = artifact.definitionReference ?? {};
    return {
      alias: artifact.alias,
      type: artifact.type,
      sourceId: artifact.sourceId,
      sourceDefinitionId: ref.definition?.id,
      sourceDefinitionName: ref.definition?.name,
    };
  });

  const triggers: ReleaseDefinitionTriggerInfo[] = (def.triggers ?? []).map((trigger) => {
    const type = RELEASE_TRIGGER_TYPE_FROM_ENUM[trigger.triggerType ?? 0] ?? 'unknown';
    // ArtifactSource and PullRequest triggers carry an `artifactAlias`. Other
    // subtypes do not — we widen and pluck conditionally.
    const ext = trigger as { artifactAlias?: string };
    return {
      type,
      ...(ext.artifactAlias ? { artifactAlias: ext.artifactAlias } : {}),
    };
  });

  const environments: ReleaseDefinitionEnvironmentInfo[] = (def.environments ?? []).map(env =>
    shapeDefinitionEnvironment(env, verbose),
  );

  return {
    ...summary,
    description: def.description,
    releaseNameFormat: def.releaseNameFormat,
    modifiedBy: def.modifiedBy?.displayName,
    variables,
    variableGroupIds: def.variableGroups ?? [],
    artifacts,
    triggers,
    environments,
  };
}

function shapeDefinitionEnvironment(
  // The definition-side environment shape differs from a release instance's
  // environment (this one has `deployPhases` + `preDeployApprovals`, whereas
  // the release-side has `deploySteps` + `status`). The SDK exports both as
  // distinct types; we narrow inline rather than importing yet another alias.
  env: {
    id?: number;
    name?: string;
    rank?: number;
    queueId?: number;
    preDeployApprovals?: {
      approvals?: Array<{ isAutomated?: boolean; approver?: { displayName?: string } }>;
    };
    postDeployApprovals?: {
      approvals?: Array<{ isAutomated?: boolean; approver?: { displayName?: string } }>;
    };
    deployPhases?: Array<{
      workflowTasks?: Array<{ name?: string; refName?: string; enabled?: boolean }>;
    }>;
  },
  verbose: boolean,
): ReleaseDefinitionEnvironmentInfo {
  const tasks = (env.deployPhases ?? []).flatMap(phase => phase.workflowTasks ?? []);

  return {
    id: env.id,
    name: env.name ?? '',
    rank: env.rank,
    queueId: env.queueId,
    preApprovals: shapeApprovals(env.preDeployApprovals),
    postApprovals: shapeApprovals(env.postDeployApprovals),
    deployTaskCount: tasks.length,
    ...(verbose
      ? {
          deployTasks: tasks.map(task => ({
            displayName: task.name ?? '',
            refName: task.refName,
            // ADO defaults a missing `enabled` flag to true in the UI; mirror that.
            enabled: task.enabled !== false,
          })),
        }
      : {}),
  };
}

function shapeApprovals(
  gate:
    | { approvals?: Array<{ isAutomated?: boolean; approver?: { displayName?: string } }> }
    | undefined,
): ReleaseDefinitionApprovalsInfo {
  const approvals = gate?.approvals ?? [];
  // ADO models "no approval gate" as a single approval entry with isAutomated=true.
  // Surface that as a single boolean rather than asking the LLM to interpret the
  // shape itself.
  const isAutomated = approvals.length === 0 || approvals.every(approval => approval.isAutomated === true);
  const approvers = approvals
    .filter(approval => approval.isAutomated !== true)
    .map(approval => approval.approver?.displayName)
    .filter((name): name is string => typeof name === 'string');
  return { isAutomated, approvers };
}

function shapeRelease(release: Release): ReleaseSummary {
  return {
    id: release.id ?? 0,
    name: release.name ?? '',
    definitionId: release.releaseDefinition?.id,
    definitionName: release.releaseDefinition?.name,
    status: RELEASE_STATUS_FROM_ENUM[release.status ?? 0] ?? 'unknown',
    createdBy: release.createdBy?.displayName,
    createdOn: release.createdOn?.toISOString(),
    description: release.description,
  };
}

function shapeReleaseDetail(release: Release): ReleaseDetail {
  return {
    ...shapeRelease(release),
    stages: (release.environments ?? []).map(shapeStage),
    artifacts: (release.artifacts ?? []).map(shapeArtifact),
  };
}

function shapeStage(env: ReleaseEnvironment): ReleaseDetail['stages'][number] {
  const latestStep = env.deploySteps?.[env.deploySteps.length - 1];
  // `status` is the environment-level state (the box in the ADO UI);
  // `deploymentStatus` is the latest deploy attempt's outcome. They often
  // agree but diverge during retries or when a manual intervention is queued.
  return {
    environmentName: env.name ?? '',
    status: environmentStatusLabel(env.status),
    deploymentStatus:
      latestStep?.status !== undefined
        ? (DEPLOYMENT_STATUS_FROM_ENUM[latestStep.status] ?? 'unknown')
        : undefined,
    deployedBy: latestStep?.requestedBy?.displayName,
    completedOn: toIso(latestStep?.lastModifiedOn),
  };
}

function shapeArtifact(artifact: Artifact): ReleaseDetail['artifacts'][number] {
  return {
    alias: artifact.alias,
    ...shapeArtifactRef(artifact),
  };
}

function shapeArtifactRef(
  artifact: Artifact | undefined,
): Pick<DeploymentSummary, 'sourceBuildId' | 'sourceBranch' | 'sourceVersion'> {
  const ref = artifact?.definitionReference ?? {};
  return {
    sourceBuildId: ref.version?.id,
    sourceBranch: ref.branch?.id,
    sourceVersion: ref.sourceVersion?.id,
  };
}

function shapeDeployment(deployment: Deployment): DeploymentSummary {
  // Artifact metadata lives on the associated release reference (one hop in
  // the SDK shape). Surfacing it on the flat row makes "what was deployed"
  // visible without a follow-up get_release call.
  return {
    deploymentId: deployment.id ?? 0,
    ...shapeDeploymentRefs(deployment),
    status: deploymentStatusLabel(deployment.deploymentStatus),
    requestedBy: deployment.requestedBy?.displayName,
    requestedOn: toIso(deployment.queuedOn),
    startedOn: toIso(deployment.startedOn),
    completedOn: toIso(deployment.completedOn),
    ...shapeArtifactRef(deployment.release?.artifacts?.[0]),
  };
}

function shapeDeploymentRefs(
  deployment: Deployment,
): Pick<
  DeploymentSummary,
  'releaseId' | 'releaseName' | 'definitionId' | 'definitionName' | 'environmentName'
> {
  return {
    releaseId: deployment.release?.id,
    releaseName: deployment.release?.name,
    definitionId: deployment.releaseDefinition?.id,
    definitionName: deployment.releaseDefinition?.name,
    environmentName: deployment.releaseEnvironment?.name,
  };
}
