import type { AdoClient } from '../../ado/client.js';
import type {
  Build,
  BuildDefinition,
  BuildResult,
  BuildStatus,
  TimelineRecord,
} from '../../ado/types.js';

// DefinitionTriggerType: 1=none, 2=CI, 4=batchedCI, 8=schedule, 16=gatedCheckIn,
// 32=batchedGatedCheckIn, 64=pullRequest, 128=buildCompletion. The SDK exposes
// these as numeric constants — we surface readable strings for the LLM.
const TRIGGER_TYPE_FROM_ENUM: Record<number, string> = {
  1: 'none',
  2: 'continuousIntegration',
  4: 'batchedContinuousIntegration',
  8: 'schedule',
  16: 'gatedCheckIn',
  32: 'batchedGatedCheckIn',
  64: 'pullRequest',
  128: 'buildCompletion',
};

const BUILD_STATUS_TO_ENUM: Record<string, BuildStatus> = {
  inProgress: 1,
  completed: 2,
  cancelling: 4,
  postponed: 8,
  notStarted: 32,
};

const BUILD_STATUS_FROM_ENUM: Record<number, string> = {
  0: 'none',
  1: 'inProgress',
  2: 'completed',
  4: 'cancelling',
  8: 'postponed',
  32: 'notStarted',
};

const BUILD_RESULT_TO_ENUM: Record<string, BuildResult> = {
  succeeded: 2,
  partiallySucceeded: 4,
  failed: 8,
  canceled: 32,
};

const BUILD_RESULT_FROM_ENUM: Record<number, string> = {
  0: 'none',
  2: 'succeeded',
  4: 'partiallySucceeded',
  8: 'failed',
  32: 'canceled',
};

// TimelineRecordState: 0=pending, 1=inProgress, 2=completed
function toIso(date: Date | undefined): string | undefined {
  return date?.toISOString();
}

function buildStatusLabel(status: BuildStatus | undefined): string {
  return BUILD_STATUS_FROM_ENUM[status ?? 0] ?? 'unknown';
}

function buildResultLabel(result: BuildResult | undefined): string {
  return BUILD_RESULT_FROM_ENUM[result ?? 0] ?? 'none';
}

const TIMELINE_STATE_FROM_ENUM: Record<number, string> = {
  0: 'pending',
  1: 'inProgress',
  2: 'completed',
};

// TaskResult: 0=succeeded, 1=succeededWithIssues, 2=failed, 3=canceled, 4=skipped, 5=abandoned
const TIMELINE_RESULT_FROM_ENUM: Record<number, string> = {
  0: 'succeeded',
  1: 'succeededWithIssues',
  2: 'failed',
  3: 'canceled',
  4: 'skipped',
  5: 'abandoned',
};

export interface PipelineSummary {
  id: number;
  name: string;
  path?: string;
  type: 'classic' | 'yaml' | 'unknown';
  repositoryId?: string;
  defaultBranch?: string;
}

export interface PipelineRunSummary {
  id: number;
  buildNumber?: string;
  pipelineId?: number;
  pipelineName?: string;
  status: string;
  result: string;
  sourceBranch?: string;
  sourceVersion?: string;
  requestedBy?: string;
  requestedFor?: string;
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
}

export interface PipelineVariableInfo {
  name: string;
  isSecret: boolean;
  allowOverride: boolean;
  /** Omitted entirely (undefined) when `isSecret` — ADO returns no value for secrets. */
  value?: string;
}

export interface PipelineTriggerInfo {
  type: string;
  branchFilters?: string[];
  pathFilters?: string[];
  /** Number of schedules attached when `type === "schedule"`. */
  scheduleCount?: number;
}

export interface PipelineDefinitionDetail extends PipelineSummary {
  description?: string;
  /** YAML pipelines only — the path to the YAML file inside the repository. */
  yamlFilename?: string;
  queue?: { id?: number; name?: string };
  variables: PipelineVariableInfo[];
  variableGroupIds: number[];
  triggers: PipelineTriggerInfo[];
  repositoryName?: string;
  repositoryType?: string;
}

export interface PipelineRunDetail extends PipelineRunSummary {
  stages: Array<{
    name: string;
    status: string;
    result: string;
    startTime?: string;
    finishTime?: string;
  }>;
  triggerInfo?: { [key: string]: string };
  templateParameters?: { [key: string]: string };
}

export class PipelinesReadService {
  constructor(private readonly client: AdoClient) {}

  async list(args: { project: string; repositoryId?: string }): Promise<PipelineSummary[]> {
    const defs = await this.client.listPipelines({
      project: args.project,
      repositoryId: args.repositoryId,
    });
    return defs.map(shapePipeline);
  }

  async listRuns(args: {
    project: string;
    pipelineId?: number;
    branch?: string;
    status?: string;
    result?: string;
    top?: number;
  }): Promise<PipelineRunSummary[]> {
    const runs = await this.client.listPipelineRuns({
      project: args.project,
      pipelineId: args.pipelineId,
      branch: args.branch,
      status: args.status ? BUILD_STATUS_TO_ENUM[args.status] : undefined,
      result: args.result ? BUILD_RESULT_TO_ENUM[args.result] : undefined,
      top: args.top,
    });
    return runs.map(shapeRun);
  }

