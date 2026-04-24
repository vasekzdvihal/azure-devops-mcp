import { z } from "zod";

export const ProjectOnly = {
  project: z.string().min(1).describe("ADO project name."),
};

export const ListReleasesInput = {
  project: z.string().min(1).describe("ADO project name."),
  definitionId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Filter to releases of this release-definition id."),
  status: z
    .enum(["active", "abandoned", "draft"])
    .optional()
    .describe("Filter by release status. Default: no filter (all)."),
  top: z.number().int().positive().max(200).optional().describe("Max results (default 25)."),
};

export const ReleaseId = {
  project: z.string().min(1).describe("ADO project name."),
  releaseId: z.number().int().positive().describe("The release id (integer)."),
};

export const ListDeploymentsInput = {
  project: z.string().min(1).describe("ADO project name."),
  definitionId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Filter to this release-definition id."),
  status: z
    .enum([
      "notDeployed",
      "inProgress",
      "succeeded",
      "partiallySucceeded",
      "failed",
      "all",
    ])
    .optional()
    .describe("Filter by deployment status. 'all' returns every status."),
  top: z.number().int().positive().max(200).optional().describe("Max results (default 25)."),
};
