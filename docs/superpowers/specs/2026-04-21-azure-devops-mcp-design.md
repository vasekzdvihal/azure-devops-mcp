# Azure DevOps MCP Server — Design

**Status:** Draft
**Date:** 2026-04-21
**Owner:** Vášek Zdvihal

## 1. Goal

A public, generic MCP server that lets Claude Code (and other MCP hosts) interact with Azure DevOps. v1 ships read-only pull request workflows for both on-prem **Azure DevOps Server** and cloud **Azure DevOps Services**. Built to grow into pipelines, releases, and work items in later iterations — one domain at a time.

## 2. Scope

### In scope (v1)

Tools, all read-only:

- `whoami` — return authenticated user
- `list_projects` — list projects in the configured collection/org
- `list_repositories` — list git repos in a project
- `list_pull_requests` — filter by status, author, reviewer, target branch
- `get_pull_request` — full metadata for one PR
- `get_pull_request_diff` — diff with file-path filter and truncation guard
- `list_pull_request_comments` — all comment threads, with line anchors
- `get_pull_request_iterations` — iteration history (each push)

Setup wizard CLI for first-run config.

Distribution: published to the public npm registry as `@<scope-tbd>/azure-devops-mcp` (scope name to be chosen before publish).

### Out of scope (v1)

- Any write operations (create PR, comment, approve, abandon)
- Pipelines, releases, work items, wiki, artifacts
- Multiple ADO instances configured simultaneously in one server install (single ADO connection per install; users wanting two configure two MCP entries)
- Non-PAT auth (no AAD/OAuth)
- HTTP/SSE MCP transport (stdio only, since Claude Code launches MCP servers as local subprocesses)

## 3. Non-goals

- Not a kitchen-sink ADO mirror. We expose what Claude Code use cases actually need.
- Not org-specific. No baked-in assumptions about a particular ADO instance, project, or workflow.
- Not a replacement for `git`/`az` CLI tools — we focus on what an MCP host needs that those tools don't easily provide.

## 4. Decisions

| Topic | Choice | Rationale |
|---|---|---|
| Language/runtime | TypeScript on Node.js (≥20) | Most mature MCP SDK, strong ADO SDK, easy `npx` distribution |
| MCP transport | stdio | Standard for Claude Code subprocess MCP servers |
| Distribution | Public npm package, run via `npx -y` | Easiest install for any user; updates by version bump |
| ADO client lib | `azure-devops-node-api` (MIT, v15.x active as of 2026-02) | Saves weeks of REST plumbing; permissive license; supports both Server and Services |
| Client architecture | Thin wrapper (`AdoClient` interface) over the SDK | Domains depend on interface, not SDK; tests inject fake; SDK churn isolated |
| Code organization | Domain-first folders | Everything for one capability lives together; new domains = new folders, not new files in flat directories |
| Repo discovery | Auto-detect from cwd `.git/config`, fallback to explicit args | Lowest friction for "review my PR" |
| PAT storage | OS keyring via `@napi-rs/keyring` | OS-grade security, cross-platform, no plaintext on disk |
| Other config storage | Plain JSON at `~/.config/azure-devops-mcp/config.json` (0600) | Non-secret; easy to inspect; survives reinstalls |
| TLS | Strict by default; opt-in CA bundle path in config | Safe default; clean escape hatch for on-prem internal CAs |
| Cloud + on-prem | Both supported in v1 | SDK handles both; near-zero extra cost; bigger audience |
| Validation | `zod` for tool inputs and config schema | Standard for TS, integrates with MCP tool schema generation |
| Tool naming | Short, unprefixed names (`whoami`, `list_pull_requests`, …) | Matches modern MCP convention (GitHub, Linear, Filesystem MCP). Hosts already namespace as `mcp__<server>__<tool>`, so the in-server prefix is redundant. Discoverability lives in tool *descriptions*, not names. |
| Read-only mode | Env var `AZURE_DEVOPS_READ_ONLY=true` skips registration of write tools | Lets users restrict the surface to read operations only — important for code-review use cases, for read-only PATs, and for "Claude can summarize but not post" team policies. No effect in v1 (all tools are reads); plumbing introduced in Phase 1, gates write tools when they land in Phase 2. |

## 5. Architecture

### 5.1 Module map

