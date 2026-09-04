# Azure DevOps MCP

Azure DevOps MCP server for Claude Code and other MCP hosts. Supports both **Azure DevOps Server** (on-prem) and **Azure DevOps Services** (cloud). Ships read tools for PRs, releases, pipelines, and commit history; plus the full PR review write workflow — comment, reply, delete comments, resolve threads, vote, edit PR metadata, manage reviewers. Read-only mode is available for users who want a restricted surface.

## Setup

```bash
npx -y @vasekzdvihal/azure-devops-mcp setup
```

You'll be prompted for:

- **ADO base URL** — e.g. `https://dev.azure.com/myorg` (cloud) or `https://tfs.company.com/tfs/DefaultCollection` (on-prem).
- **Personal Access Token** — input is masked. See [Required PAT scopes](#required-pat-scopes) below.
- **CA bundle path** (optional) — path to a PEM file. Set this if your on-prem ADO uses an internal CA that isn't in your OS trust store. Leave blank otherwise.

The wizard tests the connection before writing anything. Config goes to `~/.config/azure-devops-mcp/config.json` (mode `0600`); PAT goes to your OS keyring.

### Headless / Docker (env vars)

Where there's no OS keyring — containers, CI, servers — configure entirely via environment variables instead of the wizard:

| Variable | Required | Value |
| --- | --- | --- |
| `AZURE_DEVOPS_BASE_URL` | yes | e.g. `https://dev.azure.com/myorg` or `https://tfs.company.com/tfs/DefaultCollection` |
| `AZURE_DEVOPS_KIND` | yes | `services` (cloud) or `server` (on-prem) |
| `AZURE_DEVOPS_PAT` | yes | the Personal Access Token |
| `AZURE_DEVOPS_CA_BUNDLE` | no | path to a PEM file for an internal CA |

Env vars are a complete, exclusive config source: if any of them is set, all required ones must be set, and the config file + keyring are never consulted (a stale file can't redirect your env PAT to a different host). Empty values count as unset. If none are set, the server falls back to the setup-wizard config.

## Required PAT scopes

| Mode | Required scopes |
| --- | --- |
| Read-only (read tools only) | **Code (read)**, **Identity (read)**, **Build (read)**, **Release (read)**, **Work Items (read)** |
| Full (default — read + write tools) | **Code (read & write)**, **Pull Request (read & write)**, **Identity (read)**, **Build (read & execute)**, **Release (read, write, execute, & manage)**, **Work Items (read & write)** |

The "manage" tier of Release is needed only by `delete_release_definition`; every other release tool works with "read, write, & execute".

A read-only PAT is the actual security guarantee — ADO enforces scope at the API regardless of what the MCP server exposes. The read-only mode env var (below) is an additional layer for users who can't or don't want to scope down their PAT.

## Use with Claude Code

Add to your `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["-y", "@vasekzdvihal/azure-devops-mcp"]
    }
  }
}
```

### Read-only mode

Set `AZURE_DEVOPS_READ_ONLY=true` in the `env` block to suppress write tools entirely:

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["-y", "@vasekzdvihal/azure-devops-mcp"],
      "env": { "AZURE_DEVOPS_READ_ONLY": "true" }
    }
  }
}
```

When set, the LLM's tool list contains only the read tools — `add_pull_request_comment`, `vote_on_pull_request`, etc. don't exist on the surface. Useful when you want Claude to summarize/analyze PRs but never post on your behalf, even though your PAT has write scope.

### Cwd auto-detect

The pull-request tools auto-detect the current `project` and `repository` from your shell's `cwd` `.git/config remote.origin.url` when those args aren't passed. So `list_pull_requests` and `add_pull_request_comment` "just work" when Claude is run from inside an ADO checkout. Pass them explicitly to override.

## Available tools

### Read tools (always available)

| Tool | Description |
| --- | --- |
| `whoami` | Returns the identity associated with the configured PAT. |
| `list_projects` | Lists ADO projects in the configured collection / org. |
| `list_repositories` | Lists git repositories in a given project. |
| `list_pull_requests` | Lists PRs in a repo (default: active). Filters: status, creator, reviewer, target branch. |
| `get_pull_request` | Full PR metadata: title, description, status, reviewers, branches, draft state, merge status. |
| `list_pull_request_changes` | Lists files changed in a PR with change types. Cheap; no diff content. |
| `get_pull_request_diff` | Returns unified diff text for a single file in a PR (truncatable). |
| `list_pull_request_comments` | Returns comment threads on a PR (with line anchors). |
| `get_pull_request_iterations` | Returns iteration history of a PR (each push = one iteration). |
| `list_release_definitions` | Lists classic Release pipeline definitions in a project. |
| `get_release_definition` | Full release-definition detail: variables, variable groups, artifacts, triggers, environments (with approvals + deploy task counts). Pass `verbose: true` for the full task list. |
| `list_releases` | Lists release runs. Filter by definitionId or status (active/abandoned/draft). |
| `get_release` | Full release: stages (name, status, who deployed, when) and artifacts (source build + branch). |
| `list_deployments` | Per-stage flattened view — best for "who last deployed X to production?". |
| `list_pipelines` | Lists build/pipeline definitions. Covers classic-build and YAML; `type` field distinguishes. |
| `get_pipeline_definition` | Full pipeline-definition detail: type (yaml/classic), repository, default branch, YAML file path, variables, variable groups, triggers (CI/PR/schedule with branch & path filters). |
| `list_pipeline_runs` | Lists runs (builds). Filter by pipelineId, branch, status, result. |
| `get_pipeline_run` | Run detail with stages timeline — how you see if a YAML multi-stage stage succeeded. |
| `list_branches` | Branches in a repo with last commit id + ahead/behind. Auto-detects repo from cwd. |
| `list_commits` | Commits on a branch. Filter by fromDate, toDate, author, top. Auto-detects repo from cwd. |
| `list_pending_approvals` | List pending release approvals; companion to `approve_release_gate`. |
| `list_work_items` | Lists work items with convenience filters: `myActive`, `linkedToPr`, `currentIteration`, `tag`. |
| `get_work_item` | Full work item detail: all fields, relations, and recent comments (with ids). |

### Write tools (suppressed in read-only mode)

| Tool | Description |
| --- | --- |
| `add_pull_request_comment` | Post a new comment thread. Optional `filePath` + `line` for line-anchored review notes. Body is markdown. |
| `reply_to_pull_request_thread` | Append a comment to an existing thread. |
| `delete_pull_request_comment` | Permanently delete one comment from a thread (deleting the first comment removes the whole thread). Confirms before calling. |
| `update_pull_request_thread_status` | Resolve a thread (`fixed`) or change its status (`wontFix` / `closed` / `byDesign` / `pending`). |
| `vote_on_pull_request` | Cast or update your vote: `approve` / `approveWithSuggestions` / `wait` / `reject` / `reset`. |
| `update_pull_request` | Edit PR title and/or description (markdown). |
| `set_pull_request_draft_state` | Mark draft or publish (`isDraft: true/false`). |
| `add_pull_request_reviewers` | Add one or more identities as reviewers. |
| `remove_pull_request_reviewer` | Remove one identity from the reviewer list. |
| `create_pull_request` | Open a new PR. Source/target branch (short or full ref), title, optional description / draft / reviewers. |
| `complete_pull_request` | Merge a PR. Choose strategy: `noFastForward` / `squash` / `rebase` / `rebaseMerge`. |
| `abandon_pull_request` | Close a PR without merging (reversible). |
| `set_pull_request_auto_complete` | Enable auto-complete — merge once required policies pass. Uses configured PAT identity as owner. |
| `queue_pipeline_run` | Start a new build/run; supports template parameters and variable overrides. |
| `cancel_pipeline_run` | Cancel an in-progress build. |
| `update_build_tags` | Add and/or remove tags on a build. |
| `create_release` | Create a release; auto-shapes artifact bindings from `{ alias, buildId }`. |
| `deploy_release_stage` | Manually deploy one environment of a release (confirms before calling). |
| `approve_release_gate` | Approve or reject a pending release approval (confirms before calling). |
| `cancel_release` | Abandon an in-flight release. |
| `retry_pipeline_stage` | Re-run a single stage of a completed YAML run (all jobs by default). |
| `update_pipeline_variables` | Add, change, or remove pipeline-definition variables; existing secrets are preserved. |
| `update_pipeline_triggers` | Replace a pipeline definition's trigger list (fetch the current one with `get_pipeline_definition` first). |
| `update_release_variables` | Add, change, or remove release-definition variables; existing secrets are preserved. |
| `update_release_environment_variables` | Per-environment variable overrides on a release definition. |
| `link_work_item_to_pr` | Add an artifact link between a work item and a pull request. |
| `update_work_item_state` | Move a work item to a new state; validated against the type's allowed states first. |
| `add_work_item_comment` | Append a discussion comment to a work item (markdown). |
| `delete_work_item_comment` | Permanently delete one discussion comment from a work item. Confirms before calling. |

## Troubleshooting

- **"Azure DevOps MCP config not found"** — run setup.
- **"No PAT found in OS keyring"** — same fix; setup writes both.
- **"Authentication failed against Azure DevOps. The PAT may be expired..."** — regenerate the PAT and re-run setup. See [Required PAT scopes](#required-pat-scopes).
- **"TLS verification failed"** — your ADO Server uses a cert your machine doesn't trust. Re-run setup and provide the path to your organization's CA bundle (PEM file).
- **"Could not reach Azure DevOps"** — base URL or network issue.
- **"Could not resolve project + repository"** — you called a PR tool from outside an ADO checkout without passing `project`/`repository`. Either `cd` into the repo or pass the names.
- **"Conflict from Azure DevOps"** — the PR or thread state changed (already abandoned/completed/closed) since your read. Re-fetch with `get_pull_request` and try again.

## Development

```bash
npm install
npm test            # unit tests
npm run typecheck   # TypeScript check
npm run build       # compile to dist/
npm run dev         # run server from source via tsx
npm run setup       # run setup wizard from source
```

Architecture and design decisions live in `docs/superpowers/specs/2026-04-21-azure-devops-mcp-design.md`. Per-phase implementation plans in `docs/superpowers/plans/`. Roadmap in `docs/ROADMAP.md`.

## License

MIT
