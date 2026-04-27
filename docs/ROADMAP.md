# Azure DevOps MCP — Roadmap

The plan, phase by phase. What's shipped, what's next, and what we deliberately deferred.

The shape of the project is set in `docs/superpowers/specs/2026-04-21-azure-devops-mcp-design.md` (the design spec). Per-phase implementation plans live in `docs/superpowers/plans/`.

Conventions used here:
- ✅ **Done** — shipped in `main`.
- 🟡 **Planned** — scoped, not yet started.
- 💡 **Idea** — not committed, may change scope or be dropped.

---

## ✅ Phase 0 — Walking skeleton

**Status:** shipped 2026-04-21.

**Goal:** smallest end-to-end slice that proves every layer works (config + OS keyring + TLS + MCP transport + ADO API), with one tool: `whoami`.

**Why this first:** the spec design (modules, AdoClient seam, error taxonomy, setup wizard, read-only mode) was a lot to commit to without ever running an MCP server. Phase 0 was a deliberate checkpoint — build the smallest version, validate the shape against real Claude Code, then expand with confidence.

**Key decisions made / locked here:**
- TypeScript on Node ≥20, ESM, NodeNext modules.
- `azure-devops-node-api` (Microsoft, MIT) as the SDK behind a thin `AdoClient` interface.
- PAT stored in OS keyring via `@napi-rs/keyring`; config in `~/.config/azure-devops-mcp/config.json` (mode `0600`).
- TLS strict by default; opt-in CA bundle path in config for on-prem internal CAs.
- Domain-first folder layout under `src/domains/`.
- Tool naming: short, unprefixed, descriptions over names.
- Read-only mode design via `AZURE_DEVOPS_READ_ONLY` env var (no-op until Phase 2).

**Plan:** `docs/superpowers/plans/2026-04-21-azure-devops-mcp-phase-0.md`.

---

## ✅ Phase 1 — Read-only PR review

**Status:** shipped 2026-04-22.

**Goal:** the user-facing MVP. Eight tools that let an LLM enumerate projects/repos and read everything about a pull request — list, fetch metadata, list changed files, get per-file diffs, read comment threads, list iterations.

**Why this scope:** matches the most common Claude Code use case ("review this PR with me"). Read-only avoids any risk of the LLM making accidental changes against ADO. Cwd auto-detection means tools "just work" inside an ADO checkout.

**Tools shipped:**

| Tool | Notes |
| --- | --- |
| `whoami` | from Phase 0 |
| `list_projects` | enumeration |
| `list_repositories` | enumeration |
| `list_pull_requests` | filters: status, author, reviewer, target branch |
| `get_pull_request` | full metadata, reviewers, draft/merge status (enum→string) |
| `list_pull_request_changes` | metadata only — cheap, complete |
| `get_pull_request_diff` | per-file unified diff (truncatable, binary-safe) |
| `list_pull_request_comments` | threads with line anchors + status |
| `get_pull_request_iterations` | iteration history |

**Key decisions made / locked here:**
- **Diff design — two-tool split.** `list_pull_request_changes` returns metadata (cheap, always); `get_pull_request_diff` returns unified diff for ONE file at a time. LLM controls token spend, mirrors GitHub MCP. Diff synthesized client-side from base + target file content via the `diff` library.
- **Cwd auto-detect.** `git/parseRemoteUrl` + `git/detectRepo` resolve `{project, repository}` from the cwd's `.git/config remote.origin.url`. Handles ADO Server + Services, HTTPS + SSH; deny-list against false positives on github/gitlab. Explicit args win when both provided.
- **Read-only mode plumbing wired through.** `index.ts` reads `AZURE_DEVOPS_READ_ONLY`; `registerAllTools(server, client, { readOnly })` accepts it. No-op in Phase 1 (all reads), gates write tools in Phase 2.
- **No contract tests yet.** Defer to a Phase 1.5; unit tests with `FakeAdoClient` cover all domain logic (66 tests).

**Plan:** `docs/superpowers/plans/2026-04-22-azure-devops-mcp-phase-1.md`.

---

## 🟡 Phase 1.5 — Contract tests

**Status:** planned. ~half a day of work; nothing in the user-facing surface changes.

**Goal:** record real HTTP responses from a live ADO once, replay them in CI to verify the SDK wrapper still behaves correctly when we upgrade `azure-devops-node-api` (or refactor `SdkAdoClient`).

**Why we don't have it yet:** Phase 1 unit tests use `FakeAdoClient` for fast, deterministic coverage of business logic. That's the right primary safety net. Contract tests are a *secondary* layer that catches "the SDK started returning a different shape" — important before publish, less important during early development.