```
src/
  index.ts                       # MCP server bootstrap (stdio); composition root
  setup.ts                       # CLI wizard entry point

  config/
    paths.ts                     # XDG paths (~/.config/azure-devops-mcp/)
    configFile.ts                # read/write config.json
    keyring.ts                   # store/load PAT via @napi-rs/keyring
    schema.ts                    # zod schemas for config + keyring entries

  ado/
    client.ts                    # AdoClient interface (the seam)
    sdkClient.ts                 # AdoClient impl backed by azure-devops-node-api
    tlsAgent.ts                  # builds https.Agent honoring caBundlePath
    errors.ts                    # AdoError taxonomy + SDK-error mapper
    types.ts                     # re-exports of SDK types we expose at the seam

  git/
    detectRepo.ts                # parse cwd .git/config remote
    parseRemoteUrl.ts            # ADO Server vs Services URL parsing (pure)

  domains/
    pullRequests/
      tools.ts                   # MCP tool definitions
      schemas.ts                 # zod input schemas
      service.ts                 # business logic; depends on AdoClient
      diffShaper.ts              # diff truncation/filter (pure)
    projects/
      tools.ts
      service.ts
    repositories/
      tools.ts
      service.ts
    identity/
      tools.ts                   # whoami
      service.ts

  mcp/
    registerTools.ts             # collects domain tools; registers with MCP SDK
    errorBoundary.ts             # converts thrown errors to MCP tool-error responses
    types.ts

test/
  unit/                          # Vitest, FakeAdoClient
  contract/                      # opt-in, recorded fixtures
  fakes/
    FakeAdoClient.ts
```

### 5.2 Dependency rules

- `domains/*` may import from `ado/`, `config/`, `git/`.
- `domains/*` MUST NOT import from another `domains/*`. Share via infra layers if needed.
- `ado/`, `config/`, `git/` MUST NOT import from `domains/`.
- `mcp/` is the orchestration layer; it imports from domains and infra.

Enforced by convention; can add an eslint boundary plugin later if it becomes an issue.

### 5.3 The AdoClient seam

Single interface exposing only methods our domains need. Two implementations: the SDK-backed one for prod, an in-memory fake for tests. New endpoints get added to the interface only when a domain needs them.

```ts
export interface AdoClient {
  whoami(): Promise<IdentityRef>;

  listProjects(): Promise<TeamProjectReference[]>;
  listRepositories(projectId: string): Promise<GitRepository[]>;

  listPullRequests(args: {
    projectId: string;
    repositoryId: string;
    status?: "active" | "completed" | "abandoned" | "all";
    creatorId?: string;
    reviewerId?: string;
    targetRefName?: string;
    top?: number;
    skip?: number;
  }): Promise<GitPullRequest[]>;

  getPullRequest(args: {
    projectId: string;
    repositoryId: string;
    pullRequestId: number;
  }): Promise<GitPullRequest>;

  getPullRequestDiff(args: {
    projectId: string;
    repositoryId: string;
    pullRequestId: number;
    iterationId?: number;
    baseIterationId?: number;
  }): Promise<FileDiff[]>;

  listPullRequestThreads(args: {
    projectId: string;
    repositoryId: string;
    pullRequestId: number;
  }): Promise<GitPullRequestCommentThread[]>;

  listPullRequestIterations(args: {
    projectId: string;
    repositoryId: string;
    pullRequestId: number;
  }): Promise<GitPullRequestIteration[]>;
}
```

## 6. Data flow (typical tool call)

```
Claude Code (MCP host)
    │  stdio: tools/call { name: "get_pull_request", args: { id: 1234 } }
    ▼
mcp/registerTools  →  domains/pullRequests/tools.ts
    │  validates args (zod)
    ▼
domains/pullRequests/service.ts
    │  resolveRepo(args, cwd):
    │     - if args.project & args.repo provided → use them
    │     - else git/detectRepo from cwd → { project, repo }
    │     - else throw RepoContextError("no repo context, pass project+repository")
    ▼
ado/sdkClient.getPullRequest({ projectId, repositoryId, pullRequestId: 1234 })
    │  WebApi (cached at startup) → getGitApi() → SDK call
    │  on error: ado/errors maps to AdoAuthError | AdoNotFoundError | AdoNetworkError | AdoUnknownError
    ▼
service shapes response (drop noisy fields, keep id/title/status/url/reviewers/etc.)
    ▼
tool returns { content: [{ type: "text", text: JSON.stringify(shaped) }] }
```

**Invariant:** domains never see SDK exceptions. `sdkClient` always throws our `AdoError` subclasses; `mcp/errorBoundary` converts them to MCP error responses with friendly messages.

## 7. Setup flow

The package declares a single bin entry, `azure-devops-mcp`. With no arguments it starts the MCP server (`src/index.ts`). With the `setup` argument it runs the wizard (`src/setup.ts`). One bin keeps `package.json` simple and gives users a memorable single-name interface.

`npx -y @<scope>/azure-devops-mcp setup` runs the wizard:

