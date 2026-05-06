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

export const ReleaseDefinitionId = {
  project: z.string().min(1).describe("ADO project name."),
  definitionId: z
    .number()
    .int()
    .positive()
    .describe(
      "The release-definition id (integer). Use `list_release_definitions` to discover ids.",
    ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "When true, includes the full task list (display name + ref name + enabled flag) for " +
        "each environment's deploy phases. When false (default), only the per-stage task count " +
        "is returned, which keeps the payload small for definitions with dozens of tasks.",
    ),
};

export const ListDeploymentsInput = {
  project: z.string().min(1).describe("ADO project name."),
  definitionId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Filter to this release-definition id."),
  environmentName: z
    .string()
    .optional()
    .describe(
      "Filter to deployments whose target environment name matches (case-insensitive exact " +
        "match). Applied client-side after fetch because the SDK only takes numeric environment " +
        "ids — so combine with a tight `top` to keep the server-side fetch small.",
    ),
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
