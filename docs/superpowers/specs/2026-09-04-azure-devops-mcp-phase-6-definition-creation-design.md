# Phase 6 — Pipeline & release definition creation (design)

**Date:** 2026-09-04
**Status:** draft, pending review
**Prior phase:** Phase 5.1 (comment deletion, shipped 2026-09-03 in v0.11.0)
**Target version:** 0.12.0

## Goal

Let the LLM create the *definitions* behind runs, not just the runs. Today `queue_pipeline_run` starts a build of an existing pipeline and `create_release` cuts a release from an existing release definition; there is no way to bring a new pipeline or a new release definition into existence. This phase adds that, plus the matching deletes so a botched creation can be undone.

Four write tools:

| Tool | SDK call | Confirmation? |
| --- | --- | --- |
| `create_pipeline` | `PipelinesApi.createPipeline` | No |
| `delete_pipeline` | `BuildApi.deleteDefinition` | Yes |
| `create_release_definition` | `ReleaseApi.getReleaseDefinition` → `ReleaseApi.createReleaseDefinition` | Yes |
| `delete_release_definition` | `ReleaseApi.deleteReleaseDefinition` | Yes |

All four register behind the existing `AZURE_DEVOPS_READ_ONLY` gate. All four are native SDK calls; no raw HTTP.

## Why clone, not compose

A release definition is a large document: environments, each with rank, owner, pre/post approvals, retention policy, execution policy, and at least one deploy phase with an agent queue id and its task list; artifacts wired to a build definition by project and definition id; triggers. Exposing that as a tool schema means the LLM composes it from scratch, and the failure mode is a definition that saves but does not deploy.

In practice every new release definition in a project is a variant of an existing one: same stages, same agent pool, same deploy tasks, different artifact and name. So `create_release_definition` works by **cloning**: it fetches an existing definition, strips the identity fields, applies a small set of overrides, and posts the result. This is what the ADO web UI's "Clone" does, and it guarantees the deploy phases and approvals are ones that already work in that project.

Composing from a compact spec (name, environments with approvers, agent pool, empty task list) is explicitly deferred. If a real need shows up, it becomes a `spec` input alongside `cloneFromDefinitionId`, not a replacement.

Pipelines have no such problem: a YAML pipeline is a pointer to a file in a repo, so `create_pipeline` composes directly.

## Tools

### `create_pipeline`

Creates a YAML pipeline that points at a yaml file in an Azure Repos git repository.

Inputs:
- `project: string`
- `name: string` — pipeline name; must be unique within the folder
- `repository: string` — repository **name** (not id); resolved to the GUID via `listRepositories`
- `yamlPath: string` — path to the YAML file within the repo, e.g. `azure-pipelines.yml` or `pipelines/deploy.yml`. A leading `/` is added if missing (ADO stores it as `/path`).
- `folder?: string` — pipeline folder, e.g. `\\Backend`. Defaults to `\\` (root).

SDK call:

```ts
pipelines.createPipeline(
  {
    name,
    folder,
    configuration: {
      type: ConfigurationType.Yaml,
      path: yamlPath,
      repository: { id: repoId, name: repository, type: 'azureReposGit' },
    },
  },
  project,
);
```

**SDK type gap.** The installed `azure-devops-node-api` types `CreatePipelineConfigurationParameters` as `{ type?: ConfigurationType }` only; the REST endpoint accepts `path` and `repository` on the same object and requires them for YAML. `src/ado/types.ts` exports a local `CreateYamlPipelineParameters` that widens the configuration with `path` and `repository: { id; name; type: 'azureReposGit' }`. `SdkAdoClient.createPipeline` builds that object and passes it to the SDK method (structurally compatible; no cast needed because the SDK type is a subset).

Service logic:
1. `listRepositories({ project })`, find by name (case-insensitive). Not found → `AdoNotFoundError` naming the repo and the project.
2. Normalise `yamlPath` (prefix `/`), default `folder` to `\\`.
3. `createPipeline`. Return `{ pipelineId, name, folder, url, repository, yamlPath }`.

Errors: duplicate name in folder returns 400 from ADO. `mapSdkError` has no 400 class; it lands in `AdoUnknownError` with ADO's own message ("...already exists..."), which is descriptive enough — no pre-check and no new error class. Missing yaml file at that path is **not** validated at create time by ADO; the first run fails instead. The tool description says so and points at `queue_pipeline_run` to verify.

No confirmation line: creating a pipeline runs nothing and is reversible via `delete_pipeline`.

### `delete_pipeline`

Deletes a pipeline definition. ADO soft-deletes: the definition and its builds move to the recycle bin and can be restored from the UI for 30 days (`BuildApi.restoreDefinition` exists; we do not wrap it).

Inputs: `project`, `pipelineId`.

Service: `deleteDefinition(project, pipelineId)`; return `{ pipelineId, deleted: true }`.