  async getDefinition(args: {
    project: string;
    definitionId: number;
  }): Promise<PipelineDefinitionDetail> {
    const def = await this.client.getPipelineDefinition({
      project: args.project,
      definitionId: args.definitionId,
    });
    return shapeDefinition(def);
  }

  async get(args: { project: string; runId: number }): Promise<PipelineRunDetail> {
    const { build, timeline } = await this.client.getPipelineRun({
      project: args.project,
      runId: args.runId,
    });
    const stages = (timeline?.records ?? [])
      .filter(record => record.type === 'Stage')
      .map(shapeTimelineStage);
    return {
      ...shapeRun(build),
      stages,
      triggerInfo: build.triggerInfo,
      templateParameters: build.templateParameters,
    };
  }
}

function shapePipeline(def: BuildDefinition): PipelineSummary {
  // DefinitionType enum: 1=xaml (ancient), 2=build. The classic-vs-yaml split
  // lives on `process.type`: 1=designer (classic), 2=yaml.
  const procType = (def.process as { type?: number } | undefined)?.type;
  const type: PipelineSummary['type']
    = procType === 2 ? 'yaml' : procType === 1 ? 'classic' : 'unknown';
  return {
    id: def.id ?? 0,
    name: def.name ?? '',
    path: def.path,
    type,
    repositoryId: def.repository?.id,
    defaultBranch: def.repository?.defaultBranch,
  };
}

function shapeRun(run: Build): PipelineRunSummary {
  return {
    id: run.id ?? 0,
    buildNumber: run.buildNumber,
    pipelineId: run.definition?.id,
    pipelineName: run.definition?.name,
    status: buildStatusLabel(run.status),
    result: buildResultLabel(run.result),
    sourceBranch: run.sourceBranch,
    sourceVersion: run.sourceVersion,
    requestedBy: run.requestedBy?.displayName,
    requestedFor: run.requestedFor?.displayName,
    queueTime: toIso(run.queueTime),
    startTime: toIso(run.startTime),
    finishTime: toIso(run.finishTime),
  };
}

function shapeDefinition(def: BuildDefinition): PipelineDefinitionDetail {
  const summary = shapePipeline(def);
  // The YAML pipeline's source file lives on `process.yamlFilename`. The SDK
  // types it as `BuildProcess` (just `{ type }`), so we narrow at the seam.
  const proc = def.process as { type?: number; yamlFilename?: string } | undefined;
  const yamlFilename = proc?.type === 2 ? proc.yamlFilename : undefined;

  const variables: PipelineVariableInfo[] = Object.entries(def.variables ?? {}).map(
    ([name, value]) => ({
      name,
      isSecret: !!value?.isSecret,
      allowOverride: !!value?.allowOverride,
      // Secrets never include a value on the wire — drop the key rather than
      // surfacing `undefined` so consumers don't think they got "the value of
      // the secret was cleared".
      ...(value?.isSecret ? {} : { value: value?.value }),
    }),
  );

  const variableGroupIds: number[] = (def.variableGroups ?? [])
    .map(group => (group as { id?: number }).id)
    .filter((id): id is number => typeof id === 'number');

  const triggers: PipelineTriggerInfo[] = (def.triggers ?? []).map((trigger) => {
    const type = TRIGGER_TYPE_FROM_ENUM[trigger.triggerType ?? 0] ?? 'unknown';
    // Each trigger subtype carries different fields; widen for narrowing.
    const ext = trigger as {
      branchFilters?: string[];
      pathFilters?: string[];
      schedules?: unknown[];
    };
    return {
      type,
      ...(ext.branchFilters ? { branchFilters: ext.branchFilters } : {}),
      ...(ext.pathFilters ? { pathFilters: ext.pathFilters } : {}),
      ...(type === 'schedule' && Array.isArray(ext.schedules)
        ? { scheduleCount: ext.schedules.length }
        : {}),
    };
  });

  return {
    ...summary,
    description: def.description,
    ...(yamlFilename ? { yamlFilename } : {}),
    ...(def.queue ? { queue: { id: def.queue.id, name: def.queue.name } } : {}),
    variables,
    variableGroupIds,
    triggers,
    repositoryName: def.repository?.name,
    repositoryType: def.repository?.type,
  };
}

function shapeTimelineStage(record: TimelineRecord): PipelineRunDetail['stages'][number] {
  return {
    name: record.name ?? '',
    status: TIMELINE_STATE_FROM_ENUM[record.state ?? 0] ?? 'unknown',
    result: TIMELINE_RESULT_FROM_ENUM[record.result ?? 0] ?? 'unknown',
    startTime: record.startTime?.toISOString(),
    finishTime: record.finishTime?.toISOString(),
  };
}
