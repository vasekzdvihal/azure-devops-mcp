# Azure DevOps MCP

Read-only Azure DevOps MCP server for Claude Code and other MCP hosts. v1 ships read-only PR review workflows for both **Azure DevOps Server** (on-prem) and **Azure DevOps Services** (cloud). Phase 2 will add write operations (create PR, comment, approve, etc.); read-only mode (see below) lets you opt out of those when they land.

## Setup

```bash
npx -y @vasekzdvihal/azure-devops-mcp setup
```

You'll be prompted for:

- **ADO base URL** — e.g. `https://dev.azure.com/myorg` (cloud) or `https://tfs.company.com/tfs/DefaultCollection` (on-prem).
- **Personal Access Token** — input is masked. Required scopes for v1: **Code (read)**, **Identity (read)**.
- **CA bundle path** (optional) — path to a PEM file. Set this if your on-prem ADO uses an internal CA that isn't in your OS trust store. Leave blank otherwise.

The wizard tests the connection before writing anything. Config goes to `~/.config/azure-devops-mcp/config.json` (mode `0600`); PAT goes to your OS keyring.

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

Set `AZURE_DEVOPS_READ_ONLY=true` in the `env` block to suppress write tools (when they land in Phase 2). Useful when:
- Your PAT is read-only and you want clean error UX.
- You want Claude to summarize PRs but never post on your behalf.

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

(In Phase 1 this is a no-op since all tools are reads. The flag is in place so Phase 2's write tools have a clean gate.)

### Cwd auto-detect

The pull-request tools auto-detect the current `project` and `repository` from your shell's `cwd` `.git/config remote.origin.url` when those args aren't passed. So `list_pull_requests` "just works" when Claude is run from inside an ADO checkout. Pass them explicitly to override.

## Available tools

| Tool                            | Description                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `whoami`                        | Returns the identity associated with the configured PAT.                                                 |
| `list_projects`                 | Lists ADO projects in the configured collection / org.                                                   |
| `list_repositories`             | Lists git repositories in a given project.                                                               |
| `list_pull_requests`            | Lists PRs in a repo (default: active). Supports filters: status, creator, reviewer, target branch.       |
| `get_pull_request`              | Full PR metadata: title, description, status, reviewers, branches, draft state, merge status.            |
| `list_pull_request_changes`     | Lists files changed in a PR with change types (add/edit/delete/rename). Cheap; no diff content.          |
| `get_pull_request_diff`         | Returns unified diff text for a single file in a PR (truncatable). Use after `list_pull_request_changes`. |
| `list_pull_request_comments`    | Returns comment threads on a PR (with line anchors).                                                     |
| `get_pull_request_iterations`   | Returns iteration history of a PR (each push = one iteration).                                           |

## Troubleshooting

- **"Azure DevOps MCP config not found"** — run setup.
- **"No PAT found in OS keyring"** — same fix; setup writes both.
- **"Authentication failed against Azure DevOps. The PAT may be expired..."** — regenerate the PAT and re-run setup. Required scopes: **Code (read)**, **Identity (read)**.
- **"TLS verification failed"** — your ADO Server uses a cert your machine doesn't trust. Re-run setup and provide the path to your organization's CA bundle (PEM file).
- **"Could not reach Azure DevOps"** — base URL or network issue.
- **"Could not resolve project + repository"** — you called a PR tool from outside an ADO checkout without passing `project`/`repository`. Either `cd` into the repo or pass the names.

## Development

```bash
npm install
npm test            # unit tests
npm run typecheck   # TypeScript check
npm run build       # compile to dist/
npm run dev         # run server from source via tsx
npm run setup       # run setup wizard from source
```

Architecture and design decisions live in `docs/superpowers/specs/2026-04-21-azure-devops-mcp-design.md`. Phase 1 implementation plan in `docs/superpowers/plans/2026-04-22-azure-devops-mcp-phase-1.md`.

## License

MIT
