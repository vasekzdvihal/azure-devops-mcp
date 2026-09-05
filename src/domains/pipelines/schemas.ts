import { z } from 'zod';

const MAX_TOP = 200;

export const ListPipelinesInput = {
  project: z.string().min(1).describe('ADO project name.'),
  repositoryId: z
    .string()
    .optional()
    .describe(
      'Filter to pipelines that build this repository id (GUID). '
      + 'Use `list_repositories` to resolve repo name → id.',
    ),
};

export const ListPipelineRunsInput = {
  project: z.string().min(1).describe('ADO project name.'),
  pipelineId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Filter to runs of this pipeline id.'),
  branch: z
    .string()
    .optional()
    .describe('Filter by source branch ref (e.g. \'refs/heads/main\').'),
  status: z
    .enum(['inProgress', 'completed', 'cancelling', 'postponed', 'notStarted'])
    .optional()
    .describe('Filter by run status.'),
  result: z
    .enum(['succeeded', 'partiallySucceeded', 'failed', 'canceled'])
    .optional()
    .describe('Filter by run result (only relevant when status is \'completed\').'),
  top: z.number().int().positive().max(MAX_TOP).optional().describe('Max results (default 25).'),
};

export const PipelineRunId = {
  project: z.string().min(1).describe('ADO project name.'),
  runId: z.number().int().positive().describe('The run id (integer).'),
};

export const PipelineDefinitionId = {
  project: z.string().min(1).describe('ADO project name.'),
  definitionId: z
    .number()
    .int()
    .positive()
    .describe(
      'The pipeline definition id (integer). Use `list_pipelines` to discover ids.',
    ),
};

export const QueuePipelineRunInput = {
  project: z.string().min(1).describe('Project name or id'),
  pipelineId: z.number().int().positive().describe('Pipeline (build definition) id'),
  branch: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Source ref to run the pipeline on (e.g. \'refs/heads/main\' or \'main\'). '
      + 'Omit to use the pipeline\'s default branch.',
    ),
  templateParameters: z
    .record(z.string(), z.string())
    .optional()
    .describe('Template parameters to override (YAML pipelines only)'),
  variables: z
    .record(
      z.string(),
      z.object({
        value: z.string(),
        isSecret: z.boolean().optional(),
      }),
    )
    .optional()
    .describe('Run-scoped variable overrides'),
};

export const CancelPipelineRunInput = {
  project: z.string().min(1),
  runId: z.number().int().positive().describe('Build/run id'),
};

// Cross-field validation ("at least one of addTags/removeTags") lives in
// PipelinesWriteService.updateTags — a z.refine() on a plain raw shape is not possible.
export const UpdateBuildTagsInput = {
  project: z.string().min(1),
  runId: z.number().int().positive(),
  addTags: z.array(z.string().min(1)).optional(),
  removeTags: z.array(z.string().min(1)).optional(),
};

export const RetryPipelineStageInput = {
  project: z.string().min(1),
  runId: z.number().int().positive().describe('Build/run id (integer)'),
  stageName: z
    .string()
    .min(1)
    .describe(
      'Stage ref name as it appears in the pipeline YAML (case-sensitive). '
      + 'Use `get_pipeline_run` and inspect the timeline to find the exact name.',
    ),
  forceRetryAllJobs: z
    .boolean()
    .optional()
    .describe(
      'When true (default), retries all jobs in the stage including those that already succeeded. '
      + 'Set to false to retry only the failed jobs.',
    ),
};

// Variable shape reused by both pipeline + release variable tools.
const VariableSetEntry = z.object({
  value: z.string().describe('New value. For secrets, this is the secret to store.'),
  isSecret: z
    .boolean()
    .optional()
    .describe(
      'Mark as secret. If omitted on a variable that was already a secret, '
      + 'the existing isSecret:true is preserved (declassification requires explicit isSecret:false).',
    ),
  allowOverride: z
    .boolean()
    .optional()
    .describe('Whether this variable can be overridden at queue time.'),
});

export const UpdatePipelineVariablesInput = {
  project: z.string().min(1),
  pipelineId: z.number().int().positive(),
  set: z
    .record(z.string().min(1), VariableSetEntry)
    .optional()
    .describe('Variables to add or update by name.'),
  remove: z
    .array(z.string().min(1))
    .optional()
    .describe('Variable names to delete from the definition.'),
};

export const UpdatePipelineTriggersInput = {
  project: z.string().min(1),
  pipelineId: z.number().int().positive(),
  triggers: z
    .array(z.record(z.string(), z.unknown()))
    .describe(
      'The full triggers array to set on the definition. Fetch the current definition via '
      + '`get_pipeline_definition` first, mutate the triggers array, then submit. The array '
      + 'replaces existing triggers wholesale — omitted triggers are removed.',
    ),
};

export const CreatePipelineInput = {
  project: z.string().min(1).describe('ADO project name.'),
  name: z
    .string()
    .min(1)
    .describe('Pipeline name. Must be unique within the folder.'),
  repository: z
    .string()
    .min(1)
    .describe(
      'Azure Repos git repository NAME (not id) that contains the YAML file. Resolved to the '
      + 'repository id automatically (case-insensitive match).',
    ),
  yamlPath: z
    .string()
    .min(1)
    .describe(
      'Path of the pipeline YAML file inside the repository, e.g. \'azure-pipelines.yml\' or '
      + '\'pipelines/deploy.yml\'. A leading \'/\' is added if missing.',
    ),
  folder: z
    .string()
    .min(1)
    .optional()
    .describe('Pipeline folder, e.g. \'\\Backend\'. Defaults to the root folder \'\\\'.'),
};

export const DeletePipelineInput = {
  project: z.string().min(1).describe('ADO project name.'),
  pipelineId: z
    .number()
    .int()
    .positive()
    .describe('The pipeline (build definition) id. Use `list_pipelines` to discover ids.'),
};