**Sketch:**
- `vitest` + `@pollyjs/core` (or hand-rolled HTTP recorder) intercepts `https` calls.
- One recording per `SdkAdoClient` method against a real ADO (your local instance).
- Recordings live in `test/contract/fixtures/` — committed, no secrets (PAT replaced with `${PAT}` placeholder on save).
- CI replays the recordings — no live ADO needed in CI.

**Trigger to actually do this:** before the first npm publish, OR when we upgrade `azure-devops-node-api` to a new major version, OR when a real PR-shape change in ADO breaks us in production.

---

## 🟡 Phase 1.6 — npm publish readiness

**Status:** planned. Small task, ~an hour.

**Goal:** make the package publishable to the public npm registry with a single `npm publish` command, so colleagues can install via `npx -y @vasekzdvihal/azure-devops-mcp` instead of cloning + building.

**Why deferred:** during active development, building locally and pointing Claude Code at `dist/index.js` is faster than publishing-then-installing. But to get colleagues onboarded with one command, we need the publish-readiness items below.

**Items:**
- Add `prepublishOnly: "npm run build"` script (ensures `dist/` is fresh on every publish — single biggest npm footgun).
- Add `keywords`, `repository`, `bugs`, `homepage`, `author` fields to `package.json` (npm will warn without these; `keywords` is what makes the package discoverable on the registry).
- Decide on the npm scope (`@vasekzdvihal/`, unscoped `azure-devops-mcp`, or a different scope you control).
- Bump version to `0.1.0` on first publish; semver from there.
- Optional: GitHub Actions release workflow that publishes on tag push.

**Trigger to do this:** when at least one external user wants the install-via-npx path, OR before the first GitHub release.

---

## 🟡 Phase 2 — Write operations

**Status:** planned. Larger phase — comparable to Phase 1.

**Goal:** let the LLM act on PRs, not just read them. Create new PRs, comment, vote, complete/abandon.

**Why this matters:** "review the PR" is one workflow; "address feedback and post my reply" is the natural follow-up. Without writes, the LLM is read-only — useful for analysis but not for action.

**Why this is its own phase, not bundled with Phase 1:** writes fundamentally change the risk surface. Phase 1's tool calls are safe (idempotent reads). Phase 2 tools can change ADO state — wrong tool call, wrong PR id, wrong comment text → real consequences. Want a separate brainstorming pass for confirmation patterns, the read-only mode gate, and PAT scope changes.

**Tools likely in scope:**

| Tool | Effect |
| --- | --- |
| `create_pull_request` | new PR (source branch, target branch, title, description, optional reviewers) |
| `update_pull_request` | edit title/description, change target, add/remove reviewers |
| `add_pull_request_comment` | add comment to a thread or start a new line-anchored thread |
| `reply_to_comment_thread` | append a reply within an existing thread |
| `update_comment_thread_status` | resolve / mark wontFix / reactivate a thread |
| `vote_on_pull_request` | approve / approve-with-suggestions / wait / reject |
| `complete_pull_request` | merge (with chosen merge strategy: squash/rebase/merge) |
| `abandon_pull_request` | close without merging |
| `set_pull_request_draft_state` | mark draft / publish |

**Key design questions to resolve in Phase 2 brainstorming:**
- **Confirmation pattern.** Should write tools require an explicit `confirm: true` param as a belt-and-suspenders? (Most MCP servers don't — they trust the LLM to ask the user first. But high-blast-radius tools like `complete_pull_request` are different.)
- **Read-only mode behavior.** With `AZURE_DEVOPS_READ_ONLY=true`, write tools simply aren't registered (already plumbed through Phase 1's `registerAllTools`). Confirm that pattern over alternatives like "registered but always 403".
- **PAT scopes.** New scopes needed: **Code (read & write)** for PR mutations, **Pull Request (read & write)** for comments/votes. Setup wizard should re-test scope at upgrade time and surface a specific error rather than the generic auth failure.
- **Naming convention for confirmation prompts in tool descriptions.** Each write tool's description should explicitly tell the LLM "always confirm with the user before calling this".
- **Error mapping.** Add `AdoConflictError` (409 → PR already merged/abandoned, comment thread closed, etc.) with a clear message.

---

## ✅ Phase 2.1 — PR lifecycle (create / complete / abandon / auto-complete)

**Status:** shipped 2026-04-26.

**Goal:** the lifecycle tools deferred from Phase 2 — open a PR, merge it, abandon it, set auto-complete.

**Tools shipped:**

| Tool | Notes |
| --- | --- |
| `create_pull_request` | new PR; short or full ref names; optional draft + initial reviewers |
| `complete_pull_request` | merge with strategy (`noFastForward` / `squash` / `rebase` / `rebaseMerge`); optional source-branch deletion + commit message + policy bypass |
| `abandon_pull_request` | close without merging (reversible) |
| `set_pull_request_auto_complete` | enable auto-complete; uses configured PAT identity as owner (mirrors ADO web UI) |

