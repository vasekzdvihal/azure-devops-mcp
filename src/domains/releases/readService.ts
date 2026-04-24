import type { AdoClient } from "../../ado/client.js";
import type {
  Release,
  ReleaseDefinition,
  Deployment,
  DeploymentStatus,
  ReleaseStatus,
  ReleaseEnvironment,
  Artifact,
} from "../../ado/types.js";

const RELEASE_STATUS_TO_ENUM: Record<string, ReleaseStatus> = {
  draft: 1,
  active: 2,
  abandoned: 4,
};

const RELEASE_STATUS_FROM_ENUM: Record<number, string> = {
  0: "undefined",
  1: "draft",
  2: "active",
  4: "abandoned",
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
  0: "undefined",
  1: "notDeployed",
  2: "inProgress",
  4: "succeeded",
  8: "partiallySucceeded",
  16: "failed",
};

// EnvironmentStatus enum — per-stage status inside a release.
const ENVIRONMENT_STATUS_FROM_ENUM: Record<number, string> = {
  0: "undefined",
  2: "inProgress",
  4: "succeeded",
  8: "canceled",
  16: "rejected",
  32: "queued",
  64: "scheduled",
  128: "partiallySucceeded",
};

export interface ReleaseDefinitionSummary {
  id: number;
  name: string;
  path?: string;
  createdBy?: string;
  createdOn?: string;
  modifiedOn?: string;
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
    return deployments.map(shapeDeployment);
  }
}

function shapeDefinition(d: ReleaseDefinition): ReleaseDefinitionSummary {
  return {
    id: d.id ?? 0,
    name: d.name ?? "",
    path: d.path,
    createdBy: d.createdBy?.displayName,
    createdOn: d.createdOn?.toISOString(),
    modifiedOn: d.modifiedOn?.toISOString(),
  };
}

function shapeRelease(r: Release): ReleaseSummary {
  return {
    id: r.id ?? 0,
    name: r.name ?? "",
    definitionId: r.releaseDefinition?.id,
    definitionName: r.releaseDefinition?.name,
    status: RELEASE_STATUS_FROM_ENUM[r.status ?? 0] ?? "unknown",
    createdBy: r.createdBy?.displayName,
    createdOn: r.createdOn?.toISOString(),
    description: r.description,
  };
}

function shapeReleaseDetail(r: Release): ReleaseDetail {
  return {
    ...shapeRelease(r),
    stages: (r.environments ?? []).map(shapeStage),
    artifacts: (r.artifacts ?? []).map(shapeArtifact),
  };
}

function shapeStage(env: ReleaseEnvironment): ReleaseDetail["stages"][number] {
  const latestStep = env.deploySteps?.[env.deploySteps.length - 1];
  return {
    environmentName: env.name ?? "",
    status: ENVIRONMENT_STATUS_FROM_ENUM[env.status ?? 0] ?? "unknown",
    deployedBy: latestStep?.requestedBy?.displayName,
    completedOn: latestStep?.lastModifiedOn?.toISOString(),
  };
}

function shapeArtifact(a: Artifact): ReleaseDetail["artifacts"][number] {
  const ref = a.definitionReference ?? {};
  return {
    alias: a.alias,
    sourceBuildId: ref.version?.id,
    sourceBranch: ref.branch?.id,
    sourceVersion: ref.sourceVersion?.id,
  };
}

function shapeDeployment(d: Deployment): DeploymentSummary {
  // Artifact metadata lives on the associated release reference (one hop in
  // the SDK shape). Surfacing it on the flat row makes "what was deployed"
  // visible without a follow-up get_release call.
  const primaryArtifact = d.release?.artifacts?.[0];
  const ref = primaryArtifact?.definitionReference ?? {};
  return {
    deploymentId: d.id ?? 0,
    releaseId: d.release?.id,
    releaseName: d.release?.name,
    definitionId: d.releaseDefinition?.id,
    definitionName: d.releaseDefinition?.name,
    environmentName: d.releaseEnvironment?.name,
    status: DEPLOYMENT_STATUS_FROM_ENUM[d.deploymentStatus ?? 0] ?? "unknown",
    requestedBy: d.requestedBy?.displayName,
    requestedOn: d.queuedOn?.toISOString(),
    startedOn: d.startedOn?.toISOString(),
    completedOn: d.completedOn?.toISOString(),
    sourceBuildId: ref.version?.id,
    sourceBranch: ref.branch?.id,
    sourceVersion: ref.sourceVersion?.id,
  };
}
