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

export const AddPullRequestCommentInput = {
  ...PullRequestId,
  content: z.string().min(1).describe(
    "Markdown comment body. ADO renders markdown — feel free to use code blocks, lists, links.",
  ),
  filePath: z
    .string()
    .optional()
    .describe(
      "Repo-relative path of the file to anchor the comment to. " +
        "If omitted, the comment is a general PR-level comment (not on a specific file).",
    ),
  line: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based line number to anchor the comment to. Required if `filePath` is set."),
};

export const ReplyToPullRequestThreadInput = {
  ...PullRequestId,
  threadId: z.number().int().positive().describe("The thread id to reply in."),
  content: z.string().min(1).describe("Markdown reply body."),
};

export const UpdatePullRequestThreadStatusInput = {
  ...PullRequestId,
  threadId: z.number().int().positive().describe("The thread id to update."),
  status: z
    .enum(["active", "fixed", "wontFix", "closed", "byDesign", "pending"])
    .describe("New thread status. 'fixed' is the most common — marks the thread as resolved."),
};

export const VoteOnPullRequestInput = {
  ...PullRequestId,
  vote: z
    .enum(["approve", "approveWithSuggestions", "wait", "reject", "reset"])
    .describe(
      "Your vote on this PR. 'reset' clears your existing vote (e.g. you voted earlier but want to abstain).",
    ),
};

export const UpdatePullRequestInput = {
  ...PullRequestId,
  title: z.string().min(1).optional().describe("New PR title."),
  description: z.string().optional().describe("New PR description (markdown). Pass empty string to clear."),
};

export const SetPullRequestDraftStateInput = {
  ...PullRequestId,
  isDraft: z.boolean().describe("true to mark as draft, false to publish."),
};

export const AddPullRequestReviewersInput = {
  ...PullRequestId,
  reviewerIds: z
    .array(z.string().min(1))
    .min(1)
    .describe("Array of identity ids to add as reviewers. Use whoami / list_pull_requests to find ids."),
};

export const RemovePullRequestReviewerInput = {
  ...PullRequestId,
  reviewerId: z.string().min(1).describe("The identity id to remove from reviewers."),
};