1. Prompt: ADO base URL (paste full URL; detect Server vs Services from host).
2. Prompt: PAT (masked input).
3. Prompt: optional CA bundle path (skip if empty).
4. **Test connection:** call `whoami` against the inputs. On failure, show the mapped error and re-prompt; do not write anything until success.
5. Write config to `~/.config/azure-devops-mcp/config.json` with file mode `0600`.
6. Write PAT to OS keyring. Service: `azure-devops-mcp`. Account: host portion of `baseUrl` (so multiple ADO instances can coexist if the user later runs two server entries).
7. Print a Claude Code MCP config snippet for the user to copy-paste:
   ```json
   {
     "mcpServers": {
       "azure-devops": {
         "command": "npx",
         "args": ["-y", "@<scope>/azure-devops-mcp"]
       }
     }
   }
   ```

**Subsequent server starts** (`src/index.ts`):
- Load config; if missing, exit non-zero with one-line "run `npx @<scope>/azure-devops-mcp setup`" message.
- Load PAT from keyring; same handling if missing.
- Build `WebApi` with PAT auth and TLS agent honoring optional CA bundle.
- Register tools via `mcp/registerTools`.
- Listen on stdio.

## 8. Error handling

Three layers:

- **SDK boundary** (`ado/sdkClient.ts`): every SDK call wrapped; mapped to `AdoError` subtype based on HTTP status / error code:
  - 401/403 → `AdoAuthError` (suggest "PAT may be expired, revoked, or missing required scopes — for v1 PR read access, the PAT needs Code (read) and Identity (read)")
  - 404 → `AdoNotFoundError`
  - `ECONNREFUSED` / `ETIMEDOUT` / `ENOTFOUND` → `AdoNetworkError`
  - `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN` → `AdoTlsError` (suggest CA bundle config)
  - everything else → `AdoUnknownError` (with original message)
- **Service layer** (`domains/*/service.ts`): zod validation errors → `ValidationError`; missing repo context → `RepoContextError`. Does not catch `AdoError`.
- **MCP boundary** (`mcp/errorBoundary.ts`): catches everything from tool invocations, returns MCP tool-result with `isError: true` and the error's user-facing message. Internal stack stays in stderr logs.

**Logging:** stderr only (stdout reserved for MCP protocol). Default level INFO; `LOG_LEVEL=debug` enables wire-level SDK logs with PAT redacted.

## 9. Testing strategy

- **Unit (Vitest)**: each domain service tested with `FakeAdoClient`. Pure functions (`diffShaper`, `parseRemoteUrl`) tested directly. Targets: business logic, validation, repo resolution, error mapping. Fast; no network.
- **Contract (Vitest, opt-in)**: `sdkClient` tested against recorded HTTP fixtures. Verifies our wrapper handles real ADO response shapes. CI-safe (no secrets needed).
- **Live smoke (manual)**: `npm run smoke` runs `whoami` and `list_pull_requests` against a real ADO using env-var creds. Not in CI by default; documented in README.
- **Not tested directly:** the MCP SDK registration layer. We test by calling services directly; registration is thin enough that integration with the MCP SDK is manually verified by running the server in Claude Code.

## 10. Phased delivery

The user is new to building MCP servers. To avoid finalizing details that are hard to evaluate in the abstract, implementation is split into incremental phases — each with an explicit checkpoint where the user exercises the result before the next phase begins. Phases 0 and 1 shipped per this design; Phase 2 (PR review writes) is brainstormed in §12.

### Phase 0 — Walking skeleton

Smallest end-to-end slice that exercises every layer of the architecture.

**Includes:**
- Full setup wizard (URL + PAT + optional CA bundle, with connection test)
- Full config + keyring + TLS infrastructure
- `ado/client.ts` interface with `whoami` only; `sdkClient` impl
- `domains/identity/` with the `whoami` tool
- `mcp/registerTools` + `errorBoundary`
- Unit tests for the identity service (with `FakeAdoClient`) and the error mapper
- npm scripts: `dev`, `build`, `setup`, `start`, `test`
- README with Claude Code setup snippet

**Explicitly NOT in Phase 0:** `git/detectRepo`, `parseRemoteUrl`, `diffShaper`, contract tests. `whoami` doesn't need any of them; deferring keeps the skeleton minimal and the checkpoint focused on plumbing/UX.

**End state:** user wires the server into local Claude Code, runs the `whoami` tool from a Claude session, sees their identity returned. Can poke at error paths (wrong PAT, wrong URL, untrusted cert) to validate UX.

### Checkpoint

