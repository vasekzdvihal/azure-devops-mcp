import type { AdoClient } from '../../ado/client.js';
import type { BuildDefinition, BuildDefinitionVariable, BuildStatus } from '../../ado/types.js';
import { AdoNotFoundError } from '../../ado/errors.js';

const BUILD_STATUS_FROM_ENUM: Record<number, string> = {
  0: 'none',
  1: 'inProgress',
  2: 'completed',
  4: 'cancelling',
  8: 'postponed',
  32: 'notStarted',
  47: 'all',
};

function ensureRefsHeads(branch?: string): string | undefined {
  if (!branch) {
    return undefined;
  }
  return branch.startsWith('refs/') ? branch : `refs/heads/${branch}`;
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

export interface UpdateTriggersResult {
  pipelineId: number;
  triggers: unknown[];
}

export interface CreatePipelineResult {
  pipelineId: number;
  name: string;
  folder: string;
  url?: string;
  repository: string;
  yamlPath: string;
}

export interface DeletePipelineResult {
  pipelineId: number;
  deleted: true;
}

const ROOT_FOLDER = '\\';

function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function mergeVariable(
  prev: BuildDefinitionVariable | undefined,
  value: VariableInput,
): BuildDefinitionVariable {
  return {
    value: value.value,
    // If caller didn't say, fall back to the prior isSecret (preserves "was a secret").
    isSecret: value.isSecret ?? prev?.isSecret ?? false,
    allowOverride: value.allowOverride ?? prev?.allowOverride,
  };
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
  for (const [name, value] of Object.entries(setOps ?? {})) {
    merged[name] = mergeVariable(merged[name], value);
  }
  return merged;
}

function projectVariables(
  vars: Record<string, BuildDefinitionVariable> | undefined,
): Record<string, { value: string | null; isSecret: boolean }> {
  const out: Record<string, { value: string | null; isSecret: boolean }> = {};
  for (const [name, value] of Object.entries(vars ?? {})) {
    out[name] = {
      // Secrets get nulled out so callers can't accidentally surface the stored value.
      value: value.isSecret ? null : (value.value ?? null),
      isSecret: !!value.isSecret,
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
      status: BUILD_STATUS_FROM_ENUM[(build.status as BuildStatus) ?? 0] ?? 'unknown',
    };
  }

  async updateTags(args: {
    project: string;
    runId: number;
    addTags?: string[];
    removeTags?: string[];
  }): Promise<UpdateTagsResult> {
    const addTags = args.addTags ?? [];
    const removeTags = args.removeTags ?? [];
    if (addTags.length + removeTags.length === 0) {
      throw new Error('updateTags: provide at least one tag in addTags or removeTags');
    }
    let latest: string[] = [];
    if (addTags.length > 0) {
      latest = await this.client.addBuildTags({
        project: args.project,
        runId: args.runId,
        tags: addTags,
      });
    }
    for (const tag of removeTags) {
      latest = await this.client.removeBuildTag({
        project: args.project,
        runId: args.runId,
        tag,
      });
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
      throw new Error('updateVariables: provide at least one of set or remove');
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

  async updateTriggers(args: {
    project: string;
    pipelineId: number;
    triggers: unknown[];
  }): Promise<UpdateTriggersResult> {
    const definition = await this.client.getPipelineDefinition({
      project: args.project,
      definitionId: args.pipelineId,
    });

    // The triggers array is loosely-typed (Zod gives us record<string, unknown>[]); the
    // SDK accepts BuildTrigger[] which is a discriminated union. We cast through — ADO
    // validates the shape server-side and surfaces a 400 with a useful message on bad input.
    const updated = await this.client.updatePipelineDefinition({
      project: args.project,
      definitionId: args.pipelineId,
      definition: { ...definition, triggers: args.triggers as BuildDefinition['triggers'] },
    });

    return {
      pipelineId: args.pipelineId,
      triggers: (updated.triggers ?? []) as unknown[],
    };
  }

  async createPipeline(args: {
    project: string;
    name: string;
    repository: string;
    yamlPath: string;
    folder?: string;
  }): Promise<CreatePipelineResult> {
    const repos = await this.client.listRepositories({ project: args.project });
    const repo = repos.find(candidate => candidate.name?.toLowerCase() === args.repository.toLowerCase());
    if (!repo?.id || !repo.name) {
      throw new AdoNotFoundError(
        `Repository '${args.repository}' not found in project '${args.project}'. `
        + `Use list_repositories to see available names.`,
      );
    }

    const folder = args.folder ?? ROOT_FOLDER;
    const yamlPath = ensureLeadingSlash(args.yamlPath);

    const created = await this.client.createPipeline({
      project: args.project,
      name: args.name,
      folder,
      yamlPath,
      repositoryId: repo.id,
      repositoryName: repo.name,
    });

    return {
      pipelineId: created.id ?? 0,
      name: created.name ?? args.name,
      folder: created.folder ?? folder,
      url: created.url,
      repository: repo.name,
      yamlPath,
    };
  }
}