Description carries: "Always confirm with the user before calling — this removes the pipeline and its run history from the project (recoverable from the recycle bin for 30 days)."

### `create_release_definition`

Clones an existing release definition under a new name, with optional overrides.

Inputs:
- `project: string`
- `cloneFromDefinitionId: number` — the definition to copy. Use `list_release_definitions` to find it.
- `name: string` — new definition name; must be unique in the project
- `description?: string`
- `path?: string` — folder, e.g. `\\Web`. Defaults to the source definition's folder.
- `artifactSources?: Array<{ alias: string; buildDefinitionId: number }>` — rebind the named artifact alias to a different build pipeline. Alias must exist on the source definition; unknown alias → error listing the source's aliases.
- `variables?: Record<string, { value: string; isSecret?: boolean; allowOverride?: boolean }>` — definition-level variables to set on the clone (merged over the cloned variables, same merge rule as `update_release_variables`).

Service logic:
1. `getReleaseDefinition({ project, definitionId: cloneFromDefinitionId })`. Not found → `AdoNotFoundError`.
2. Deep-copy, then apply the **clone-strip rules** (below).
3. Set `name`, `description`, `path`.
4. For each `artifactSources` entry: find the artifact by alias, `getPipelineDefinition({ project, definitionId: buildDefinitionId })` to get its name, set `definitionReference.definition = { id: String(buildDefinitionId), name }`. Leave `project` reference and `type: 'Build'` unchanged.
5. Merge `variables` (secret-preservation rule from Phase 4.2 applies).
6. `createReleaseDefinition`. Return `{ definitionId, name, path, url, environments: string[], artifacts: Array<{ alias, sourcePipeline }> }`.

Description carries: "Always confirm with the user before calling — creates a new release pipeline visible to the whole project. Creation deploys nothing; use `create_release` afterwards."

#### Clone-strip rules

Applied to the fetched `ReleaseDefinition` before POST. Verified against the ADO REST 7.1 "Definitions - Create" sample body, where every id in the request is `0` and server-owned fields are absent.

Top level — **remove**: `id`, `revision`, `url`, `_links`, `createdBy`, `createdOn`, `modifiedBy`, `modifiedOn`, `lastRelease`, `isDeleted`, `comment`. **Set**: `source = ReleaseDefinitionSource.RestApi`.

