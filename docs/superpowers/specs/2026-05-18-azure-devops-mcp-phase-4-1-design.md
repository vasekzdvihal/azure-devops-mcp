# Phase 4.1 — Pipeline & Release run actions (design)

**Date:** 2026-05-18
**Status:** approved, ready for implementation plan
**Tracks:** ZDV-173 (parent Phase 4 issue; this is the first of two sub-phases)

## Goal

Let the LLM act on pipeline and release runs — start, cancel, deploy, approve, tag — not just read them. This is the natural follow-up to Phase 3 (read-only coverage of pipelines and releases): the LLM can already answer "what happened" and "who deployed what"; this phase adds "do it" / "approve it" / "kill it".

## Scope

8 net-new tools — 7 writes + 1 companion read — all backed by methods that already exist on `azure-devops-node-api`'s `BuildApi`, `PipelinesApi`, and `ReleaseApi`. No raw HTTP infrastructure is introduced in this sub-phase.

### Pipeline run actions (3 write tools)

| Tool | SDK call | Confirmation? |
| --- | --- | --- |
| `queue_pipeline_run` | `PipelinesApi.runPipeline()` | No |
| `cancel_pipeline_run` | `BuildApi.updateBuild({ status: 4 /* cancelling */ })` | No |
| `update_build_tags` | `BuildApi.addBuildTags()` + `BuildApi.removeBuildTag()` (per tag) | No |

