import { z } from "zod";

export const ListPipelinesInput = {
  project: z.string().min(1).describe("ADO project name."),
  repositoryId: z
    .string()
    .optional()
    .describe(
      "Filter to pipelines that build this repository id (GUID). " +
        "Use `list_repositories` to resolve repo name → id.",
    ),
};

export const ListPipelineRunsInput = {
  project: z.string().min(1).describe("ADO project name."),
  pipelineId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Filter to runs of this pipeline id."),
  branch: z
    .string()
    .optional()
    .describe("Filter by source branch ref (e.g. 'refs/heads/main')."),
  status: z
    .enum(["inProgress", "completed", "cancelling", "postponed", "notStarted"])
    .optional()
    .describe("Filter by run status."),
  result: z
    .enum(["succeeded", "partiallySucceeded", "failed", "canceled"])
    .optional()
    .describe("Filter by run result (only relevant when status is 'completed')."),
  top: z.number().int().positive().max(200).optional().describe("Max results (default 25)."),
};

export const PipelineRunId = {
  project: z.string().min(1).describe("ADO project name."),
  runId: z.number().int().positive().describe("The run id (integer)."),
};

export const PipelineDefinitionId = {
  project: z.string().min(1).describe("ADO project name."),
  definitionId: z
    .number()
    .int()
    .positive()
    .describe(
      "The pipeline definition id (integer). Use `list_pipelines` to discover ids.",
    ),
};

export const QueuePipelineRunInput = z.object({
  project: z.string().min(1).describe("Project name or id"),
  pipelineId: z.number().int().positive().describe("Pipeline (build definition) id"),
  branch: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Source ref to run the pipeline on (e.g. 'refs/heads/main' or 'main'). " +
        "Omit to use the pipeline's default branch.",
    ),
  templateParameters: z
    .record(z.string(), z.string())
    .optional()
    .describe("Template parameters to override (YAML pipelines only)"),
  variables: z
    .record(
      z.string(),
      z.object({
        value: z.string(),
        isSecret: z.boolean().optional(),
      }),
    )
    .optional()
    .describe("Run-scoped variable overrides"),
});

export const CancelPipelineRunInput = z.object({
  project: z.string().min(1),
  runId: z.number().int().positive().describe("Build/run id"),
});

export const UpdateBuildTagsInput = z
  .object({
    project: z.string().min(1),
    runId: z.number().int().positive(),
    addTags: z.array(z.string().min(1)).optional(),
    removeTags: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => (v.addTags?.length ?? 0) + (v.removeTags?.length ?? 0) > 0, {
    message: "Provide at least one tag in addTags or removeTags",
  });