Per environment — **set** `id = 0`; **remove** `badgeUrl`, `currentRelease`, `deployStep` (it carries a server id and is regenerated); **set** every `preDeployApprovals.approvals[].id`, `postDeployApprovals.approvals[].id`, `preDeploymentGates.id`, `postDeploymentGates.id` to `0`; **empty** `environmentTriggers` (its entries reference the source definition's environment ids and would point at the wrong definition).

**Keep untouched**: `rank`, `owner`, `name`, `variables`, `variableGroups`, `deployPhases` (including `deploymentInput.queueId` and `workflowTasks` — this is the whole point of cloning), `conditions` (they reference environments by name, and names are not changed), `retentionPolicy`, `executionPolicy`, `environmentOptions`, `demands`, `schedules`, `properties`.

Top-level `triggers` are kept: `artifactSource` triggers reference `artifactAlias`, which survives the clone. `artifacts` are kept, with `definitionReference` rewritten only for aliases named in `artifactSources`.

Environment renames are **not** supported in this phase. Renaming an environment would require rewriting `conditions[]` entries of type `environmentState` that reference the old name; leaving that out keeps the strip rules mechanical.

### `delete_release_definition`

Inputs: `project`, `definitionId`, `comment?: string`, `forceDelete?: boolean` (default `false`).

Service: `deleteReleaseDefinition(project, definitionId, comment, forceDelete)`; return `{ definitionId, deleted: true }`.

`forceDelete: false` (default) makes ADO refuse with 400 when a release from this definition is still in progress; the error is surfaced as-is with a hint to pass `forceDelete: true`, which cancels in-flight deployments first. ADO soft-deletes release definitions too (`undeleteReleaseDefinition` exists; not wrapped).

Description carries: "Always confirm with the user before calling — removes the release pipeline and all its releases from the project. Refuses if a deployment is in progress unless `forceDelete` is true."

## Cross-cutting decisions

### Confirmation pattern

Three of four tools carry the "always confirm before calling" line: both deletes (irreversible from the LLM's point of view even if ADO keeps a recycle bin) and `create_release_definition` (creates a project-wide, shared object). `create_pipeline` does not: it runs nothing, is cheap to undo, and the typical flow is "add a pipeline for this yaml file I just wrote".

### Read-only mode

All four are write tools; `registerAllTools` skips them under `AZURE_DEVOPS_READ_ONLY=true`.

### PAT scopes

| Tool | Scope per REST 7.1 docs | Already requested? |
| --- | --- | --- |
| `create_pipeline` | `vso.build_execute` (Build: read & execute) | yes |
| `delete_pipeline` | `vso.build_execute` | yes |
| `create_release_definition` | `vso.release_execute` (Release: read, write & execute) | yes |
| `delete_release_definition` | `vso.release_manage` (Release: read, write, execute & manage) | **no** |

`delete_release_definition` is the first tool that needs the **manage** tier of Release. The three scope doc places (`src/setup.ts` wizard copy, `src/ado/errors.ts` auth hint, `README.md` scopes table) change "Release (read, write, & execute)" to "Release (read, write, execute, & manage)" for the full (write) profile. `AdoScopeError`'s heuristic list in `errors.ts` currently matches `vso.build_execute` and `vso.release_execute` only; add a `vso.release_manage` branch that names the manage tier.

### Error mapping

No new error classes. 400 on duplicate name (both creates) → `AdoUnknownError` carrying ADO's message, so the LLM sees "already exists". 404 on a missing clone source or repo → `AdoNotFoundError`. 409 is not expected on creates.

### Layering

`domains/pipelines` owns `create_pipeline` and `delete_pipeline`; `domains/releases` owns the other two. `create_release_definition` needs the build definition's name for the artifact rewrite; that goes through `AdoClient.getPipelineDefinition`, which is an `ado/` method, so no `domains/releases` → `domains/pipelines` import is introduced. Same for `listRepositories` from `domains/pipelines`.

## File structure

```
src/ado/types.ts                       + CreateYamlPipelineParameters, re-export Pipeline, ConfigurationType
src/ado/client.ts                      + createPipeline, deletePipelineDefinition,
                                         createReleaseDefinition, deleteReleaseDefinition
src/ado/sdkClient.ts                   + the four implementations (AdoError guard on each)
src/ado/errors.ts                      ~ scope hint text; vso.release_manage in AdoScopeError patterns
src/setup.ts                           ~ wizard scope copy
src/domains/pipelines/schemas.ts       + CreatePipelineInput, DeletePipelineInput
src/domains/pipelines/writeService.ts  + createPipeline, deletePipeline
src/domains/pipelines/writeTools.ts    + 2 tool defs
src/domains/releases/cloneDefinition.ts  NEW — pure function: stripForClone(def) → ReleaseDefinition
src/domains/releases/schemas.ts        + CreateReleaseDefinitionInput, DeleteReleaseDefinitionInput
src/domains/releases/writeService.ts   + createDefinition, deleteDefinition
src/domains/releases/writeTools.ts     + 2 tool defs
test/fakes/FakeAdoClient.ts            + 4 methods with recorded calls + injectable results
test/unit/domains/pipelines/writeService.test.ts   + create/delete cases
test/unit/domains/releases/cloneDefinition.test.ts NEW — strip rules, one assertion per rule
test/unit/domains/releases/writeService.test.ts    + create (clone + overrides) / delete cases
README.md                              ~ scopes table, write-tools table
docs/ROADMAP.md                        + Phase 6 entry
package.json                           ~ 0.12.0
```

`cloneDefinition.ts` is a separate pure module so the strip rules are testable without the service and readable as a checklist.

## Testing strategy

Unit tests with `FakeAdoClient`, same as every prior phase.

- **`stripForClone`** — build a fixture definition with every server-owned field populated (ids on env, approvals, gates, deployStep; badgeUrl; currentRelease; environmentTriggers; top-level identity fields). Assert each rule individually. Assert `deployPhases`, `queueId`, `workflowTasks`, `rank`, `owner`, `conditions`, `triggers`, `artifacts` survive byte-for-byte.
- **`createDefinition`** — clone with no overrides posts the stripped source under the new name; `artifactSources` rewrites only the named alias and resolves the build definition name; unknown alias throws listing valid aliases; `variables` merge preserves an existing secret; source not found propagates `AdoNotFoundError`.
- **`createPipeline`** — repo name resolves to id (case-insensitive); unknown repo throws naming project + repo; `yamlPath` gets its leading slash; folder defaults to root; posted `configuration` has `type: yaml`, `path`, `repository.type: 'azureReposGit'`.
- **deletes** — forward the ids; `forceDelete`/`comment` pass through; result shape is `{ ..., deleted: true }`; injected errors propagate.
- **Registration** — extend the existing stdio smoke check: full mode lists all four, read-only lists none.

One manual verification against a real ADO instance before release: clone a real definition, open it in the UI, confirm stages and tasks are intact, create a release from it, then delete it. This is the only way to catch a strip rule ADO rejects; the docs sample body is the best available reference but on-prem versions can differ.

## What we are not building

- Composing a release definition from a compact spec (deferred; see "Why clone").
- Classic (designer JSON) build definitions. YAML only.
- Pipelines pointing at GitHub or other external repos. `azureReposGit` only.
- Environment renames during clone.
- Restore/undelete tools. The recycle bin in the UI covers it.
- Editing a definition's deploy tasks, approvals, or environments after creation. Phase 4.2 covers variables and triggers; anything deeper stays in the UI.