User exercises Phase 0 hands-on. Anything that feels wrong about the shape — tool naming, error messages, setup UX, response shapes, configuration ergonomics, logging — is captured and folded back into this spec **before** Phase 1 begins.

### Phase 1 — Read-only PR MVP

Built on the now-validated foundation.

**Includes:**
- Extend `AdoClient` interface with project/repo/PR/iteration methods; extend `sdkClient`
- `domains/projects/`, `domains/repositories/`, `domains/pullRequests/` (with `diffShaper`)
- `git/detectRepo` + `parseRemoteUrl` integration in PR service for cwd-based resolution
- Unit tests for all new services and `diffShaper`
- Contract tests for the new `sdkClient` methods
- README updated with the full tool catalog and usage examples

**End state:** full read-only PR review workflow available in Claude Code. v1 ready for npm publish.

### Phase 2 — PR review write surface

Detailed in §12. Adds 8 write tools (comment, reply, resolve threads, vote, edit description/title, toggle draft, add/remove reviewers). Excludes PR lifecycle (create / complete / abandon) which is deferred to a future Phase 2.x. Read-only mode env var becomes load-bearing here.

### Phase 0 checkpoint outcomes (2026-04-22)

Phase 0 ran end-to-end against a real ADO Services instance and Claude Code. The walking skeleton worked on first try after two install gotchas were resolved (npm setup script bypassed `index.ts`; MCP servers must live in `~/.claude.json` rather than `~/.claude/settings.json`). Both fixes are committed in the Phase 0 branch.

Decisions captured back into this spec from the checkpoint:

- **Tool naming** — confirmed unprefixed (see decision row in §4). `list_projects` and `list_repositories` were briefly considered for `ado_*` prefixes to avoid collisions with Linear MCP / others, but the modern convention is to rely on host namespacing.
- **Read-only mode** — added as a configurable contract via `AZURE_DEVOPS_READ_ONLY` env var (see decision row in §4). Phase 1 introduces the env-var plumbing as a no-op so the contract exists before write tools do.
- **Response shape** — JSON for v1 confirmed; the user found the LLM's natural-language summarization of the JSON acceptable. Markdown formatting deferred indefinitely unless asked.
- **`npm run setup` script** — must be `tsx src/index.ts setup`, not `tsx src/setup.ts`. The Phase 0 plan and `package.json` are corrected.
- **Local-dev MCP wiring** — README should explicitly call out that for local dev users point Claude Code at the absolute path of `dist/index.js`, not at the un-published `npx -y @scope/...` snippet the wizard prints. (Wizard snippet is the post-publish path.)

## 11. Open questions

These are deferred to implementation or to the post-Phase-0 checkpoint, not blockers for the design:

- Final npm scope name (e.g., `@vasekzdvihal/`, `@az-mcp/`, unscoped). Must be settled before first publish.
- Exact defaults for `diffShaper` (`maxLinesPerFile`, `maxFiles`) — pick reasonable starting values, tune after Phase 1 use.
- Whether to add an eslint boundary plugin to enforce `domains/*` independence — defer until the import-graph genuinely benefits.

## 12. Phase 2 — PR review write surface

Status: brainstormed and locked 2026-04-23. Implementation pending.

**Goal:** add the write tools needed for the LLM to act AS a reviewer or to respond AS the PR author — comment, reply, resolve threads, vote, edit description/title, toggle draft, manage reviewers. Excludes PR lifecycle (create / complete / abandon) which are deferred to a future Phase 2.x.

### 12.1 Tool list (8 new tools)

| Tool | Purpose |
| --- | --- |
| `add_pull_request_comment` | Start a new comment thread on a PR. Optional `filePath` + `line` for line-anchored review notes; without those, it's a general PR-level comment. Body is markdown. |
| `reply_to_pull_request_thread` | Append a comment to an existing thread (by `threadId`). |
| `update_pull_request_thread_status` | Set thread status: `active` / `fixed` / `wontFix` / `closed` / `byDesign` / `pending`. The "solve" verb. |
| `vote_on_pull_request` | Cast or update your vote: `approve` / `approveWithSuggestions` / `wait` / `reject` / `reset` (clears your vote). |
| `update_pull_request` | Edit title and/or description (markdown). Same SDK call backs `set_pull_request_draft_state`. |
| `set_pull_request_draft_state` | Toggle draft on/off. Reuses the `update_pull_request` SDK method (one less ADO call to learn). |
| `add_pull_request_reviewers` | Add one or more reviewer identities by id. |
| `remove_pull_request_reviewers` | Remove one or more reviewer identities by id. |

### 12.2 Locked design decisions

