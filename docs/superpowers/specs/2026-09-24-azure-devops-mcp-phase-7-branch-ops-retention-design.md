# Phase 7 — Branch ops, repo/pipeline admin & build retention (design)

**Date:** 2026-09-24
**Status:** approved 2026-09-24; 7a shipped in v0.13.0; 7b shipped in v0.14.0
**Prior phase:** Phase 6 (definition creation, shipped 2026-09-04 in v0.12.0)
**Target versions:** 7a → 0.13.0, 7b → 0.14.0

## Goal

Replace the ad-hoc curl and Python that two real workflows needed with tool calls:

- **Monthly downmerge sweep (47 repos).** Decide per repo whether `main → staging → develop` needs work, and who to @-mention for conflicting commits. Blocked on: pairwise branch comparison, commit ranges, small branch lookups, clickable PR links, repo liveness fields.
- **master → main migration + retention cleanup.** Create `main` from a sha, flip repo default branches, flip ~109 pipeline default branches, and find/drop the retention leases that block deleting a dead build definition.

Shipped as two independent slices, each its own PR and version.

## Current state (verified 2026-09-24)

| Ask | Already there? |
| --- | --- |
| Author email in `list_commits` | **Yes** — `CommitSummary.author.email`. Only the range filter is missing. |
| `defaultBranch` in `list_repositories` | **Yes.** `isDisabled` / `isInMaintenance` / `size` are missing. |
| PR `webUrl` | No — only the API `url`. |
| Everything else | No. |

Every endpoint below is wrapped by `azure-devops-node-api`; no raw HTTP.

## Slice 7a — reads & compares (v0.13.0)

### `compare_branches` (new, `commits` domain, read)

Inputs: `project?`, `repository?` (cwd auto-detect), `base: string`, `target: string`, `includeCommits: boolean = false`, `top: int ≤ 200 = 100`.

SDK: `GitApi.getCommitDiffs(repoId, project, diffCommonCommit = true, top, 0, baseVersionDescriptor{branch}, targetVersionDescriptor{branch})`.

Output:
```ts
{
  base: string; target: string;
  aheadCount: number;   // commits in target not in base
  behindCount: number;  // commits in base not in target
  commonCommit?: string;
  changeCounts?: { Add?: number; Edit?: number; Delete?: number };
  commits?: CommitSummary[]; // only when includeCommits — fetched via getCommits(compareVersion); getCommitDiffs returns file changes, not commits
}
```

Branch inputs accept short names; `refs/heads/` is stripped for the version descriptor (the SDK descriptor takes the bare branch name).

### `list_commits` — add `notInBranch?: string`

Maps to `searchCriteria.compareVersion = { version: notInBranch, versionType: branch }` with `itemVersion = branch`. Result = commits reachable from `branch` but not from `notInBranch`. When `notInBranch` is set, `branch` is required; the service rejects the call with a plain validation error otherwise. Tool description gains: "author.email is included — use it for identity lookups".

### `list_branches` — add `names?`, `nameContains?`, `baseBranch?`

- `baseBranch` → `getBranches(repoId, project, baseVersionDescriptor{ version: baseBranch, versionType: branch })`; ahead/behind are then relative to that branch.
- `names: string[]` — exact-match allowlist (short names). `nameContains: string` — case-insensitive substring. Both applied client-side after the fetch; the concern is response size in model context, not API cost.
- When `names` is given, the result becomes `{ branches: BranchSummary[], missing: string[] }`. Without `names` it stays a plain array (unchanged contract).

### PR `webUrl`

Added to the PR summary/detail shapes returned by `list_pull_requests`, `get_pull_request`, `create_pull_request`: `${pr.repository.webUrl}/pullrequest/${pr.pullRequestId}`. Omitted when `repository.webUrl` is absent. No string assembly from collection URL/project/repo parts.

### `list_repositories` — add `isDisabled`, `isInMaintenance`, `size`

Straight passthrough from `GitRepository`. Description notes: no `defaultBranch` + `size: 0` ⇒ never pushed to.

### 7a tests

FakeAdoClient unit tests: compare counts + optional commits; `notInBranch` without `branch` rejected; `names` → `missing`; `nameContains` filtering; `baseBranch` passed as descriptor; `webUrl` built and omitted; repo fields passed through.

## Slice 7b — writes & retention (v0.14.0)

### Gating decision

Option A (chosen): existing pattern — write tools behind `AZURE_DEVOPS_READ_ONLY`, "always confirm before calling" in the description of every destructive tool — plus hard in-tool guards on `delete_build_lease`. No additional env opt-in.

### `create_branch` (new, `commits` domain → new `writeService.ts` / `writeTools.ts`)

Inputs: `project?`, `repository?`, `name`, `from` (branch name or 40-hex sha).

1. `from` matching `/^[0-9a-f]{40}$/i` is used as the sha; otherwise resolved via `getBranch(from).commit.commitId` (missing → plain error "source branch not found").
2. `updateRefs([{ name: 'refs/heads/<name>', oldObjectId: '0'.repeat(40), newObjectId: sha }])`.
3. **`updateRefs` returns 200 with per-ref `success: false`** (e.g. ref name conflict, policy, missing permission). The service inspects `success` / `updateStatus` and throws a plain `Error` naming the status (not `AdoConflictError`, whose fixed "state changed, re-fetch" message would mislead). Never report success on a failed ref update.

