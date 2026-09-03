import { z } from 'zod';

const MAX_TOP = 200;
const MAX_DIFF_LINES = 5000;

// Common: project + repo can be omitted to trigger cwd auto-detection.
const repoCoords = {
  project: z.string().min(1).optional().describe(
    'ADO project name. If omitted, auto-detected from the current working directory\'s git remote.',
  ),
  repository: z.string().min(1).optional().describe(
    'ADO repository name. If omitted, auto-detected from the current working directory\'s git remote.',
  ),
};

export const ListPullRequestsInput = {
  ...repoCoords,
  status: z
    .enum(['active', 'completed', 'abandoned', 'all'])
    .optional()
    .describe('Filter by PR status. Default: active.'),
  creatorId: z.string().optional().describe('Filter to PRs authored by this identity id.'),
  reviewerId: z.string().optional().describe('Filter to PRs where this identity is a reviewer.'),
  targetRefName: z
    .string()
    .optional()
    .describe('Filter by target branch ref (e.g. \'refs/heads/main\').'),
  top: z.number().int().positive().max(MAX_TOP).optional().describe('Max results (default 25).'),
  skip: z.number().int().nonnegative().optional().describe('Skip N results for pagination.'),
};

export const PullRequestId = {
  ...repoCoords,
  pullRequestId: z.number().int().positive().describe('The pull-request id (an integer).'),
};

export const GetPullRequestDiffInput = {
  ...PullRequestId,
  path: z
    .string()
    .min(1)
    .describe('Repo-relative path of the file whose unified diff you want.'),
  maxLines: z
    .number()
    .int()
    .positive()
    .max(MAX_DIFF_LINES)
    .optional()
    .describe('Truncate diff to this many lines (default 1000). A truncation marker is appended.'),
};

export const AddPullRequestCommentInput = {
  ...PullRequestId,
  content: z.string().min(1).describe(
    'Markdown comment body. ADO renders markdown — feel free to use code blocks, lists, links.',
  ),
  filePath: z
    .string()
    .optional()
    .describe(
      'Repo-relative path of the file to anchor the comment to. '
      + 'If omitted, the comment is a general PR-level comment (not on a specific file).',
    ),
  line: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('1-based line number to anchor the comment to. Required if `filePath` is set.'),
};

export const ReplyToPullRequestThreadInput = {
  ...PullRequestId,
  threadId: z.number().int().positive().describe('The thread id to reply in.'),
  content: z.string().min(1).describe('Markdown reply body.'),
};

export const DeletePullRequestCommentInput = {
  ...PullRequestId,
  threadId: z.number().int().positive().describe('The thread id that contains the comment.'),
  commentId: z
    .number()
    .int()
    .positive()
    .describe('The comment id to delete. Get it from `list_pull_request_comments`.'),
};

export const UpdatePullRequestThreadStatusInput = {
  ...PullRequestId,
  threadId: z.number().int().positive().describe('The thread id to update.'),
  status: z
    .enum(['active', 'fixed', 'wontFix', 'closed', 'byDesign', 'pending'])
    .describe('New thread status. \'fixed\' is the most common — marks the thread as resolved.'),
};

export const VoteOnPullRequestInput = {
  ...PullRequestId,
  vote: z
    .enum(['approve', 'approveWithSuggestions', 'wait', 'reject', 'reset'])
    .describe(
      'Your vote on this PR. \'reset\' clears your existing vote (e.g. you voted earlier but want to abstain).',
    ),
};

export const UpdatePullRequestInput = {
  ...PullRequestId,
  title: z.string().min(1).optional().describe('New PR title.'),
  description: z.string().optional().describe('New PR description (markdown). Pass empty string to clear.'),
};

export const SetPullRequestDraftStateInput = {
  ...PullRequestId,
  isDraft: z.boolean().describe('true to mark as draft, false to publish.'),
};

export const AddPullRequestReviewersInput = {
  ...PullRequestId,
  reviewerIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('Array of identity ids to add as reviewers. Use whoami / list_pull_requests to find ids.'),
};

export const RemovePullRequestReviewerInput = {
  ...PullRequestId,
  reviewerId: z.string().min(1).describe('The identity id to remove from reviewers.'),
};

// --- lifecycle (Phase 2.1) ---

const mergeStrategy = z
  .enum(['noFastForward', 'squash', 'rebase', 'rebaseMerge'])
  .describe(
    'Merge strategy. \'noFastForward\' = merge commit (default in ADO UI); \'squash\' = squash to one commit; '
    + '\'rebase\' = rebase source onto target then fast-forward; \'rebaseMerge\' = rebase + merge commit (semi-linear).',
  );

export const CreatePullRequestInput = {
  project: z.string().min(1).optional().describe(
    'ADO project name. If omitted, auto-detected from cwd\'s git remote.',
  ),
  repository: z.string().min(1).optional().describe(
    'ADO repository name. If omitted, auto-detected from cwd\'s git remote.',
  ),
  sourceBranch: z
    .string()
    .min(1)
    .describe('Source branch — short name (e.g. \'feature/x\') or full ref (\'refs/heads/feature/x\').'),
  targetBranch: z
    .string()
    .min(1)
    .describe('Target branch — short name or full ref. Usually \'main\' or a release branch.'),
  title: z.string().min(1).describe('PR title.'),
  description: z
    .string()
    .optional()
    .describe('PR description body (markdown). Optional but recommended.'),
  isDraft: z
    .boolean()
    .optional()
    .describe('Create as a draft PR (default false). Drafts skip required-reviewer auto-assignment.'),
  reviewerIds: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional initial reviewer identity ids. You can also add reviewers later with '
      + '`add_pull_request_reviewers`.',
    ),
};

export const CompletePullRequestInput = {
  ...PullRequestId,
  mergeStrategy,
  deleteSourceBranch: z
    .boolean()
    .optional()
    .describe('Delete the source branch after merge (default false).'),
  mergeCommitMessage: z
    .string()
    .optional()
    .describe('Override the merge commit message. If omitted, ADO generates one.'),
  bypassPolicy: z
    .boolean()
    .optional()
    .describe(
      'Bypass branch policies (requires policy bypass permission). Use sparingly — typically for hotfixes.',
    ),
  bypassReason: z
    .string()
    .optional()
    .describe('Reason recorded when bypassing policies. Required by some orgs when bypassPolicy=true.'),
};

export const AbandonPullRequestInput = {
  ...PullRequestId,
};

export const SetPullRequestAutoCompleteInput = {
  ...PullRequestId,
  mergeStrategy,
  deleteSourceBranch: z
    .boolean()
    .optional()
    .describe('Delete the source branch after auto-complete merges (default false).'),
  mergeCommitMessage: z
    .string()
    .optional()
    .describe('Override the merge commit message used when auto-complete fires.'),
};
