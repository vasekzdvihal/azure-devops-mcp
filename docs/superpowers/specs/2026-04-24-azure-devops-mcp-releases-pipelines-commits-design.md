# Azure DevOps MCP — Releases, Pipelines & Commits (Phase 3) — Design

**Status:** Approved
**Date:** 2026-04-24
**Owner:** Vášek Zdvihal

## 1. Goal

Add read-only tools that answer deployment, CI, and branch-history questions against Azure DevOps. The canonical motivating question:

> *"On the Newton.n2 repo, who last published to production and what was published?"*

Secondary questions in scope:

- "Did last night's main build on pipeline X pass?"
- "What commits landed on `release/2026.04` since last Monday?"
- "Which stage failed on release #1234?"

## 2. Scope

### In scope

Three new domains, all read-only:

**Releases** (classic Release pipelines — `ReleaseApi`)
- `list_release_definitions`
- `list_releases`
- `get_release`
- `list_deployments` — flattened per-stage view; directly answers the canonical question

**Pipelines** (classic-build and YAML multi-stage, both via `BuildApi`)
- `list_pipelines`
- `list_pipeline_runs`
- `get_pipeline_run` — includes stages timeline, covers YAML multi-stage deployments

**Commits** (`GitApi`)
- `list_branches`
- `list_commits` — filters: branch, fromDate, toDate, author, top

Respect the existing `AZURE_DEVOPS_READ_ONLY` env var (no-op for this phase since all tools are read, but the registration plumbing goes through the same gate).

README updates: tool catalog additions and new PAT scope requirements.

### Out of scope

- Any write operations: queue a build, re-run a stage, approve a release gate, cancel a run, tag a build. Deferred to a later phase.
- Work items, wiki, artifacts, test results.
- Pagination cursors (use `top` like Phase 1).
- Aggregator / convenience tools that chain deployment → release → build → commit in one call. The LLM orchestrates across the composable primitives.
- Caching beyond the SDK connection cache that already exists.

## 3. Decisions

| Topic | Choice | Rationale |
|---|---|---|
| Both deployment models | Support classic Releases (`ReleaseApi`) **and** YAML multi-stage (`BuildApi` stages) | Newton uses both; skipping either leaves the canonical question unanswered for half the repos |
| Tool granularity | Composable primitives; no aggregators | Matches Phase 1/2 pattern; LLM chains `list_deployments` → `get_release` → `get_pipeline_run` → commit |
| Environment name matching | Return all stage/environment names in payload; do not filter server-side beyond the optional `environmentName` arg | "Production" vs "Prod" vs "PROD" varies by team; let the LLM filter. The `environmentName` arg is exact-match passthrough to the SDK. |
| Folder layout | Three folders: `src/domains/releases/`, `src/domains/pipelines/`, `src/domains/commits/` | Feature/domain-first org; Releases and Pipelines use different APIs and shouldn't share a folder; commits are git-layer |
| Cwd auto-detect | Commits domain only | `list_branches` / `list_commits` are repo-scoped — matches the PR-tools precedent. Releases and Pipelines are project-scoped, not repo-scoped, so cwd-resolution doesn't apply cleanly. |
| Response shape | Plain JSON objects, lightweight — no diff-style content | All three APIs return compact records; no need for the truncation machinery used in `get_pull_request_diff` |
| Pagination | `top` parameter, default 25, max 200 | Matches Phase 1 caps |
| PAT scopes | Document additions: `Release (read)` for releases, `Build (read)` for pipelines. `Code (read)` already covers commits. | Add a row to the README scopes table |
| Error mapping | Reuse existing buckets from `ado/errors.ts` | One addition: when `ReleaseApi` returns 404 at the collection level, hint *"classic releases may not be enabled on this collection"* |
| Testing | Unit tests per domain (vitest); mock `AdoClient`; schema tests for tool inputs | Matches Phase 1 precedent; no integration tests against live ADO |

## 4. Architecture

```
src/domains/
  releases/
    readService.ts    # pure logic; takes AdoClient
    readTools.ts      # MCP tool registration
    schemas.ts        # Zod input schemas
  pipelines/
    readService.ts
    readTools.ts
    schemas.ts
  commits/
    readService.ts
    readTools.ts
    schemas.ts
```

**Data flow** (unchanged from Phase 1):

```
MCP tool call
  → Zod schema validation (domains/<x>/schemas.ts)
  → readService.ts (pure logic, takes AdoClient)
  → ado/sdkClient.ts (cached azure-devops-node-api connection)
  → Azure DevOps REST API
  → service shapes response into lightweight JSON
  → readTools.ts wraps in MCP response via errorBoundary
```

