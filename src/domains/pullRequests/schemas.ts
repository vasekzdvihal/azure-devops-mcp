import { z } from "zod";

// Common: project + repo can be omitted to trigger cwd auto-detection.
const repoCoords = {
  project: z.string().min(1).optional().describe(
    "ADO project name. If omitted, auto-detected from the current working directory's git remote.",
  ),
  repository: z.string().min(1).optional().describe(
    "ADO repository name. If omitted, auto-detected from the current working directory's git remote.",
  ),
};

export const ListPullRequestsInput = {
  ...repoCoords,
  status: z
    .enum(["active", "completed", "abandoned", "all"])
    .optional()
    .describe("Filter by PR status. Default: active."),
  creatorId: z.string().optional().describe("Filter to PRs authored by this identity id."),
  reviewerId: z.string().optional().describe("Filter to PRs where this identity is a reviewer."),
  targetRefName: z
    .string()
    .optional()
    .describe("Filter by target branch ref (e.g. 'refs/heads/main')."),
  top: z.number().int().positive().max(200).optional().describe("Max results (default 25)."),
  skip: z.number().int().nonnegative().optional().describe("Skip N results for pagination."),
};

export const PullRequestId = {
  ...repoCoords,
  pullRequestId: z.number().int().positive().describe("The pull-request id (an integer)."),
};

export const GetPullRequestDiffInput = {
  ...PullRequestId,
  path: z
    .string()
    .min(1)
    .describe("Repo-relative path of the file whose unified diff you want."),
  maxLines: z
    .number()
    .int()
    .positive()
    .max(5000)
    .optional()
    .describe("Truncate diff to this many lines (default 1000). A truncation marker is appended."),
};