Output: `{ name, objectId }`. No confirmation line — additive and trivially reversible.

`delete_branch` is **deliberately not implemented**: branch deletion stays a human action behind branch policy.

### `set_default_branch` (new, `repositories` domain, write)

Inputs: `project`, `repository`, `branch`.

1. Pre-check `getBranch(branch)`; refuse if it does not exist (ADO would otherwise accept a dangling default).
2. `updateRepository({ defaultBranch: 'refs/heads/<branch>' }, repoId, project)` — a PATCH, partial body is safe.

Output: `{ repository, previous, current }`. Confirmation line. One repo per call.

The `repositories` domain gains `writeService.ts` / `writeTools.ts`; the existing `service.ts` / `tools.ts` become `readService.ts` / `readTools.ts` to match the other domains.

### `set_pipeline_default_branch` (new, `pipelines` writeService)

Inputs: `project`, `repository?`, `fromBranch?`, `toBranch`, `definitionIds?: int[]`, `dryRun: boolean = true`.

1. **Candidates:** `definitionIds` if given; else `getDefinitions(project, repositoryId, repositoryType: 'TfsGit')` for `repository`. Neither given → rejected (no accidental project-wide sweep).
2. For each candidate, GET the full definition. The value lives at **`definition.repository.defaultBranch`**, not top level. Normalize to `refs/heads/…`. Skip with reason when `fromBranch` is set and doesn't match, or when already on `toBranch`.
3. **Dry run** returns `{ dryRun: true, changes: [{ id, name, current, next }], skipped: [{ id, name, current, reason }] }`. When `changes` is empty, add `note` summarising the distinct current values seen — so an empty result is visibly suspicious, not silently "nothing to do".
4. **Apply** PUTs the *entire* GET body back with its `revision` (ADO drops fields on partial bodies), via the same client path as `update_pipeline_variables` so secret variables survive. Sequential; per-definition failures (409 etc.) are collected, the batch continues. Output `{ dryRun: false, updated, skipped, failed: [{ id, name, error }] }`.

Confirmation line: "always run with dryRun first and show the user the change list before applying".

### New `retention` domain

`src/domains/retention/` — `readService.ts`, `readTools.ts`, `writeService.ts`, `writeTools.ts`, `schemas.ts`. Separate domain because it spans Build and Release APIs and domains may not import each other.

#### `list_build_leases` (read)

Inputs: `project`, `buildId`. SDK: `BuildApi.getRetentionLeasesForBuild`.

Output per lease: `{ leaseId, ownerId, ownerType, definitionId, runId, validUntil, protectPipeline, createdOn }`. `ownerType` parsed from the `ownerId` prefix: `RM` | `Pipeline` | `Branch` | `User` | `other`. Prefix formats verified against real lease output at implementation time; unknown prefixes map to `other`.

#### `delete_build_lease` (write)

Inputs: `project`, `buildId`, `leaseId`, `force: boolean = false`.

1. Fetch leases for `buildId`; `leaseId` not among them → refuse (guards against a lease id from another build).
2. `protectPipeline: true` and not `force` → refuse, naming the owner.
3. `deleteRetentionLeasesById(project, [leaseId])`.

Output: `{ deleted: true, lease: <pre-delete lease> }`. Confirmation line: retention may be keeping this build for audit.

#### `find_build_retainers` (read)

Inputs: `project`, `buildDefinitionId`.

`ReleaseApi.getReleaseDefinitions(project, expand: Artifacts)` (paged via continuation token), then client-side filter to artifacts with `type === 'Build'` and `definitionReference.definition.id === String(buildDefinitionId)`. Output: `[{ releaseDefinitionId, name, artifactAlias, isPrimary }]`. Server-side `artifactSourceId` filtering is not used: it needs the `projectId:defId` form and is inconsistent on ADO Server.

### 7b tests

`updateRefs` `success: false` → error naming the status; sha vs branch `from`; missing source branch; `set_default_branch` nonexistent-branch refusal; dry run reads `repository.defaultBranch`; empty dry run carries `note`; apply preserves an unrelated secret variable; one failing definition does not abort the batch; lease not on build refused; `protectPipeline` refused without `force`, allowed with it; `ownerType` parsing incl. `other`; retainer filtering by definition id; registration test that all four write tools vanish under read-only.

## Cross-cutting

- **PAT scopes.** Expected: `set_default_branch` → Code (manage) (new); `create_branch` → Code (write) (existing); lease tools → Build (read & execute) (existing); `find_build_retainers` → Release (read) (existing). Verified at implementation time; any new scope updated in `src/setup.ts`, `src/ado/errors.ts`, `README.md`.
- **SDK types** re-exported via `src/ado/types.ts` (`GitCommitDiffs`, `GitRefUpdate`, `GitRefUpdateResult`, `RetentionLease`, …).
- **`AdoError` guard** in every new `SdkAdoClient` try/catch.
- **Docs per slice:** README tool tables, ROADMAP entry, `package.json` version bump.

## Out of scope

- `delete_branch` (human-only, by design).
- Creating or updating retention leases.
- Bulk `set_default_branch`.
- Server-side `artifactSourceId` retainer lookup.