Each domain registers its tools in `src/mcp/registerTools.ts`, gated by the existing `AZURE_DEVOPS_READ_ONLY` flag (no-op here since all tools are read).

**Reused infrastructure:**
- `src/ado/sdkClient.ts` — connection caching, PAT auth handler, TLS agent
- `src/ado/errors.ts` — error bucket mapping
- `src/mcp/errorBoundary.ts` — uniform MCP error wrapping
- `src/domains/pullRequests/repoResolution.ts` — cwd auto-detect for the commits domain

**New infrastructure:** none.

## 5. Tool contracts

All tools return JSON. Names use the existing short, unprefixed convention. Inputs validated by Zod. Services are pure functions taking `AdoClient` and input object.

### Releases

| Tool | Args | Returns |
|---|---|---|
| `list_release_definitions` | `project: string` | `{ id, name, path, createdBy, createdOn, modifiedOn }[]` |
| `list_releases` | `project: string, definitionId?: number, status?: "active"\|"abandoned"\|"draft", top?: number` | `{ id, name, definitionId, definitionName, status, createdOn, createdBy, description }[]` |
| `get_release` | `project: string, releaseId: number` | Full release: stages (each with `environmentName`, `status`, `deploymentStatus`, `deployedBy`, `completedOn`), artifacts (each with `sourceBuildId`, `sourceBranch`, `sourceVersion`), `createdBy`, `createdOn`, `description` |
| `list_deployments` | `project: string, definitionId?: number, environmentName?: string, status?: "succeeded"\|"partiallySucceeded"\|"failed"\|"inProgress"\|"notDeployed"\|"all", top?: number` | Flattened per-stage: `{ deploymentId, releaseId, releaseName, definitionId, definitionName, environmentName, status, requestedBy, requestedOn, startedOn, completedOn, sourceBuildId, sourceBranch, sourceVersion }[]` |

### Pipelines

| Tool | Args | Returns |
|---|---|---|
| `list_pipelines` | `project: string, repositoryId?: string` | `{ id, name, path, type ("build"\|"yaml"), repositoryId, defaultBranch }[]` |
| `list_pipeline_runs` | `project: string, pipelineId?: number, branch?: string, status?: "inProgress"\|"completed"\|"cancelling", result?: "succeeded"\|"failed"\|"canceled"\|"partiallySucceeded", top?: number` | `{ id, buildNumber, pipelineId, pipelineName, status, result, sourceBranch, sourceVersion, requestedBy, requestedFor, queueTime, startTime, finishTime }[]` |
| `get_pipeline_run` | `project: string, runId: number` | Run detail: all the list-row fields plus `stages: { name, status, result, startTime, finishTime }[]`, `triggerInfo`, `templateParameters` |

### Commits

| Tool | Args | Returns |
|---|---|---|
| `list_branches` | `project?: string, repository?: string` (cwd auto-detect) | `{ name, objectId, creator?, isBaseVersion }[]` |
| `list_commits` | `project?: string, repository?: string, branch?: string, fromDate?: string, toDate?: string, author?: string, top?: number` (cwd auto-detect) | `{ commitId, comment, author: { name, email, date }, committer: { name, email, date }, changeCounts, url }[]` |

## 6. Error handling

Five existing buckets plus one addition:

- **401** → existing handler; add mention of `Release (read)` / `Build (read)` to the scope hint
- **403** → existing handler
- **404** on release/build/run/branch → "not found in project X"
- **404 at `ReleaseApi` collection level** → **new:** "Release API unavailable — this collection may not have classic releases enabled"
- **409** → not expected on read endpoints; pass through
- Network / TLS → existing handlers

## 7. Testing

- `src/domains/releases/releases.test.ts` — mock `AdoClient.getReleaseApi()`, assert SDK calls and response shapes for all four tools
- `src/domains/pipelines/pipelines.test.ts` — mock `AdoClient.getBuildApi()`, assert all three tools; include one test exercising a YAML multi-stage run shape
- `src/domains/commits/commits.test.ts` — mock `AdoClient.getGitApi()`; include one test for cwd auto-detect path
- Schema tests per domain — valid/invalid input per tool

No integration tests against real ADO (matches Phase 1 precedent).

## 8. Documentation updates

- **README — Available tools:** add a new "Read tools — releases, pipelines, commits" subsection mirroring the Phase 1 table style
- **README — Required PAT scopes:** add rows for `Release (read)` and `Build (read)`, clarifying which tools need which
- **ROADMAP:** mark Phase 3 as shipped when this lands
