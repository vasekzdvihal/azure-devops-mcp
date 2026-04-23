import type { PullRequestsWriteService } from "./writeService.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  AddPullRequestCommentInput,
  ReplyToPullRequestThreadInput,
  UpdatePullRequestThreadStatusInput,
  VoteOnPullRequestInput,
  UpdatePullRequestInput,
  SetPullRequestDraftStateInput,
  AddPullRequestReviewersInput,
  RemovePullRequestReviewerInput,
} from "./schemas.js";

export function buildPullRequestWriteTools(svc: PullRequestsWriteService): ToolDefinition[] {
  return [
    {
      name: "add_pull_request_comment",
      config: {
        title: "Add a comment to a pull request",
        description:
          "Posts a new comment thread on a pull request. Body is markdown (ADO renders it). " +
          "Optional `filePath` + `line` together create a line-anchored review note on a specific " +
          "line of a specific file. Without those, the comment is a general PR-level comment.",
        inputSchema: AddPullRequestCommentInput,
      },
      handler: async (args) =>
        svc.addComment(args as Parameters<typeof svc.addComment>[0]),
    },
    {
      name: "reply_to_pull_request_thread",
      config: {
        title: "Reply to a pull request comment thread",
        description:
          "Appends a comment to an existing thread (by `threadId`). Use this to respond to a " +
          "reviewer's question or to continue a conversation. Body is markdown.",
        inputSchema: ReplyToPullRequestThreadInput,
      },
      handler: async (args) =>
        svc.replyToThread(args as Parameters<typeof svc.replyToThread>[0]),
    },
    {
      name: "update_pull_request_thread_status",
      config: {
        title: "Resolve / change status of a pull request comment thread",
        description:
          "Sets a thread's status. The most common transition is `active` → `fixed` to mark the " +
          "feedback as addressed. Other values: `wontFix`, `closed`, `byDesign`, `pending`.",
        inputSchema: UpdatePullRequestThreadStatusInput,
      },
      handler: async (args) =>
        svc.updateThreadStatus(args as Parameters<typeof svc.updateThreadStatus>[0]),
    },
    {
      name: "vote_on_pull_request",
      config: {
        title: "Cast or update your vote on a pull request",
        description:
          "Records your vote: `approve`, `approveWithSuggestions`, `wait`, `reject`, or `reset` " +
          "(clears your vote). Always confirms with the user before calling — vote is visible to " +
          "all reviewers and is your name on the action.",
        inputSchema: VoteOnPullRequestInput,
      },
      handler: async (args) => svc.vote(args as Parameters<typeof svc.vote>[0]),
    },
    {
      name: "update_pull_request",
      config: {
        title: "Edit pull request title and/or description",
        description:
          "Updates the PR title, description, or both. Description is markdown. To set the draft " +
          "state, use `set_pull_request_draft_state` instead.",
        inputSchema: UpdatePullRequestInput,
      },
      handler: async (args) =>
        svc.updatePullRequest(args as Parameters<typeof svc.updatePullRequest>[0]),
    },
    {
      name: "set_pull_request_draft_state",
      config: {
        title: "Mark a pull request as draft or publish it",
        description:
          "Toggles the draft state. Drafts can't receive votes from reviewers. Set `isDraft: false` " +
          "when the PR is ready for review.",
        inputSchema: SetPullRequestDraftStateInput,
      },
      handler: async (args) =>
        svc.setDraftState(args as Parameters<typeof svc.setDraftState>[0]),
    },
    {
      name: "add_pull_request_reviewers",
      config: {
        title: "Add reviewers to a pull request",
        description:
          "Adds one or more identities as reviewers. Identity ids come from `whoami`, " +
          "`get_pull_request` (existing reviewers), or `list_projects` (team identities).",
        inputSchema: AddPullRequestReviewersInput,
      },
      handler: async (args) =>
        svc.addReviewers(args as Parameters<typeof svc.addReviewers>[0]),
    },
    {
      name: "remove_pull_request_reviewer",
      config: {
        title: "Remove a reviewer from a pull request",
        description: "Removes one identity from the PR's reviewer list (by id).",
        inputSchema: RemovePullRequestReviewerInput,
      },
      handler: async (args) =>
        svc.removeReviewer(args as Parameters<typeof svc.removeReviewer>[0]),
    },
  ];
}
