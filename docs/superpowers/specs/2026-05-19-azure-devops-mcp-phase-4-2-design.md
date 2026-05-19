# Phase 4.2 — Pipeline & release definition edits + retry_pipeline_stage (design)

**Date:** 2026-05-19
**Status:** draft, pending review
**Tracks:** ZDV-240 (sub-phase of parent Phase 4, ZDV-173)
**Prior phase:** Phase 4.1 (`docs/superpowers/specs/2026-05-18-azure-devops-mcp-phase-4-1-design.md`, shipped 2026-05-18 in v0.6.0)

## Goal

Add the five tools deferred from Phase 4.1: one run-action (`retry_pipeline_stage`) and four definition-edit tools (`update_pipeline_variables`, `update_pipeline_triggers`, `update_release_variables`, `update_release_environment_variables`). These let the LLM re-run a single failed stage instead of the whole build, and mutate the persistent variable / trigger surface of pipeline + release definitions.

## Deviation from the ZDV-240 brief

**The ticket assumed `retry_pipeline_stage` needs a raw-HTTP helper.** Verification against the installed `azure-devops-node-api` (during exploration for this spec) shows the SDK *does* wrap the stage-retry endpoint:

```ts
BuildApi.updateStage(
  updateParameters: UpdateStageParameters,  // { forceRetryAllJobs?, retryDependencies?, state? }
  buildId: number,
  stageRefName: string,
  project?: string,
): Promise<void>
```

`UpdateStageParameters.forceRetryAllJobs` is exactly the field the ticket calls out as needing raw HTTP. It targets the same `/_apis/build/builds/{buildId}/stages/{stageRefName}` endpoint with the same semantics (force-retry all jobs in the stage), and is the documented way to retry a single stage via the SDK.

**Decision:** Use `BuildApi.updateStage`. **No raw-HTTP infrastructure on `SdkAdoClient` is introduced in this phase.** Defer raw-HTTP plumbing to the first tool that genuinely needs an unwrapped endpoint. This makes Phase 4.2 substantially smaller — all five tools become SDK-method-backed, mirroring the Phase 4.1 pattern.

If, during implementation, `BuildApi.updateStage` turns out to behave differently than the Pipelines REST endpoint named in the ticket (e.g. different semantics for YAML multi-stage pipelines, or an ADO bug), the implementation plan should flip back to raw HTTP and the raw-HTTP helper section of this spec (kept below as an appendix) becomes the design.

## Scope

5 net-new tools — all writes. No new read tools. All five register behind the existing `AZURE_DEVOPS_READ_ONLY` gate plumbed through `registerAllTools`.

### Run actions (1 tool)

| Tool | SDK call | Confirmation? |
| --- | --- | --- |
| `retry_pipeline_stage` | `BuildApi.updateStage({ forceRetryAllJobs: true }, runId, stageName, project)` | No |

Inputs: `project`, `runId`, `stageName`, `forceRetryAllJobs?` (default `true`). Returns `{ runId, stageName, retried: true }` — the SDK call returns `void`, so the service synthesises a confirmation shape after the call succeeds.

Retrying a stage on an already-completed-successfully run returns 409 → `AdoConflictError`, same as cancel-already-cancelled. Stage-not-found returns 400/404 → `AdoNotFoundError`. `stageName` is passed as `stageRefName` — ADO matches against the YAML stage name verbatim (case-sensitive).

No confirmation prompt: re-running a failed stage is a normal recovery action and lower blast-radius than a deploy.

### Definition edits (4 tools)

All four mutate persistent config and get a "Always confirm with the user before calling — this changes pipeline/release configuration visible to every future run" line in the tool description.

The SDK forces a full-document PUT (`updateDefinition` / `updateReleaseDefinition`), so each service method internally does **GET → mutate → PUT**. The `revision` field on the fetched document is preserved in the PUT body; ADO uses it for optimistic concurrency and returns 409 on stale-write (already mapped to `AdoConflictError`).

| Tool | SDK calls (in order) | Mutation target |
| --- | --- | --- |
| `update_pipeline_variables` | `BuildApi.getDefinition` → `BuildApi.updateDefinition` | `definition.variables` |
| `update_pipeline_triggers` | `BuildApi.getDefinition` → `BuildApi.updateDefinition` | `definition.triggers` |
| `update_release_variables` | `ReleaseApi.getReleaseDefinition` → `ReleaseApi.updateReleaseDefinition` | `definition.variables` |
| `update_release_environment_variables` | `ReleaseApi.getReleaseDefinition` → `ReleaseApi.updateReleaseDefinition` | `environment.variables` (per-env) |

