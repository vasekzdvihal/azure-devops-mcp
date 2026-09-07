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
- **No contract tests.** Unit tests with `FakeAdoClient` are the primary safety net (66 tests).

**Plan:** `docs/superpowers/plans/2026-04-22-azure-devops-mcp-phase-1.md`.

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

## ✅ Phase 2.2 — PR comments, votes & edits

**Status:** shipped (commit `091ef83`, released alongside v0.4.0 / v0.5.0).

**Goal:** let the LLM participate in PR review — post comments, reply in threads, resolve threads, vote, edit PR metadata, manage reviewers.

**Tools shipped:**

| Tool | Effect |
| --- | --- |
| `add_pull_request_comment` | add a new comment thread (optionally line-anchored to a file/line) |
| `reply_to_pull_request_thread` | append a reply to an existing thread |
| `update_pull_request_thread_status` | resolve / mark wontFix / reactivate a thread |
| `vote_on_pull_request` | approve / approveWithSuggestions / wait / reject / reset |
| `update_pull_request` | edit title and/or description |
| `set_pull_request_draft_state` | mark draft / publish |
| `add_pull_request_reviewers` | add one or more reviewers |
| `remove_pull_request_reviewer` | remove a reviewer |

**Cross-cutting:** all tools registered behind the existing `AZURE_DEVOPS_READ_ONLY` gate; `vote_on_pull_request` includes the "always confirm before calling" line in its description; 409s on already-resolved threads or already-completed PRs surface as the existing `AdoConflictError`. PAT scopes already requested as part of Phase 2.1 setup, so no new scope ask.

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

## ✅ Phase 3.1 — Definition detail

**Status:** shipped 2026-05-07 as v0.5.0.

**Goal:** read the *definitions* behind pipelines and releases, not just the runs — so the LLM can answer "what variables does this pipeline expose?" or "which approvers gate this release stage?".

**Tools shipped:**

| Tool | Notes |
| --- | --- |
| `get_pipeline_definition` | full build/pipeline definition: variables, triggers, repository, process |
| `get_release_definition` | full release definition: environments, variables, approvals; `verbose` flag opts into full deploy task list |

**Key decisions made / locked here:**
- **Secrets never leave the server.** When `isSecret: true`, the variable's `value` field is dropped entirely from the response — not masked, not echoed. The LLM sees the variable name and the secret flag, nothing else.
- **Approvals collapsed.** Each environment's pre/post-deploy approvals are flattened to `{ isAutomated, approvers[] }` rather than the SDK's nested approval objects — small enough for the LLM to reason about, sufficient for "who can approve this?".
- **Verbose opt-in for deploy tasks.** Release-definition responses default to environment names + approvals + variables only; the full task graph is heavy and noisy. `verbose: true` returns the deploy phases + tasks for callers that need them.

**Plan:** extension to Phase 3; no separate plan doc.

---

## ✅ Phase 4.1 — Pipeline & release run actions

**Status:** shipped 2026-05-18.

**Goal:** let the LLM act on pipeline and release runs — start a build, cancel one, tag it, create / deploy / approve / cancel a release.

**Tools shipped:**

| Tool | Notes |
| --- | --- |
| `queue_pipeline_run` | starts a new build via `PipelinesApi.runPipeline` (template params + variables) |
| `cancel_pipeline_run` | sets build status to cancelling; 409 on already-completed |
| `update_build_tags` | add and/or remove tags on a build |
| `create_release` | creates a release; artifacts shape `{ alias, instanceReference: { id, name } }` resolved via `getBuild` |
| `deploy_release_stage` | resolves env name → id, sets stage status to inProgress |
| `approve_release_gate` | approve / reject by approvalId |
| `cancel_release` | abandons a release |
| `list_pending_approvals` (read) | companion query for `approve_release_gate` |

