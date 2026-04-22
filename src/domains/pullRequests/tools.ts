import type { PullRequestsService } from "./service.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  ListPullRequestsInput,
  PullRequestId,
  GetPullRequestDiffInput,
} from "./schemas.js";

export function buildPullRequestTools(svc: PullRequestsService): ToolDefinition[] {
  return [
    {
      name: "list_pull_requests",
      config: {
        title: "List pull requests",
        description:
          "Lists pull requests in an Azure DevOps repository. Defaults to active PRs. " +
          "If `project` and `repository` are omitted, the server auto-detects them from " +
          "the current working directory's git remote (when run from inside a checkout).",
        inputSchema: ListPullRequestsInput,
      },
      handler: async (args) => svc.list(args as Parameters<typeof svc.list>[0]),
    },
    {
      name: "get_pull_request",
      config: {
        title: "Get a pull request",
        description:
          "Returns full metadata for one pull request: title, description, status, author, " +
          "reviewers, branches, draft state, merge status. Use `list_pull_request_changes` to " +
          "see what files changed and `get_pull_request_diff` to see one file's actual diff.",
        inputSchema: PullRequestId,
      },
      handler: async (args) => svc.get(args as Parameters<typeof svc.get>[0]),
    },
    {
      name: "list_pull_request_changes",
      config: {
        title: "List files changed in a pull request",
        description:
          "Returns the list of files changed in a pull request with their change type " +
          "(add/edit/delete/rename). Cheap and complete — doesn't include diff content. " +
          "Use `get_pull_request_diff` to inspect a specific file's diff afterwards.",
        inputSchema: PullRequestId,
      },
      handler: async (args) => svc.listChanges(args as Parameters<typeof svc.listChanges>[0]),
    },
    {
      name: "get_pull_request_diff",
      config: {
        title: "Get unified diff for one file in a pull request",
        description:
          "Returns the unified diff for a single file in a pull request, as a string. " +
          "Diff is truncated at `maxLines` (default 1000). Binary files return a marker " +
          "rather than diff text. Use `list_pull_request_changes` first to find the path.",
        inputSchema: GetPullRequestDiffInput,
      },
      handler: async (args) => svc.getDiff(args as Parameters<typeof svc.getDiff>[0]),
    },
    {
      name: "list_pull_request_comments",
      config: {
        title: "List comment threads on a pull request",
        description:
          "Returns all comment threads on a pull request, including line-anchored comments " +
          "with file path and line number. Includes thread status (active/fixed/wontFix/closed).",
        inputSchema: PullRequestId,
      },
      handler: async (args) => svc.listComments(args as Parameters<typeof svc.listComments>[0]),
    },
    {
      name: "get_pull_request_iterations",
      config: {
        title: "List iterations of a pull request",
        description:
          "Returns the iteration history of a pull request — each iteration represents " +
          "a push to the source branch. Useful for tracking 'what changed since my last review'.",
        inputSchema: PullRequestId,
      },
      handler: async (args) => svc.getIterations(args as Parameters<typeof svc.getIterations>[0]),
    },
  ];
}
