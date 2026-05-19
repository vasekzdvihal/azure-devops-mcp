import type { AdoClient } from "../../ado/client.js";
import type { BuildStatus, BuildDefinition, BuildDefinitionVariable } from "../../ado/types.js";

const BUILD_STATUS_FROM_ENUM: Record<number, string> = {
  0: "none",
  1: "inProgress",
  2: "completed",
  4: "cancelling",
  8: "postponed",
  32: "notStarted",
  47: "all",
};

function ensureRefsHeads(branch?: string): string | undefined {
  if (!branch) return undefined;
  return branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
}

export interface QueueRunResult {
  runId: number;
  name?: string;
  url?: string;
}

export interface CancelRunResult {
  runId: number;
  status: string;
}

export interface UpdateTagsResult {
  tags: string[];
}

export interface RetryStageResult {
  runId: number;
  stageName: string;
  retried: true;
}

// Variable input shape — kept local to mirror the schema (single source of truth in tools.ts).
export interface VariableInput {
  value: string;
  isSecret?: boolean;
  allowOverride?: boolean;
}

export interface UpdateVariablesResult {
  pipelineId: number;
  variables: Record<string, { value: string | null; isSecret: boolean }>;
}

function mergeVariables(
  existing: Record<string, BuildDefinitionVariable> | undefined,
  setOps: Record<string, VariableInput> | undefined,
  removeOps: string[] | undefined,
): Record<string, BuildDefinitionVariable> {
  // Start from existing — this is the secret-preservation guarantee.
  const merged: Record<string, BuildDefinitionVariable> = { ...(existing ?? {}) };
  for (const name of removeOps ?? []) {
    delete merged[name];
  }
  for (const [name, v] of Object.entries(setOps ?? {})) {
    const prev = merged[name];
    merged[name] = {
      value: v.value,
      // If caller didn't say, fall back to the prior isSecret (preserves "was a secret").
      isSecret: v.isSecret ?? prev?.isSecret ?? false,
      allowOverride: v.allowOverride ?? prev?.allowOverride,
    };
  }
  return merged;
}

function projectVariables(
  vars: Record<string, BuildDefinitionVariable> | undefined,
): Record<string, { value: string | null; isSecret: boolean }> {
  const out: Record<string, { value: string | null; isSecret: boolean }> = {};
  for (const [name, v] of Object.entries(vars ?? {})) {
    out[name] = {
      // Secrets get nulled out so callers can't accidentally surface the stored value.
      value: v.isSecret ? null : (v.value ?? null),
      isSecret: !!v.isSecret,
    };
  }
  return out;
}

export class PipelinesWriteService {
  constructor(private readonly client: AdoClient) {}

  async queueRun(args: {
    project: string;
    pipelineId: number;
    branch?: string;
    templateParameters?: Record<string, string>;
    variables?: Record<string, { value: string; isSecret?: boolean }>;
  }): Promise<QueueRunResult> {
    const run = await this.client.queuePipelineRun({
      project: args.project,
      pipelineId: args.pipelineId,
      branch: ensureRefsHeads(args.branch),
      templateParameters: args.templateParameters,
      variables: args.variables,
    });
    return {
      runId: run.id ?? 0,
      name: run.name,
      url: (run as { url?: string }).url,
    };
  }

  async cancelRun(args: { project: string; runId: number }): Promise<CancelRunResult> {
    const build = await this.client.cancelPipelineRun({
      project: args.project,
      runId: args.runId,
    });
    return {
      runId: build.id ?? args.runId,
      status: BUILD_STATUS_FROM_ENUM[(build.status as BuildStatus) ?? 0] ?? "unknown",
    };
  }

  async updateTags(args: {
    project: string;
    runId: number;
    addTags?: string[];
    removeTags?: string[];
  }): Promise<UpdateTagsResult> {
    if ((args.addTags?.length ?? 0) + (args.removeTags?.length ?? 0) === 0) {
      throw new Error("updateTags: provide at least one tag in addTags or removeTags");
    }
    let latest: string[] = [];
    if (args.addTags && args.addTags.length > 0) {
      latest = await this.client.addBuildTags({
        project: args.project,
        runId: args.runId,
        tags: args.addTags,
      });
    }
    if (args.removeTags && args.removeTags.length > 0) {
      for (const tag of args.removeTags) {
        latest = await this.client.removeBuildTag({
          project: args.project,
          runId: args.runId,
          tag,
        });
      }
    }
    return { tags: latest };
  }

  async retryStage(args: {
    project: string;
    runId: number;
    stageName: string;
    forceRetryAllJobs?: boolean;
  }): Promise<RetryStageResult> {
    await this.client.retryBuildStage({
      project: args.project,
      runId: args.runId,
      stageName: args.stageName,
      forceRetryAllJobs: args.forceRetryAllJobs ?? true,
    });
    return { runId: args.runId, stageName: args.stageName, retried: true };
  }

  async updateVariables(args: {
    project: string;
    pipelineId: number;
    set?: Record<string, VariableInput>;
    remove?: string[];
  }): Promise<UpdateVariablesResult> {
    const setCount = Object.keys(args.set ?? {}).length;
    const removeCount = (args.remove ?? []).length;
    if (setCount + removeCount === 0) {
      throw new Error("updateVariables: provide at least one of set or remove");
    }

    const definition = await this.client.getPipelineDefinition({
      project: args.project,
      definitionId: args.pipelineId,
    });

    const mergedVars = mergeVariables(definition.variables, args.set, args.remove);

    const updated = await this.client.updatePipelineDefinition({
      project: args.project,
      definitionId: args.pipelineId,
      definition: { ...definition, variables: mergedVars },
    });

    return {
      pipelineId: args.pipelineId,
      variables: projectVariables(updated.variables),
    };
  }
}