**Key decisions made / locked here:**
- **All native SDK.** Every tool maps to a typed method on `azure-devops-node-api` (`BuildApi`, `PipelinesApi`, `ReleaseApi`) — no raw HTTP introduced.
- **`retry_pipeline_stage` deferred** to Phase 4.2 alongside the definition-edit surface; YAML re-run via `queue_pipeline_run` is the workaround until then. (Note: Phase 4.2 found `BuildApi.updateStage` does wrap the endpoint — the assumption that this needed raw HTTP was wrong.)
- **`AdoScopeError`** maps 401/403 with scope hints (body text) to a specific message naming the missing PAT scope. Generic 401/403 still surfaces as `AdoAuthError`. Heuristic anchored on unambiguous patterns (`vso.build_execute`, `vso.release_execute`, `"requires the 'build'…"`) to avoid false positives on identifier names.
- **Setup wizard scope list updated;** no live probing — runtime errors catch drift.
- **Confirmation pattern:** `deploy_release_stage` and `approve_release_gate` include "always confirm before calling" in their tool description, matching the Phase 2.x precedent (`vote_on_pull_request`, `complete_pull_request`).
- **No idempotency wrappers.** Cancelling an already-completed run / abandoned release / etc. propagates as `AdoConflictError` — the caller decides whether to ignore.
- **SDK enum values verified at implementation time.** The plan's draft values for `ApprovalStatus` (Reassigned/Canceled/Skipped) were wrong; correct SDK values used in both the service reverse-mapping tables and the SdkAdoClient forward mapping.

**Plan:** `docs/superpowers/plans/2026-05-18-azure-devops-mcp-phase-4-1.md`. Spec: `docs/superpowers/specs/2026-05-18-azure-devops-mcp-phase-4-1-design.md`.

**Deferred to Phase 4.2:** `retry_pipeline_stage` and all definition-edit tools (`update_pipeline_variables`, `update_pipeline_triggers`, `update_release_variables`, `update_release_environment_variables`). (Phase 4.2 later verified the stage-retry endpoint is wrapped by `BuildApi.updateStage`, so no raw-HTTP infra was needed.)

---

## ✅ Phase 4.2 — Pipeline & release definition edits + retry_pipeline_stage

**Status:** shipped 2026-05-19 in v0.7.0.

**Goal:** five write tools deferred from Phase 4.1 — retry a single failed pipeline stage and edit the persistent variable / trigger surface of pipeline + release definitions.

**Tools shipped:**

| Tool | Notes |
| --- | --- |
| `retry_pipeline_stage` | `BuildApi.updateStage` with `forceRetryAllJobs: true` by default |
| `update_pipeline_variables` | GET → mutate → PUT; secrets preserved by starting from existing map |
| `update_pipeline_triggers` | full-array replacement; LLM fetches via `get_pipeline_definition` first |
| `update_release_variables` | mirrors pipeline variables, against the release definition |
| `update_release_environment_variables` | per-environment variable overrides; case-insensitive env match |

**Key decisions / notes:**

- **Deviation from the ticket.** The ZDV-240 brief assumed `retry_pipeline_stage` would be the first tool needing raw HTTP. Verification against the installed `azure-devops-node-api` showed `BuildApi.updateStage` wraps the endpoint with the right `forceRetryAllJobs` parameter, so no raw-HTTP plumbing was added in this phase. Deferred to whichever future tool first hits a genuinely unwrapped endpoint.
- **Secret preservation.** The biggest correctness risk in this phase. Service layer always starts from the GET response's `variables` map and mutates on top — so secrets that come back from GET with `value: null` are re-sent intact. There's an explicit non-negotiable unit test for the "update one plain var, don't lose an unrelated secret" failure mode.
- **Optimistic concurrency.** The `revision` field is round-tripped from GET into the PUT. ADO returns 409 on stale-write → mapped to `AdoConflictError` with the existing "re-fetch and try again" message.
- **No new PAT scopes.** Build (read & execute) and Release (read, write, & execute) — already required by Phase 4.1 — cover the new endpoints.

**Spec:** `docs/superpowers/specs/2026-05-19-azure-devops-mcp-phase-4-2-design.md`.
**Plan:** `docs/superpowers/plans/2026-05-19-azure-devops-mcp-phase-4-2.md`.

---

## ✅ Phase 5 — Work items

**Status:** shipped 2026-05-21 in v0.8.0.

**Goal:** a focused work-item surface — query common item sets, read full item detail, link items to PRs, update state with pre-validation, and post comments.

**Tools shipped:**