#### `update_pipeline_variables`

Inputs:
- `project: string`
- `pipelineId: number`
- `set?: Record<string, { value: string; isSecret?: boolean; allowOverride?: boolean }>`
- `remove?: string[]`

At least one of `set` / `remove` is required (enforced in the service, not the schema — same convention as `update_build_tags`).

Service logic:
1. `GET` definition → has `variables: { [name]: BuildDefinitionVariable }`.
2. Start with the existing variables object **unchanged** (this is the secret-preservation guarantee; see below).
3. For each entry in `set`: overwrite `vars[name] = { value, isSecret, allowOverride }`. If `isSecret` is omitted and an existing variable at that name was secret, preserve `isSecret: true`. (Prevents an LLM accidentally declassifying a secret on update.)
4. For each name in `remove`: `delete vars[name]`.
5. Write the mutated `variables` back onto the fetched definition object; keep all other fields including `revision`.
6. `PUT` the definition. Return `{ pipelineId, variables: { [name]: { value: string|null, isSecret: boolean } } }` — secret values are reported as `null` (mirroring ADO's GET behaviour) so the LLM can't accidentally log them.

#### `update_pipeline_triggers`

Inputs:
- `project: string`
- `pipelineId: number`
- `triggers: unknown[]` — typed as `z.array(z.record(z.unknown()))` in Zod; the LLM is instructed in the tool description to fetch the current definition via `get_pipeline_definition` first, edit the array, then submit. Strongly typing each `BuildTrigger` variant (CI / PR / Schedule / ContinuousIntegrationTrigger) in Zod is rejected — the SDK's union is large and version-dependent, and the LLM's natural workflow is "fetch JSON, mutate, submit JSON".

Service logic:
1. `GET` definition.
2. Overwrite `definition.triggers = args.triggers as BuildTrigger[]`.
3. `PUT` the definition.
4. Return `{ pipelineId, triggers }` (echo back).

ADO validates trigger shape server-side; bad payloads → 400 → propagates as `AdoUnknownError` with the ADO message intact.

#### `update_release_variables`

Inputs: `project`, `definitionId`, `set?`, `remove?` — same shape as `update_pipeline_variables` but the variable element type is `ConfigurationVariableValue` (`{ value?, isSecret?, allowOverride? }`, no `secretsValueFromKeyVault`, no enum-list `value`, etc. — those fields exist on `ConfigurationVariableValue` but we don't expose them; the LLM falls back to manual ADO edits for those edge cases).

Same service logic as `update_pipeline_variables`, against the release definition's top-level `variables`.

#### `update_release_environment_variables`

Inputs:
- `project: string`
- `definitionId: number`
- `environmentName: string`
- `set?` / `remove?` — same shape as the other variable tools

Service logic:
1. `GET` release definition.
2. Locate the environment by case-insensitive name match against `definition.environments[].name` (same matcher as Phase 4.1 `deploy_release_stage` for consistency).
3. If not found, throw `Error` with the list of available environment names (matches Phase 4.1 convention — not an `AdoError` because it's a caller mistake, not an ADO state issue).
4. Mutate `env.variables` (preserving secrets per the rules below).
5. `PUT` the whole release definition.

Returns `{ definitionId, environmentId, environmentName, variables: { [name]: { value: string|null, isSecret: boolean } } }`.

## Secret preservation — the load-bearing correctness guarantee

This is the highest-risk piece of the phase. The failure mode: a user runs `update_pipeline_variables` to change one non-secret variable, and an unrelated secret gets dropped because we sent a `variables` payload that didn't include it.

### How ADO behaves on GET / PUT

- **GET** a definition: secret variable values come back as `null`. The variable's key is still present with `isSecret: true, value: null`.
- **PUT** a definition: ADO replaces the entire `variables` map with the submitted one. Any variable name that was in the previous map but is absent from the submitted map is **deleted**. For variables that *are* present in the submitted map: if `isSecret: true` and `value` is `null` or absent, ADO **preserves the existing stored secret value**. If `isSecret: true` and `value` is a non-null string, ADO **overwrites** the stored secret with that string.

### Service-layer rule

The service constructs the PUT payload by **starting from the GET response's `variables` object** and applying mutations on top. It does NOT build a fresh object from `set` alone. Concretely:

```ts
const merged = { ...existing.variables };          // includes all secrets with value:null
for (const name of args.remove ?? []) delete merged[name];
for (const [name, v] of Object.entries(args.set ?? {})) {
  const prev = merged[name];
  merged[name] = {
    value: v.value,
    isSecret: v.isSecret ?? prev?.isSecret ?? false,
    allowOverride: v.allowOverride ?? prev?.allowOverride,
  };
}
```

The `isSecret ?? prev?.isSecret` fallback is the "don't accidentally declassify a secret on update" rule called out above.

A non-negotiable test fixture for the implementation plan:

- GET returns `{ existingSecret: { isSecret: true, value: null }, plainVar: { value: "foo" } }`.
- Caller invokes `set: { plainVar: { value: "bar" } }`.
- The argument captured by the fake's `updateDefinition` MUST include `existingSecret` with `isSecret: true` (value can be null/undefined). Failing this test = secret loss in production.

## Cross-cutting decisions

### Confirmation pattern

All four definition-edit tool descriptions start with "**Always confirm with the user before calling — this changes pipeline/release configuration visible to every future run.**" Matches the Phase 4.1 precedent (`deploy_release_stage`, `approve_release_gate`). `retry_pipeline_stage` skips the line — re-running a failed stage is a normal recovery action.

### Read-only mode

All five tools register inside the `options.readOnly ? [] : [...]` branch in `registerAllTools`. No new read tools.

### PAT scopes

No new scopes. The Phase 4.1 setup wizard already prints **Build (read & execute)** and **Release (read, write, & execute)** as required for writes (verified at `src/setup.ts:12-14`). Definition edits and stage retry are covered by those same scope grants.

### Error mapping

No new error class. Existing mapping covers all paths:
- 401/403 + scope hint → `AdoScopeError`
- 404 (definition or run not found) → `AdoNotFoundError`
- 409 (revision mismatch on PUT, or stage retry against completed run) → `AdoConflictError`. The existing `AdoConflictError` message already says "Re-fetch the resource and try again" which is the correct hint for revision-mismatch.
- 400 (bad trigger shape, invalid stage name) → falls through to `AdoUnknownError` with ADO's message attached.

### Idempotency

Same as Phase 4.1: no idempotency wrapping. Conflicts propagate.

## File structure

Per the user's saved feedback ("colocate everything a feature needs in one folder"), Phase 4.2 strictly extends the existing `src/domains/pipelines/` and `src/domains/releases/` files. No new top-level domains.

**New files:** none.

**Modified files:**

- `src/ado/client.ts` — add 5 method signatures (`retryBuildStage`, `getPipelineDefinitionForUpdate` reuses existing `getPipelineDefinition`; new: `updatePipelineDefinition`, `updateReleaseDefinition` — but a single GET method is enough; we add `retryBuildStage`, `updatePipelineDefinition`, `updateReleaseDefinition` only). Final count: **3 new client methods.**
  - `retryBuildStage(args: { project; runId; stageName; forceRetryAllJobs })`
  - `updatePipelineDefinition(args: { project; definitionId; definition: BuildDefinition })`
  - `updateReleaseDefinition(args: { project; definition: ReleaseDefinition })`
  - Existing `getPipelineDefinition` and `getReleaseDefinition` are reused for the GET half.
- `src/ado/sdkClient.ts` — implement the 3 new methods.
- `src/domains/pipelines/writeService.ts` — extend `PipelinesWriteService` with `retryStage`, `updateVariables`, `updateTriggers`.
- `src/domains/pipelines/writeTools.ts` — extend `buildPipelineWriteTools` with 3 new tool defs.
- `src/domains/pipelines/schemas.ts` — add `RetryPipelineStageInput`, `UpdatePipelineVariablesInput`, `UpdatePipelineTriggersInput`.
- `src/domains/releases/writeService.ts` — extend `ReleasesWriteService` with `updateVariables`, `updateEnvironmentVariables`.
- `src/domains/releases/writeTools.ts` — extend `buildReleaseWriteTools` with 2 new tool defs.
- `src/domains/releases/schemas.ts` — add `UpdateReleaseVariablesInput`, `UpdateReleaseEnvironmentVariablesInput`.
- `src/mcp/registerTools.ts` — no change (the new tools are returned by the existing `buildPipelineWriteTools` / `buildReleaseWriteTools` helpers).
- `test/fakes/FakeAdoClient.ts` — extend with stubs for the 3 new client methods + setter/recorder pairs.
- `test/unit/domains/pipelines/writeService.test.ts` — add tests for `retryStage`, `updateVariables`, `updateTriggers`.
- `test/unit/domains/releases/writeService.test.ts` — add tests for `updateVariables`, `updateEnvironmentVariables`.
- `docs/ROADMAP.md` — ✅ Phase 4.2 block (added on the merge commit, matching the Phase 4.1 convention).
- `package.json` — minor version bump (v0.7.0) on release.

## Testing strategy

Unit tests via `FakeAdoClient` mirror the Phase 4.1 pattern. Tests worth calling out explicitly in the implementation plan:

- `retry_pipeline_stage`: happy path passes `{ forceRetryAllJobs: true, stageName, runId, project }` exactly to the fake; 409 propagates as `AdoConflictError`.
- `update_pipeline_variables`:
  - **Secret-preservation fixture** (described above) — the load-bearing test.
  - `set`-only call merges into existing vars; round-trips `revision`.
  - `remove`-only call deletes the named key.
  - Combined `set` + `remove` works.
  - `isSecret`-not-supplied-on-existing-secret preserves `isSecret: true`.
  - Empty `set` and empty `remove` (or both omitted) throws the "provide at least one" error.
- `update_pipeline_triggers`: replaces the entire `triggers` array; round-trips revision.
- `update_release_variables`: same coverage as pipeline variables.
- `update_release_environment_variables`:
  - Environment-name match is case-insensitive (matches `deploy_release_stage`).
  - Not-found case lists available environments.
  - Secret preservation works at the per-env level — non-target environments' variables (and secrets) are untouched in the PUT body.

No contract tests (parking issue ZDV-233 still tracks the broader strategy).

## What we are not building

- Creating / deleting definitions (out per ticket).
- Editing classic-build task lists, release deploy steps, environment approvals/gates, retention policies (out per ticket — schema-dense surfaces with poor diff ergonomics).
- A raw-HTTP helper on `SdkAdoClient` (deferred until the first tool that actually needs an unwrapped endpoint — see "Deviation from the ZDV-240 brief").
- A typed Zod union for `BuildTrigger` variants — opaque pass-through is fine for the "fetch, edit, submit" workflow.
- Resolving variable groups (`update_pipeline_variable_groups` etc.) — separate surface, separate phase.

## Appendix: raw-HTTP helper design (only if `BuildApi.updateStage` proves unusable)

Kept here so the implementation plan has a fallback. **Not** part of the planned work.

Shape:

```ts
// On SdkAdoClient (private)
private async rawRequest<T>(opts: {
  method: "PATCH" | "POST" | "PUT" | "DELETE" | "GET";
  path: string;          // path-only, joined to this.api.serverUrl
  body?: unknown;
  apiVersion: string;    // e.g. "7.1"
}): Promise<T | null>
```

Implementation reuses `this.api.rest` (the `RestClient` from `typed-rest-client` that `azure-devops-node-api` constructs internally with the PAT handler + CA agent already wired). For PATCH: `this.api.rest.update<T>(url, body)` returns `IRestResponse<T>` with `.result` and `.statusCode`. Non-2xx already throws a shape compatible with `mapSdkError`.

URL construction:

```ts
const url = new URL(`${encodeURIComponent(project)}/_apis/${opts.path}`, this.api.serverUrl);
url.searchParams.set("api-version", opts.apiVersion);
```

Caller for `retry_pipeline_stage` (fallback variant only):

```ts
await this.rawRequest({
  method: "PATCH",
  path: `pipelines/${pipelineId}/runs/${runId}/stages/${encodeURIComponent(stageName)}`,
  body: { forceRetryAllJobs: true, state: 0 /* Retry */ },
  apiVersion: "7.1",
});
```

This requires fetching `pipelineId` from `getBuild(runId)` first (since the SDK-wrapped `updateStage` only needs `buildId`, but the Pipelines REST endpoint needs both).

Switching to this fallback would add: roughly +60 LOC on `sdkClient.ts`, an extra `getBuild` call inside `retryStage` to resolve `pipelineId`, and a small `rawRequest` unit test.
