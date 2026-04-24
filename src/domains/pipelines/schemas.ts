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
