import type { ToolDefinition } from '../identity/tools.js';
import type { PullRequestsWriteService } from './writeService.js';
import {
  AbandonPullRequestInput,
  AddPullRequestCommentInput,
  AddPullRequestReviewersInput,
  CompletePullRequestInput,
  CreatePullRequestInput,
  RemovePullRequestReviewerInput,
  ReplyToPullRequestThreadInput,
  SetPullRequestAutoCompleteInput,
  SetPullRequestDraftStateInput,
  UpdatePullRequestInput,
  UpdatePullRequestThreadStatusInput,
  VoteOnPullRequestInput,
} from './schemas.js';

export function buildPullRequestWriteTools(svc: PullRequestsWriteService): ToolDefinition[] {
  return [
    {
      name: 'add_pull_request_comment',
      config: {
        title: 'Add a comment to a pull request',
        description:
          'Posts a new comment thread on a pull request. Body is markdown (ADO renders it). '
          + 'Optional `filePath` + `line` together create a line-anchored review note on a specific '
          + 'line of a specific file. Without those, the comment is a general PR-level comment.',
        inputSchema: AddPullRequestCommentInput,
      },
      handler: async args =>
        svc.addComment(args as Parameters<typeof svc.addComment>[0]),
    },
    {
      name: 'reply_to_pull_request_thread',
      config: {
        title: 'Reply to a pull request comment thread',
        description:
          'Appends a comment to an existing thread (by `threadId`). Use this to respond to a '
          + 'reviewer\'s question or to continue a conversation. Body is markdown.',
        inputSchema: ReplyToPullRequestThreadInput,
      },
      handler: async args =>
        svc.replyToThread(args as Parameters<typeof svc.replyToThread>[0]),
    },
    {
      name: 'update_pull_request_thread_status',
      config: {
        title: 'Resolve / change status of a pull request comment thread',
        description:
          'Sets a thread\'s status. The most common transition is `active` → `fixed` to mark the '
          + 'feedback as addressed. Other values: `wontFix`, `closed`, `byDesign`, `pending`.',
        inputSchema: UpdatePullRequestThreadStatusInput,
      },
      handler: async args =>
        svc.updateThreadStatus(args as Parameters<typeof svc.updateThreadStatus>[0]),
    },
    {
      name: 'vote_on_pull_request',
      config: {
        title: 'Cast or update your vote on a pull request',
        description:
          'Records your vote: `approve`, `approveWithSuggestions`, `wait`, `reject`, or `reset` '
          + '(clears your vote). Always confirms with the user before calling — vote is visible to '
          + 'all reviewers and is your name on the action.',
        inputSchema: VoteOnPullRequestInput,
      },
      handler: async args => svc.vote(args as Parameters<typeof svc.vote>[0]),
    },
    {
      name: 'update_pull_request',
      config: {
        title: 'Edit pull request title and/or description',
        description:
          'Updates the PR title, description, or both. Description is markdown. To set the draft '
          + 'state, use `set_pull_request_draft_state` instead.',
        inputSchema: UpdatePullRequestInput,
      },
      handler: async args =>
        svc.updatePullRequest(args as Parameters<typeof svc.updatePullRequest>[0]),
    },
    {
      name: 'set_pull_request_draft_state',
      config: {
        title: 'Mark a pull request as draft or publish it',
        description:
          'Toggles the draft state. Drafts can\'t receive votes from reviewers. Set `isDraft: false` '
          + 'when the PR is ready for review.',
        inputSchema: SetPullRequestDraftStateInput,
      },
      handler: async args =>
        svc.setDraftState(args as Parameters<typeof svc.setDraftState>[0]),
    },
    {
      name: 'add_pull_request_reviewers',
      config: {
        title: 'Add reviewers to a pull request',
        description:
          'Adds one or more identities as reviewers. Identity ids come from `whoami`, '
          + '`get_pull_request` (existing reviewers), or `list_projects` (team identities).',
        inputSchema: AddPullRequestReviewersInput,
      },
      handler: async args =>
        svc.addReviewers(args as Parameters<typeof svc.addReviewers>[0]),
    },
    {
      name: 'remove_pull_request_reviewer',
      config: {
        title: 'Remove a reviewer from a pull request',
        description: 'Removes one identity from the PR\'s reviewer list (by id).',
        inputSchema: RemovePullRequestReviewerInput,
      },
      handler: async args =>
        svc.removeReviewer(args as Parameters<typeof svc.removeReviewer>[0]),
    },
    {
      name: 'create_pull_request',
      config: {
        title: 'Create a new pull request',
        description:
          'Opens a new PR from `sourceBranch` into `targetBranch`. Branch names accept short form '
          + '(\'feature/x\') or full ref (\'refs/heads/feature/x\'). Title required, description recommended '
          + '(markdown). Optional `isDraft` and initial `reviewerIds`. Always confirm the source/target '
          + 'and title with the user before calling — opening a PR is visible to the team.',
        inputSchema: CreatePullRequestInput,
      },
      handler: async args => svc.createPr(args as Parameters<typeof svc.createPr>[0]),
    },
    {
      name: 'complete_pull_request',
      config: {
        title: 'Complete (merge) a pull request',
        description:
          'Merges a pull request using the chosen `mergeStrategy` (\'noFastForward\' / \'squash\' / '
          + '\'rebase\' / \'rebaseMerge\'). Optionally deletes the source branch and overrides the merge '
          + 'commit message. Use `bypassPolicy: true` only when explicitly authorized to skip required '
          + 'branch policies. Always confirm with the user before calling — merging is irreversible.',
        inputSchema: CompletePullRequestInput,
      },
      handler: async args => svc.completePr(args as Parameters<typeof svc.completePr>[0]),
    },
    {
      name: 'abandon_pull_request',
      config: {
        title: 'Abandon a pull request',
        description:
          'Closes a pull request without merging. Reversible — the PR can be reactivated by ADO '
          + 'users with permission. Use for stale PRs or ones superseded by another. Always confirm '
          + 'with the user before calling.',
        inputSchema: AbandonPullRequestInput,
      },
      handler: async args => svc.abandonPr(args as Parameters<typeof svc.abandonPr>[0]),
    },
    {
      name: 'set_pull_request_auto_complete',
      config: {
        title: 'Enable auto-complete on a pull request',
        description:
          'Sets the PR to auto-merge once required policies pass (CI green, required reviewers '
          + 'approve). Uses the configured PAT identity as the auto-complete owner — same as clicking '
          + '\'Set auto-complete\' in the ADO web UI. Always confirm with the user before calling.',
        inputSchema: SetPullRequestAutoCompleteInput,
      },
      handler: async args =>
        svc.setAutoComplete(args as Parameters<typeof svc.setAutoComplete>[0]),
    },
  ];
}
