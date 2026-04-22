# Azure DevOps MCP

Read-only Azure DevOps MCP server for Claude Code and other MCP hosts.

**Phase 0** ships `whoami` only — a deliberate walking skeleton that proves the whole stack (config, OS keyring, TLS, MCP, ADO API) works end to end. **Phase 1** adds the read-only PR workflow: list PRs, get PR details, fetch diffs, read comments, list iterations, plus project/repo enumeration.

Supports both **Azure DevOps Server** (on-prem) and **Azure DevOps Services** (cloud).

## Setup

```bash
npx -y @vasekzdvihal/azure-devops-mcp setup
```

You'll be prompted for:

- **ADO base URL** — e.g. `https://dev.azure.com/myorg` (cloud) or `https://tfs.company.com/tfs/DefaultCollection` (on-prem).
- **Personal Access Token** — input is masked. Required scopes for v1: **Code (read)**, **Identity (read)**.
- **CA bundle path** (optional) — path to a PEM file. Set this if your on-prem ADO uses an internal CA that isn't in your OS trust store. Leave blank otherwise.

The wizard tests the connection before writing anything. If it fails, you'll see the error and be re-prompted — nothing lands on disk until the connection succeeds.

On success:

- Config is written to `~/.config/azure-devops-mcp/config.json` with mode `0600`.
- PAT is stored in your OS keyring (service `azure-devops-mcp`, account = the host portion of your base URL — so multiple ADO instances can coexist).
- A Claude Code MCP config snippet is printed for you to copy.

## Use with Claude Code

Add to your Claude Code MCP config (typically `~/.claude/settings.json`):

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

Restart Claude Code (or reload MCP servers). In a session, ask:

> use the azure-devops MCP to call whoami

You should see your Azure DevOps identity.

## Available tools (Phase 0)

| Tool      | Description                                                  |
| --------- | ------------------------------------------------------------ |
| `whoami`  | Returns the identity associated with the configured PAT.     |

Phase 1 will add: `list_projects`, `list_repositories`, `list_pull_requests`, `get_pull_request`, `get_pull_request_diff`, `list_pull_request_comments`, `get_pull_request_iterations`.

## Troubleshooting

- **"Azure DevOps MCP config not found"** — run the setup command above.
- **"No PAT found in OS keyring"** — same fix; setup writes both.
- **"Authentication failed against Azure DevOps. The PAT may be expired..."** — regenerate the PAT in ADO and re-run setup. The required scopes are **Code (read)** and **Identity (read)**.
- **"TLS verification failed"** — your ADO Server is using a cert your machine doesn't trust. Re-run setup and provide the path to your organization's CA bundle (PEM file) when prompted.
- **"Could not reach Azure DevOps"** — base URL or network issue. Confirm the URL is reachable from your machine (`curl -I <baseUrl>`).

## Development

```bash
npm install
npm test            # unit tests (26)
npm run typecheck   # TypeScript check
npm run build       # compile to dist/
npm run dev         # run server from source via tsx
npm run setup       # run setup wizard from source
```

Architecture, design rationale, and phase breakdown live in `docs/superpowers/specs/2026-04-21-azure-devops-mcp-design.md`. The Phase 0 implementation plan is in `docs/superpowers/plans/2026-04-21-azure-devops-mcp-phase-0.md`.

## License

MIT
