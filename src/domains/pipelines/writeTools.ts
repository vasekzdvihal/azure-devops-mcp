import type { ToolDefinition } from '../identity/tools.js';
import type { PipelinesWriteService } from './writeService.js';
import {
  CancelPipelineRunInput,
  CreatePipelineInput,
  QueuePipelineRunInput,
  RetryPipelineStageInput,
  UpdateBuildTagsInput,
  UpdatePipelineTriggersInput,
  UpdatePipelineVariablesInput,
} from './schemas.js';

export function buildPipelineWriteTools(svc: PipelinesWriteService): ToolDefinition[] {
  return [
    {
      name: 'queue_pipeline_run',
      config: {
        title: 'Queue a new run of a pipeline',
        description:
          'Starts a new build/run of the named pipeline. Optional `branch` overrides the default; '
          + '`templateParameters` and `variables` let YAML pipelines parameterize the run. Returns the '
          + 'new run id and URL so you can chain `get_pipeline_run` to watch it.',
        inputSchema: QueuePipelineRunInput,
      },
      handler: async args =>
        svc.queueRun(args as Parameters<typeof svc.queueRun>[0]),
    },
    {
      name: 'cancel_pipeline_run',
      config: {
        title: 'Cancel an in-progress pipeline run',
        description:
          'Cancels a running build. Already-completed runs return a clear conflict error; this '
          + 'tool does not retry or noop in that case.',
        inputSchema: CancelPipelineRunInput,
      },
      handler: async args =>
        svc.cancelRun(args as Parameters<typeof svc.cancelRun>[0]),
    },
    {
      name: 'update_build_tags',
      config: {
        title: 'Add and/or remove tags on a build/run',
        description:
          'Adds tags in `addTags` and removes tags in `removeTags` from a build. Either array (or '
          + 'both) may be supplied; at least one tag is required across the two arrays. Returns the '
          + 'final tag list after the changes.',
        inputSchema: UpdateBuildTagsInput,
      },
      handler: async args =>
        svc.updateTags(args as Parameters<typeof svc.updateTags>[0]),
    },
    {
      name: 'retry_pipeline_stage',
      config: {
        title: 'Retry a single failed stage of a YAML multi-stage pipeline',
        description:
          'Re-runs the named stage in an existing pipeline run instead of re-queueing the whole '
          + 'pipeline. `stageName` must match the stage\'s ref name as it appears in YAML (case-sensitive). '
          + 'By default retries all jobs in the stage (`forceRetryAllJobs: true`); set to false to retry '
          + 'only the failed jobs. Attempting to retry a stage on a run that is not in a retryable state '
          + 'returns a clear conflict error.',
        inputSchema: RetryPipelineStageInput,
      },
      handler: async args =>
        svc.retryStage(args as Parameters<typeof svc.retryStage>[0]),
    },
    {
      name: 'update_pipeline_variables',
      config: {
        title: 'Add, update, or remove variables on a pipeline definition',
        description:
          '**Always confirm with the user before calling — this changes pipeline configuration '
          + 'visible to every future run.** Use `set` to add or update variables and `remove` to delete '
          + 'them. Existing secrets are preserved automatically: if you don\'t include a secret in `set`, '
          + 'its stored value is kept. To declassify a secret, include it in `set` with '
          + '`isSecret: false`. At least one of `set` or `remove` is required.',
        inputSchema: UpdatePipelineVariablesInput,
      },
      handler: async args =>
        svc.updateVariables(args as Parameters<typeof svc.updateVariables>[0]),
    },
    {
      name: 'update_pipeline_triggers',
      config: {
        title: 'Replace the triggers on a pipeline definition',
        description:
          '**Always confirm with the user before calling — this changes pipeline configuration '
          + 'visible to every future run.** Replaces the entire `triggers` array on the definition. '
          + 'Fetch the current definition via `get_pipeline_definition`, edit the triggers array, then '
          + 'submit it here — any trigger not present in your submitted array is removed.',
        inputSchema: UpdatePipelineTriggersInput,
      },
      handler: async args =>
        svc.updateTriggers(args as Parameters<typeof svc.updateTriggers>[0]),
    },
    {
      name: 'create_pipeline',
      config: {
        title: 'Create a YAML pipeline',
        description:
          'Creates a new pipeline definition that runs the YAML file at `yamlPath` in the named '
          + 'Azure Repos repository. Creating a pipeline runs nothing and is reversible with '
          + '`delete_pipeline`. ADO does not verify that the YAML file exists at creation time — '
          + 'the first run fails instead, so chain `queue_pipeline_run` to validate. Returns the new '
          + 'pipeline id and URL.',
        inputSchema: CreatePipelineInput,
      },
      handler: async args =>
        svc.createPipeline(args as Parameters<typeof svc.createPipeline>[0]),
    },
  ];
}