- **Confirmation pattern: none.** No `confirm: true` parameter on any write tool. The LLM is expected to ask the user before calling write tools (standard MCP convention). All Phase 2 actions are reversible (comments deletable, votes changeable via `reset`, threads reactivatable, edits replaceable, drafts toggleable, reviewers re-addable), so the blast radius is low.
- **Read-only gate is now load-bearing.** `registerAllTools(server, client, { readOnly })` builds two tool arrays. When `readOnly: true`, the `writeTools` array is empty — write tools are not registered and don't appear in the LLM's tool list at all. PAT scope remains the *enforcement* layer; the env var is the *ergonomic* layer for users with broad-scope PATs who want Claude restricted.
- **PAT scope handling: friendly error at first write attempt.** No startup probe. The first write call with insufficient PAT returns 403 from ADO; `mapSdkError` wraps it as `AdoAuthError` with an extended message that names the additional scopes needed (Code write, Pull Request write). User regenerates PAT, re-runs setup, done.
- **Error mapping: add `AdoConflictError` for 409.** Triggers when the PR is already abandoned/completed, the thread is already closed, or a concurrent edit conflicts. Friendly message tells the user which.
- **Repo resolution: extracted to a pure helper.** Currently a private method on the read service. Both read and write services need it; pulling out to `src/domains/pullRequests/repoResolution.ts` lets both consume the same function with no inheritance.

### 12.3 Architecture additions

```
src/
  ado/
    client.ts                # +7 write method signatures
    sdkClient.ts             # +7 write method impls
    errors.ts                # +AdoConflictError + 409 mapping
    types.ts                 # +Comment, CommentThreadStatus, IdentityRefWithVote re-exports

  domains/pullRequests/
    readService.ts           # MOVED from service.ts (read methods only)
    writeService.ts          # NEW — 8 write methods using shared repo resolution
    repoResolution.ts        # NEW — extracted from current service.ts
    readTools.ts             # MOVED from tools.ts
    writeTools.ts            # NEW — 8 MCP tool definitions
    schemas.ts               # extend with write-tool input schemas
    diffShaper.ts            # unchanged

  mcp/
    registerTools.ts         # NOW USES the readOnly flag (was no-op in P1)
```

### 12.4 Setup wizard adjustment

The setup wizard prints a one-line message before prompting for the PAT:

> For Phase 2 (write tools), your PAT needs Code (read & write), Pull Request (read & write), and Identity (read).

Existing read-only users upgrading from Phase 1 either regenerate their PAT with write scopes, or set `AZURE_DEVOPS_READ_ONLY=true` to keep the Phase 1 behavior.

### 12.5 README updates

- Tool catalog grows from 8 (Phase 1) to 16 tools.
- "Read-only mode" subsection gets a real story — the env var actually does something now.
- New "Required PAT scopes" table:

| Mode | Required PAT scopes |
| --- | --- |
| Read-only (`AZURE_DEVOPS_READ_ONLY=true` OR a read-only PAT) | Code (read), Identity (read) |
| Full (default) | Code (read & write), Pull Request (read & write), Identity (read) |

- "Security" subsection clarifies: PAT scope is the actual enforcement; the env var is an ergonomic belt-and-suspenders for users with broad-scope PATs.

### 12.6 Testing strategy

- TDD on `pullRequests/writeService.ts` — ~15 unit tests against an extended `FakeAdoClient`.
- TDD on `pullRequests/repoResolution.ts` — pull existing repo-resolution tests across from the read service test file.
- Extend `ado/errors.test.ts` with `AdoConflictError` (409) coverage.
- No new contract tests in this phase (still deferred to Phase 1.5; the friendly-error UX for PAT-scope-missing is exercised manually at the end of Phase 2).

Target test count after Phase 2: ~85 (66 from P1 + ~15 write-service + ~3 error mapper + ~2 repo resolution extraction).

### 12.7 Deferred to a future Phase 2.x — PR lifecycle

These tools are deliberately *not* in Phase 2:

- `create_pull_request` — opens a new PR (source/target branch, title, description, optional reviewers).
- `complete_pull_request` — merges the PR (with chosen merge strategy: squash / rebase / merge / merge-commit).
- `abandon_pull_request` — closes the PR without merging.
- `set_auto_complete` — flags the PR to auto-merge once policies pass.
- `delete_pull_request_comment` / `update_pull_request_comment` — niche; comment authors can use ADO web UI for now.

Why deferred: lifecycle actions have higher blast radius than reviewer actions (a wrong `complete_pull_request` merges the wrong PR — only the rare "revert" flow gets you out). Worth their own brainstorming pass for confirmation patterns and any guardrails. Phase 2 ships the smaller, lower-risk surface first; lifecycle follows when there's pull for it.
