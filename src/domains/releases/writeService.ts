import type { AdoClient } from "../../ado/client.js";
import type {
  ReleaseStartMetadata,
  ReleaseEnvironmentUpdateMetadata,
} from "../../ado/types.js";

// Reverse-mapping tables — VALUES verified against SDK ReleaseInterfaces.d.ts.
//
// ReleaseStatus: Undefined=0, Draft=1, Active=2, Abandoned=4
// ApprovalStatus: Undefined=0, Pending=1, Approved=2, Rejected=4, Reassigned=6, Canceled=7, Skipped=8
// EnvironmentStatus: Undefined=0, NotStarted=1, InProgress=2, Succeeded=4, Canceled=8, Rejected=16,
//                    Queued=32, Scheduled=64, PartiallySucceeded=128

const RELEASE_STATUS_FROM_ENUM: Record<number, string> = {
  0: "undefined",
  1: "draft",
  2: "active",
  4: "abandoned",
};

const APPROVAL_STATUS_FROM_ENUM: Record<number, string> = {
  0: "undefined",
  1: "pending",
  2: "approved",
  4: "rejected",
  6: "reassigned",
  7: "canceled",
  8: "skipped",
};

const ENVIRONMENT_STATUS_FROM_ENUM: Record<number, string> = {
  0: "undefined",
  1: "notStarted",
  2: "inProgress",
  4: "succeeded",
  8: "canceled",
  16: "rejected",
  32: "queued",
  64: "scheduled",
  128: "partiallySucceeded",
};

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

export class ReleasesWriteService {
  constructor(private readonly client: AdoClient) {}

  async createRelease(args: {
    project: string;
    definitionId: number;
    description?: string;
    artifacts?: { alias: string; buildId: number }[];
    variables?: Record<string, { value: string; isSecret?: boolean }>;
  }): Promise<CreateReleaseResult> {
    let shapedArtifacts: ReleaseStartMetadata["artifacts"] | undefined;
    if (args.artifacts && args.artifacts.length > 0) {
      shapedArtifacts = [];
      for (const a of args.artifacts) {
        const build = await this.client.getBuild({
          project: args.project,
          buildId: a.buildId,
        });
        shapedArtifacts.push({
          alias: a.alias,
          instanceReference: {
            id: String(a.buildId),
            name: build.buildNumber ?? String(a.buildId),
          },
        });
      }
    }

    const metadata: ReleaseStartMetadata = {
      definitionId: args.definitionId,
      description: args.description,
      artifacts: shapedArtifacts,
      variables: args.variables,
    };

    const release = await this.client.createRelease({
      project: args.project,
      metadata,
    });

    return {
      releaseId: release.id ?? 0,
      name: release.name,
      environments: (release.environments ?? []).map((e) => ({
        id: e.id ?? 0,
        name: e.name ?? "",
        status:
            typeof e.status === "number"
              ? (ENVIRONMENT_STATUS_FROM_ENUM[e.status] ?? "unknown")
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
      (e) => e.name?.toLowerCase() === args.environmentName.toLowerCase(),
    );

    if (!env || env.id == null) {
      const available = (release.environments ?? [])
        .map((e) => e.name)
        .filter(Boolean)
        .join(", ");
      throw new Error(
        `Environment '${args.environmentName}' not found on release ${args.releaseId}. ` +
          `Available: ${available || "(none)"}`,
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
    status: "approved" | "rejected";
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
      status: APPROVAL_STATUS_FROM_ENUM[(result.status as number) ?? 0] ?? "unknown",
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
      status: RELEASE_STATUS_FROM_ENUM[(release.status as number) ?? 0] ?? "unknown",
    };
  }
}