| Tool | Notes |
| --- | --- |
| `list_work_items` | convenience filters: `myActive`, `linkedToPr`, `currentIteration`, `tag` |
| `get_work_item` | full field detail for a single work item |
| `link_work_item_to_pr` | creates an ADO artifact link between the item and a pull request |
| `update_work_item_state` | patches `System.State`; pre-validates the value against allowed states for the item's type + project before writing |
| `add_work_item_comment` | appends a comment to the work item's discussion |

**Key decisions / notes:**

- **`linkedToPr` uses the Git API, not WIQL.** The filter calls `GitApi.getPullRequestWorkItemRefs` and then batch-fetches the returned IDs — simpler, no WIQL string construction, and the PR is the natural anchor. WIQL passthrough was intentionally not exposed.
- **State pre-validation.** `update_work_item_state` fetches allowed transitions before writing; an invalid state returns a descriptive error rather than a 400 from ADO.
- **New PAT scope: Work Items.** Reads need Work Items (read); the three write tools need Work Items (write). Added to the setup wizard, the README scopes table, and the `AdoAuthError` guidance.

**Explicit out of scope for this phase:**
- Raw WIQL passthrough
- Attachment upload / download
- Custom-field writes beyond the standard system fields
- Parent / child relation mutation
- Work-item creation or deletion

**Spec:** `docs/superpowers/specs/2026-05-21-azure-devops-mcp-phase-5-work-items-design.md`.

---

## ✅ Phase 5.1 — Comment deletion

**Status:** shipped 2026-09-03 in v0.11.0.

**Goal:** let the LLM retract its own (or, with sufficient permissions, anyone's) comments on pull requests and work items — the one write in the comment lifecycle that was missing.

**Tools shipped:**

| Tool | Notes |
| --- | --- |
| `delete_pull_request_comment` | `GitApi.deleteComment` by thread + comment id; deleting the first comment removes the whole thread |
| `delete_work_item_comment` | `WorkItemTrackingApi.deleteComment` by comment id |

**Key decisions / notes:**

- **Both carry the "always confirm before calling" line** — deletion is irreversible, matching the `vote_on_pull_request` / `deploy_release_stage` precedent.
- **Tool result is `{ ..., deleted: true }`** rather than `void`, so the model gets an explicit acknowledgement it can echo back.
- **No new PAT scopes.** Code (write) and Work Items (write) already cover the delete endpoints.
- **Docs catch-up.** The README tool tables were missing every Phase 4.2 and Phase 5 tool; this phase added them.

---

## ✅ Phase 6 — Pipeline & release definition creation

**Status:** shipped 2026-09-04 in v0.12.0.

**Goal:** bring definitions into existence, not just runs — create a YAML pipeline, clone a release definition, and delete either.

**Tools shipped:**

| Tool | Notes |
| --- | --- |
| `create_pipeline` | `PipelinesApi.createPipeline`; repo name → id via `listRepositories`; YAML + `azureReposGit` only |
| `delete_pipeline` | `BuildApi.deleteDefinition` (soft delete) |
| `create_release_definition` | GET source → `stripForClone` → overrides → `ReleaseApi.createReleaseDefinition` |
| `delete_release_definition` | `ReleaseApi.deleteReleaseDefinition` with `comment` / `forceDelete` |

**Key decisions / notes:**

- **Clone, don't compose.** A from-scratch release definition schema is the failure mode that saves but does not deploy; cloning a proven definition keeps deploy phases, queue ids, and tasks intact. Compose-from-spec deferred.
- **Strip rules are a pure module** (`cloneDefinition.ts`) with one test per rule, cross-checked against the REST 7.1 create sample (all ids 0, server fields absent, `environmentTriggers` emptied because they reference source env ids, `schedules[].jobId` dropped because it is the server-assigned scheduler job id).
- **SDK type gap.** `CreatePipelineConfigurationParameters` lacks `path`/`repository`; a local `CreateYamlPipelineParameters` widens it.
- **New PAT scope: Release manage**, needed only by `delete_release_definition`. Updated in setup wizard, auth hint, README.

**Spec:** `docs/superpowers/specs/2026-09-04-azure-devops-mcp-phase-6-definition-creation-design.md`.
**Plan:** `docs/superpowers/plans/2026-09-04-azure-devops-mcp-phase-6-definition-creation.md`.

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