**Key decisions made / locked here:**
- **Branch name normalization.** Schemas accept short names (`feature/x`); the service prepends `refs/heads/` if absent. Less friction than forcing the full ref.
- **`completePullRequest` self-fetches `lastMergeSourceCommit`** if the caller didn't supply one — saves the LLM a `get_pull_request` round-trip and avoids the failure mode where it forgets the field is required.
- **Auto-complete owner = whoami identity.** No need to expose an extra arg; the configured PAT is whoever the LLM is acting as.
- **All four tools register under the existing write-tool gate** — `AZURE_DEVOPS_READ_ONLY=true` suppresses them, same as Phase 2.

Released as v0.4.0.

---

## ✅ Phase 3 — Releases, pipelines & commits

**Status:** shipped 2026-04-24.

**Goal:** read-only tools across releases, pipelines, and commit history — enough to answer "who last published X to production and what was published?" in one LLM chain.

**Tools shipped:**

| Tool | Notes |
| --- | --- |
| `list_release_definitions` | classic Release pipelines |
| `list_releases` | release runs; filter by definition + status |
| `get_release` | stages + artifacts (source build + branch) |
| `list_deployments` | flattened per-stage deployments — answers the canonical question |
| `list_pipelines` | build/pipeline definitions; `type` flag distinguishes classic vs yaml |
| `list_pipeline_runs` | runs with branch/status/result filters |
| `get_pipeline_run` | includes stages timeline (covers YAML multi-stage) |
| `list_branches` | branches with last-commit + ahead/behind; cwd auto-detect |
| `list_commits` | commits with fromDate/toDate/author filters; cwd auto-detect |

**Key decisions made / locked here:**
- **Both deployment models supported.** Classic Release pipelines via `ReleaseApi`; YAML multi-stage deployments surface as stages on pipeline runs via `BuildApi.getBuildTimeline`.
- **Composable primitives, not aggregators.** The LLM chains `list_deployments` → `get_release` → `get_pipeline_run` rather than calling a mega-tool.
- **Cwd auto-detect for commits only.** Releases and pipelines are project-scoped, not repo-scoped, so cwd resolution doesn't apply cleanly there.
- **Release-collection 404 hint.** 404 on the first release endpoint is translated to "Release API unavailable — this collection may not have classic releases enabled."
- **New PAT scopes required:** **Build (read)** and **Release (read)**. Documented in the README scopes table.

**Plan:** `docs/superpowers/plans/2026-04-24-azure-devops-mcp-phase-3.md`. Spec: `docs/superpowers/specs/2026-04-24-azure-devops-mcp-releases-pipelines-commits-design.md`.

**Deferred to a future phase:** any write operations (queue build, re-run stage, approve release gate, cancel run, tag build).

---

## 💡 Phase 5 — Work items

**Status:** idea, lower priority.

**Goal:** find work items, get details, link them to PRs, optionally update state/comments.

**Notes:**
- Work item queries (WIQL) are powerful but verbose. The MCP would expose convenience methods for common queries ("my active items", "items linked to PR X").
- Field schemas vary by process template (Agile / Scrum / CMMI / custom). Would need to handle gracefully.
- Probably the most "wide" surface area of any phase — many possible tools. Worth a careful brainstorming pass to pick the small useful subset.

---

## Out of scope (and likely to stay that way)

- **Wiki, artifacts, test plans, dashboards, packaging, audit, security scanning, repo settings.** Each could be its own phase, but each is a niche compared to the PR/pipeline/release/work-item core. We'd add them only if a specific colleague asks for one.
- **Non-PAT auth (AAD, OAuth).** PATs work for both ADO Services and Server. AAD/OAuth would add real complexity (token refresh, redirect flows) for a small UX gain in the cloud-only case.
- **HTTP/SSE MCP transport.** Claude Code launches MCP servers as local subprocesses over stdio. HTTP/SSE matters for shared remote MCP servers, which isn't this project's use case.
- **Multiple ADO instances configured in one server install.** A single ADO connection per install. Users who need two instances configure two MCP server entries (each with its own keyring account, one per host).

## How decisions land in this roadmap

1. New idea → discussed conversationally → captured here as **💡 Idea**.
2. Idea graduates to **🟡 Planned** when we agree to scope it and write a brainstorm + spec section.
3. Planned phase becomes **✅ Done** when its plan is fully executed and the merge lands on `main`.

The design spec at `docs/superpowers/specs/` is the source of truth for cross-phase decisions (architecture, naming, security, etc.). This roadmap is the source of truth for *order* and *status*.