`PipelinesApi.runPipeline()` is preferred over `BuildApi.queueBuild()` because it accepts `templateParameters`, `variables`, and `resources` in a single typed shape that maps cleanly to YAML pipelines. Inputs: `project`, `pipelineId`, `branch?` (defaults to the pipeline's default branch), `templateParameters?`, `variables?`. Returns the new `Run` (run id + URL) so the LLM can chain `get_pipeline_run`.

`cancel_pipeline_run` issues `BuildApi.updateBuild` with `status: 4`. Cancelling an already-completed run returns 409 → mapped to `AdoConflictError` by the existing error layer; the tool propagates it.

`update_build_tags` takes `addTags?` and `removeTags?` arrays. The SDK only exposes per-tag add (`addBuildTag`) and per-tag remove (`removeBuildTag`); the service wraps both in a loop. Use the bulk `addBuildTags` for the add side when more than one tag is provided.

### Release run actions (4 write tools + 1 companion read)

| Tool | SDK call | Confirmation? |
| --- | --- | --- |
| `create_release` | `ReleaseApi.createRelease()` | No |
| `deploy_release_stage` | `ReleaseApi.updateReleaseEnvironment({ status: 2 /* inProgress */ })` | **Yes** |
| `approve_release_gate` | `ReleaseApi.updateReleaseApproval()` | **Yes** |
| `cancel_release` | `ReleaseApi.updateRelease({ status: 4 /* abandoned */ })` | No |
| `list_pending_approvals` (read) | `ReleaseApi.getApprovals({ statusFilter: pending })` | n/a |

`create_release` inputs: `project`, `definitionId`, `description?`, `artifacts?` (each artifact is `{ alias, buildId }`), `variables?`. The artifact shape passed to the SDK is `{ alias, instanceReference: { id, name } }` — the service constructs the `instanceReference` from the `buildId` (and resolves the build name with `BuildApi.getBuild` if not provided). Returns the new `Release` with its environment list so the LLM can chain `deploy_release_stage` or `list_deployments`.

`deploy_release_stage` inputs: `project`, `releaseId`, `environmentName`, `comment?`. The service resolves `environmentName` → `environmentId` from the release (`ReleaseApi.getRelease`), then calls `updateReleaseEnvironment` with `status: 2`. Confirmation prompt copy in the tool description: "Always confirm with the user before calling — this deploys to a live environment."

`approve_release_gate` inputs: `project`, `approvalId`, `status` (`"approved" | "rejected"`), `comment?`. Maps `status` strings to the SDK's `ApprovalStatus` enum (4 = approved, 8 = rejected). Confirmation prompt copy: "Always confirm with the user before calling — your name is recorded on the approval."

`cancel_release` inputs: `project`, `releaseId`, `comment?`. Issues `updateRelease` with `status: 4`. Already-abandoned → 409 → `AdoConflictError`.

`list_pending_approvals` is the companion read tool — without it the LLM has no ergonomic way to find an `approvalId` to approve. Inputs: `project`, `releaseId?` (filter to a specific release), `assignedTo?` (free-string identity descriptor, passed straight through to the SDK; the LLM can supply a display name or omit it for "all pending"). SDK: `getApprovals` with `statusFilter: pending`. Response shape: `{ approvalId, releaseId, releaseName, environmentName, approver, createdOn }[]`. Resolving "approvals assigned to the connected PAT identity" is **out of scope** for 4.1 — we don't currently surface the connected identity anywhere, and adding that plumbing is its own small piece of work.

### Out of scope for 4.1

| Deferred | Reason | Phase |
| --- | --- | --- |
| `retry_pipeline_stage` | No SDK method (Pipelines REST endpoint not wrapped by `azure-devops-node-api`); would require raw-fetch infrastructure | 4.2 (alongside definition-edit raw-fetch needs) |
| `update_pipeline_variables` | Definition edit | 4.2 |
| `update_pipeline_triggers` | Definition edit | 4.2 |
| `update_release_variables` | Definition edit | 4.2 |
| `update_release_environment_variables` | Definition edit | 4.2 |

YAML stage re-runs without raw-fetch are still possible via `queue_pipeline_run` (a fresh run of the whole pipeline) — slower than a stage retry, but available.

## Cross-cutting decisions

### Confirmation pattern

High-blast-radius tools (`deploy_release_stage`, `approve_release_gate`) get the line "Always confirms with the user before calling — <reason>" in their tool description. This matches the established Phase 2.x precedent (`vote_on_pull_request`, `complete_pull_request`). Cancellation tools (`cancel_pipeline_run`, `cancel_release`) skip the confirmation line — cancelling an in-flight run is reversible (re-queue) and lower-blast.

### Read-only mode

All writes register behind the existing `AZURE_DEVOPS_READ_ONLY` gate plumbed through `registerAllTools(server, client, { readOnly })`. `list_pending_approvals` is a read tool and registers unconditionally alongside other release reads.

### PAT scopes

New scopes required:

- **Build (read & execute)** — for `queue_pipeline_run`, `cancel_pipeline_run`, `update_build_tags`
- **Release (read, write, & execute)** — for `create_release`, `deploy_release_stage`, `approve_release_gate`, `cancel_release`, `list_pending_approvals`

Setup wizard updates: add both lines to the printed scope list in `src/setup.ts`. No probing — the wizard continues to perform only a single "who am I" connectivity check. Scope drift is caught at runtime via `AdoScopeError` (below).

### Error mapping

Add `AdoScopeError extends AdoError` in `src/ado/errors.ts`. The HTTP-error-mapping layer (already 401/403/404/409-aware) gains a 401/403 branch: when the response body or status text hints at insufficient scope, throw `AdoScopeError` with a message that names the specific scope based on the API path. Fall back to the existing `AdoAuthError` when the hint isn't present.

Example messages:
- "This call needs the 'Build (read & execute)' PAT scope. Update your PAT in ADO and rerun `npx -y @vasekzdvihal/azure-devops-mcp setup`."
- "This call needs the 'Release (read, write, & execute)' PAT scope. …"

409s (already-completed run, already-approved gate, already-abandoned release) continue to surface as `AdoConflictError`, unchanged.

### Idempotency

Writes are **not** wrapped with idempotency tokens or noop-on-already-done logic. The tool calls map 1:1 to ADO actions; conflicts propagate as `AdoConflictError` and the LLM (or user) decides whether to ignore. Rationale: implicit deduplication is too easy to get wrong, and the conflict signal is already clear from the error message.

## File structure

Mirrors the existing per-domain layout (e.g. `src/domains/pullRequests/` with separate `readService.ts` / `readTools.ts` / `writeService.ts` / `writeTools.ts`).

**New files:**

- `src/domains/pipelines/writeService.ts` — `PipelinesWriteService` class with `queueRun`, `cancelRun`, `updateTags`
- `src/domains/pipelines/writeTools.ts` — `buildPipelineWriteTools(svc)` returning the 3 tool defs
- `src/domains/releases/writeService.ts` — `ReleasesWriteService` class with `createRelease`, `deployStage`, `approveGate`, `cancelRelease`
- `src/domains/releases/writeTools.ts` — `buildReleaseWriteTools(svc)` returning the 4 tool defs
- `test/unit/domains/pipelines/writeService.test.ts` — domain-logic tests via `FakeAdoClient`
- `test/unit/domains/releases/writeService.test.ts` — same

**Modified files:**

- `src/ado/client.ts` — add 8 method signatures to the `AdoClient` interface (7 writes + 1 read)
- `src/ado/sdkClient.ts` — implement those 8 methods on `SdkAdoClient`
- `src/ado/errors.ts` — add `AdoScopeError` and extend the HTTP-error-mapping branch
- `src/domains/pipelines/schemas.ts` — Zod input schemas for the 3 new write tools
- `src/domains/releases/schemas.ts` — Zod input schemas for the 4 new write tools + `list_pending_approvals`
- `src/domains/releases/readService.ts` + `readTools.ts` — add `list_pending_approvals`
- `src/mcp/registerTools.ts` — extend `registerAllTools` to wire `buildPipelineWriteTools` and `buildReleaseWriteTools` behind the existing `options.readOnly` gate; register `list_pending_approvals` unconditionally with the other release reads
- `src/setup.ts` — append the two new scope lines to the printed scope list
- `test/fakes/FakeAdoClient.ts` — extend with the 8 new method stubs (used by the new domain tests)
- `docs/ROADMAP.md` — add the `✅ Phase 4.1` section; fold in the Phase 2.2 fix-up (mark it shipped — see the heads-up below)

## ROADMAP fix-up bundled with this work

During exploration, the actual repo state revealed that Phase 2.2 (PR comments, votes, edits) is already shipped (commit `091ef83`, 8 PR-write tools live). The ROADMAP currently still lists Phase 2.2 as planned. Two ROADMAP updates land in the Phase 4.1 PR:

1. Phase 2.2 → ✅ shipped (date the commit lands, version when it released).
2. Phase 4.1 → ✅ shipped block (added on the merge that closes this spec's implementation).

## Testing strategy

Unit tests via `FakeAdoClient` cover all domain logic per existing pattern. The two new `writeService.test.ts` files mirror the structure of `pullRequests/writeService.test.ts` — one describe block per service method, asserts on the args passed into the fake and the shape transformed back out. No contract tests in this phase (see the parking issue ZDV-233 for the broader testing strategy).

Specific test cases worth calling out explicitly in the implementation plan:

- `create_release`: artifact-shape transformation (`{ alias, buildId }` → `{ alias, instanceReference: { id, name } }`), including the case where the service looks up the build name when only `buildId` is provided.
- `deploy_release_stage`: `environmentName` → `environmentId` resolution, including the not-found case.
- `approve_release_gate`: `"approved"` / `"rejected"` → enum mapping.
- `update_build_tags`: both add-only, remove-only, and add+remove invocations.
- `cancel_pipeline_run` / `cancel_release`: 409 propagates as `AdoConflictError`.
- `AdoScopeError`: 403 with scope hint → specific message; 403 without hint → falls through to `AdoAuthError`.

## What we are not building

- Bulk operations across many runs / releases (LLM chains individual calls).
- Automatic retry, polling, or "wait until done" — the LLM polls via `get_pipeline_run` / `get_release` if it needs to.
- Definition edits (Phase 4.2).
- A `retry_pipeline_stage` workaround via `runPipeline` of the same template — semantically different from a stage retry (wastes successful upstream stages); not a substitute.
