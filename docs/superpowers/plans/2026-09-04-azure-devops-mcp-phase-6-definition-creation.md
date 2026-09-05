# Phase 6 — Pipeline & release definition creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four write tools — `create_pipeline`, `delete_pipeline`, `create_release_definition` (clone-based), `delete_release_definition` — so the LLM can bring pipeline and release definitions into existence and undo a botched creation.

**Architecture:** Each tool is a native `azure-devops-node-api` call behind the existing `AdoClient` seam (`src/ado/client.ts` interface → `SdkAdoClient` impl → `FakeAdoClient` for tests). Domain services in `src/domains/pipelines` and `src/domains/releases` shape inputs and results; a new pure module `cloneDefinition.ts` holds the release-definition strip rules so each rule is unit-testable. All four register behind the `AZURE_DEVOPS_READ_ONLY` gate that `registerAllTools` already applies to write tools.

**Tech Stack:** TypeScript (ESM, NodeNext), Node ≥20, `azure-devops-node-api`, zod, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-04-azure-devops-mcp-phase-6-definition-creation-design.md`

## Global Constraints

- Relative imports use the `.js` extension even though sources are `.ts` (NodeNext).
- No `any`. `noUncheckedIndexedAccess` is on — narrow with `??` fallbacks.
- SDK types are imported only via `src/ado/types.ts`; domains never import `azure-devops-node-api/interfaces/...` directly.
- `domains/*` never imports another `domains/*`; `ado/`, `config/`, `git/` never import `domains/`.
- Every `try/catch` in `SdkAdoClient` guards with `if (err instanceof AdoError) throw err;` before `throw mapSdkError(err);`.
- Lint is enforced by `@vasekzdvihal/eslint-config`; run `pnpm lint:fix` before each commit (the pre-commit hook blocks unfixable errors). Lint needs Node ≥22 — use `nvm use` (`.nvmrc` = 22).
- `pnpm typecheck` covers `src/` only; `pnpm test` is the signal for `test/`.
- New ADO API surface → PAT scope text is updated in 3 places: `src/setup.ts`, `src/ado/errors.ts`, `README.md`.
- Tool descriptions for irreversible / project-wide actions carry the phrase "Always confirm with the user before calling".
- Target version: `0.12.0`.
- Commit messages end with the session's `Co-Authored-By` / `Claude-Session` trailers used elsewhere on this branch.

---

## File map

| File | Responsibility in this phase |
| --- | --- |
| `src/ado/types.ts` | re-export `Pipeline`, `ConfigurationType` (value), `ReleaseDefinitionSource` (value); define `CreateYamlPipelineParameters` |
| `src/ado/client.ts` | 4 new interface methods |
| `src/ado/sdkClient.ts` | 4 new implementations |
| `src/ado/errors.ts` | `vso.release_manage` scope branch; auth-hint copy |
| `src/setup.ts` | wizard scope copy |
| `test/fakes/FakeAdoClient.ts` | 4 new fake methods + recorders/setters |
| `src/domains/pipelines/schemas.ts` | `CreatePipelineInput`, `DeletePipelineInput` |
| `src/domains/pipelines/writeService.ts` | `createPipeline`, `deletePipeline` |
| `src/domains/pipelines/writeTools.ts` | 2 tool defs |
| `src/domains/releases/cloneDefinition.ts` | NEW: `stripForClone(def): ReleaseDefinition` |
| `src/domains/releases/schemas.ts` | `CreateReleaseDefinitionInput`, `DeleteReleaseDefinitionInput` |
| `src/domains/releases/writeService.ts` | `createDefinition`, `deleteDefinition` |
| `src/domains/releases/writeTools.ts` | 2 tool defs |
| `test/unit/domains/pipelines/writeService.test.ts` | create/delete pipeline cases |
| `test/unit/domains/releases/cloneDefinition.test.ts` | NEW: one test per strip rule |
| `test/unit/domains/releases/writeService.test.ts` | create/delete definition cases |
| `test/unit/ado/errors.test.ts` | release_manage scope detection |
| `README.md`, `docs/ROADMAP.md`, `package.json` | docs + version |

---

### Task 1: Client seam — types, interface, SDK impl, fake

Adds the four `AdoClient` methods end to end so every later task only touches its own domain folder. No unit tests exist for `SdkAdoClient` (it wraps the SDK 1:1); the deliverable is a clean `pnpm typecheck` and a green existing suite.

**Files:**
- Modify: `src/ado/types.ts`
- Modify: `src/ado/client.ts` (append after `updateReleaseDefinition`, ~line 341)
- Modify: `src/ado/sdkClient.ts` (append after `updateReleaseDefinition`, ~line 1126)
- Modify: `test/fakes/FakeAdoClient.ts` (append after the phase-4.2 release write state, ~line 1046)

**Interfaces:**
- Produces on `AdoClient`:
  ```ts
  createPipeline: (args: { project: string; name: string; folder: string; yamlPath: string; repositoryId: string; repositoryName: string }) => Promise<Pipeline>;
  deletePipelineDefinition: (args: { project: string; definitionId: number }) => Promise<void>;
  createReleaseDefinition: (args: { project: string; definition: ReleaseDefinition }) => Promise<ReleaseDefinition>;
  deleteReleaseDefinition: (args: { project: string; definitionId: number; comment?: string; forceDelete?: boolean }) => Promise<void>;
  ```
- Produces on `FakeAdoClient`:
  ```ts
  setNextCreatedPipeline(p: Pipeline): void;          getCreatedPipelines(): ReadonlyArray<CreatePipelineArgs>;
  getDeletedPipelines(): ReadonlyArray<{ project: string; definitionId: number }>;
  setNextCreatedReleaseDef(d: ReleaseDefinition): void; getCreatedReleaseDefs(): ReadonlyArray<{ project: string; definition: ReleaseDefinition }>;
  getDeletedReleaseDefs(): ReadonlyArray<{ project: string; definitionId: number; comment?: string; forceDelete?: boolean }>;
  ```

- [ ] **Step 1: Extend `src/ado/types.ts`**

Replace the Pipelines block with:

```ts
// Pipelines (YAML runs via PipelinesApi)
export type {
  CreatePipelineParameters,
  Pipeline,
  Run,
  RunPipelineParameters,
} from 'azure-devops-node-api/interfaces/PipelinesInterfaces.js';
// ConfigurationType is used as a *value* (type: ConfigurationType.Yaml).
export { ConfigurationType } from 'azure-devops-node-api/interfaces/PipelinesInterfaces.js';

/**
 * The SDK types `CreatePipelineConfigurationParameters` as `{ type? }` only, but the REST
 * endpoint requires `path` + `repository` for a YAML pipeline. This local widening is
 * structurally compatible with the SDK's parameter type (superset), so it can be passed
 * to `PipelinesApi.createPipeline` without a cast.
 */
export interface CreateYamlPipelineParameters {
  name: string;
  folder: string;
  configuration: {
    type: import('azure-devops-node-api/interfaces/PipelinesInterfaces.js').ConfigurationType;
    path: string;
    repository: { id: string; name: string; type: 'azureReposGit' };
  };
}
```

And in the Release block add `ReleaseDefinitionSource` as a value export after the type block:

```ts
// ReleaseDefinitionSource is used as a *value* (source = ReleaseDefinitionSource.RestApi).
export { ReleaseDefinitionSource } from 'azure-devops-node-api/interfaces/ReleaseInterfaces.js';
```

- [ ] **Step 2: Add the four methods to the `AdoClient` interface**

In `src/ado/client.ts`, add `Pipeline` to the type import from `./types.js`, then append after `updateReleaseDefinition`:

```ts
  // pipeline definition writes (Phase 6)
  /** Create a YAML pipeline pointing at `yamlPath` in the named Azure Repos git repo. */
  createPipeline: (args: {
    project: string;
    name: string;
    folder: string;
    yamlPath: string;
    repositoryId: string;
    repositoryName: string;
  }) => Promise<Pipeline>;

  /** Soft-delete a pipeline definition (recycle bin). */
  deletePipelineDefinition: (args: { project: string; definitionId: number }) => Promise<void>;

  // release definition writes (Phase 6)
  /** Create a release definition from a full document (caller strips server-owned fields). */
  createReleaseDefinition: (args: {
    project: string;
    definition: ReleaseDefinition;
  }) => Promise<ReleaseDefinition>;

  /** Soft-delete a release definition. `forceDelete` cancels in-flight deployments first. */
  deleteReleaseDefinition: (args: {
    project: string;
    definitionId: number;
    comment?: string;
    forceDelete?: boolean;
  }) => Promise<void>;
```

- [ ] **Step 3: Implement them in `SdkAdoClient`**

In `src/ado/sdkClient.ts`, add `CreateYamlPipelineParameters` and `Pipeline` to the type import from `./types.js`, and change the value import line to `import { ConfigurationType, WorkItemExpand } from './types.js';`. Append after `updateReleaseDefinition`:

```ts
  // -------- pipeline definition writes (Phase 6) --------

  async createPipeline(args: {
    project: string;
    name: string;
    folder: string;
    yamlPath: string;
    repositoryId: string;
    repositoryName: string;
  }): Promise<Pipeline> {
    try {
      const pipelines = await this.api.getPipelinesApi();
      const params: CreateYamlPipelineParameters = {
        name: args.name,
        folder: args.folder,
        configuration: {
          type: ConfigurationType.Yaml,
          path: args.yamlPath,
          repository: { id: args.repositoryId, name: args.repositoryName, type: 'azureReposGit' },
        },
      };
      return await pipelines.createPipeline(params, args.project);
    }
    catch (err) {
      if (err instanceof AdoError) {
        throw err;
      }
      throw mapSdkError(err);
    }
  }

  async deletePipelineDefinition(args: { project: string; definitionId: number }): Promise<void> {
    try {
      const build = await this.api.getBuildApi();
      await build.deleteDefinition(args.project, args.definitionId);
    }
    catch (err) {
      if (err instanceof AdoError) {
        throw err;
      }
      throw mapSdkError(err);
    }
  }

  // -------- release definition writes (Phase 6) --------

  async createReleaseDefinition(args: {
    project: string;
    definition: ReleaseDefinition;
  }): Promise<ReleaseDefinition> {
    try {
      const rel = await this.api.getReleaseApi();
      return await rel.createReleaseDefinition(args.definition, args.project);
    }
    catch (err) {
      if (err instanceof AdoError) {
        throw err;
      }
      throw mapSdkError(err);
    }
  }

  async deleteReleaseDefinition(args: {
    project: string;
    definitionId: number;
    comment?: string;
    forceDelete?: boolean;
  }): Promise<void> {
    try {
      const rel = await this.api.getReleaseApi();
      await rel.deleteReleaseDefinition(
        args.project,
        args.definitionId,
        args.comment,
        args.forceDelete ?? false,
      );
    }
    catch (err) {
      if (err instanceof AdoError) {
        throw err;
      }
      throw mapSdkError(err);
    }
  }
```

- [ ] **Step 4: Implement them in `FakeAdoClient`**

In `test/fakes/FakeAdoClient.ts`, add `Pipeline` to the type import from `../../src/ado/types.js`. Append after `getReleaseDefUpdates()`:

```ts
  // ---- phase-6 definition create/delete state ----
  private createdPipelines: Array<{
    project: string;
    name: string;
    folder: string;
    yamlPath: string;
    repositoryId: string;
    repositoryName: string;
  }> = [];

  private nextCreatedPipeline?: Pipeline;
  private deletedPipelines: Array<{ project: string; definitionId: number }> = [];
  private createdReleaseDefs: Array<{ project: string; definition: ReleaseDefinition }> = [];
  private nextCreatedReleaseDef?: ReleaseDefinition;
  private deletedReleaseDefs: Array<{
    project: string;
    definitionId: number;
    comment?: string;
    forceDelete?: boolean;
  }> = [];

  setNextCreatedPipeline(pipeline: Pipeline): void {
    this.nextCreatedPipeline = pipeline;
  }

  getCreatedPipelines() {
    return this.createdPipelines;
  }

  getDeletedPipelines() {
    return this.deletedPipelines;
  }

  setNextCreatedReleaseDef(def: ReleaseDefinition): void {
    this.nextCreatedReleaseDef = def;
  }

  getCreatedReleaseDefs() {
    return this.createdReleaseDefs;
  }

  getDeletedReleaseDefs() {
    return this.deletedReleaseDefs;
  }

  async createPipeline(args: {
    project: string;
    name: string;
    folder: string;
    yamlPath: string;
    repositoryId: string;
    repositoryName: string;
  }): Promise<Pipeline> {
    this.throwIfInjected('createPipeline');
    this.createdPipelines.push(args);
    return this.nextCreatedPipeline ?? { id: 1, name: args.name, folder: args.folder };
  }

  async deletePipelineDefinition(args: { project: string; definitionId: number }): Promise<void> {
    this.throwIfInjected('deletePipelineDefinition');
    this.deletedPipelines.push(args);
  }

  async createReleaseDefinition(args: {
    project: string;
    definition: ReleaseDefinition;
  }): Promise<ReleaseDefinition> {
    this.throwIfInjected('createReleaseDefinition');
    this.createdReleaseDefs.push(args);
    return this.nextCreatedReleaseDef ?? { ...args.definition, id: 1000 };
  }

  async deleteReleaseDefinition(args: {
    project: string;
    definitionId: number;
    comment?: string;
    forceDelete?: boolean;
  }): Promise<void> {
    this.throwIfInjected('deleteReleaseDefinition');
    this.deletedReleaseDefs.push(args);
  }
```

- [ ] **Step 5: Typecheck, test, lint**

Run: `pnpm typecheck && pnpm test && pnpm lint:fix`
Expected: typecheck clean, 199 tests pass, lint clean. If `pipelines.createPipeline(params, …)` fails typecheck because the SDK's `CreatePipelineConfigurationParameters` rejects the extra keys, the SDK type is not a plain open interface as the spec assumed — fall back to `params as unknown as CreatePipelineParameters` with a one-line comment pointing at the spec's "SDK type gap" paragraph, and note the deviation in the commit body.

- [ ] **Step 6: Commit**

```bash
git add src/ado/types.ts src/ado/client.ts src/ado/sdkClient.ts test/fakes/FakeAdoClient.ts
git commit -m "feat(ado): client seam for pipeline + release definition create/delete"
```

---

### Task 2: `create_pipeline`

**Files:**
- Modify: `src/domains/pipelines/schemas.ts` (append)
- Modify: `src/domains/pipelines/writeService.ts` (append method + result type)
- Modify: `src/domains/pipelines/writeTools.ts` (import + tool def)
- Test: `test/unit/domains/pipelines/writeService.test.ts` (append)

**Interfaces:**
- Consumes: `AdoClient.listRepositories({ project })`, `AdoClient.createPipeline(...)` from Task 1; `FakeAdoClient.setRepositories(project, repos)`, `setNextCreatedPipeline`, `getCreatedPipelines`.
- Produces: `PipelinesWriteService.createPipeline(args): Promise<CreatePipelineResult>` where
  ```ts
  export interface CreatePipelineResult { pipelineId: number; name: string; folder: string; url?: string; repository: string; yamlPath: string }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/domains/pipelines/writeService.test.ts`:

```ts
describe('pipelinesWriteService.createPipeline', () => {
  it('resolves the repository name to its id (case-insensitive) and posts a yaml configuration', async () => {
    const { svc, fake } = makeSvc();
    fake.setRepositories('Proj', [
      { id: 'aaaa-1111', name: 'Other' },
      { id: 'bbbb-2222', name: 'Web.Frontend' },
    ]);
    fake.setNextCreatedPipeline({ id: 77, name: 'web-ci', folder: '\\', url: 'https://x/pipelines/77' });
    const result = await svc.createPipeline({
      project: 'Proj',
      name: 'web-ci',
      repository: 'web.frontend',
      yamlPath: 'pipelines/ci.yml',
    });
    const call = fake.getCreatedPipelines()[0]!;
    expect(call.project).toBe('Proj');
    expect(call.repositoryId).toBe('bbbb-2222');
    expect(call.repositoryName).toBe('Web.Frontend');
    expect(call.yamlPath).toBe('/pipelines/ci.yml');
    expect(call.folder).toBe('\\');
    expect(result).toEqual({
      pipelineId: 77,
      name: 'web-ci',
      folder: '\\',
      url: 'https://x/pipelines/77',
      repository: 'Web.Frontend',
      yamlPath: '/pipelines/ci.yml',
    });
  });

  it('keeps an already-rooted yamlPath and passes an explicit folder through', async () => {
    const { svc, fake } = makeSvc();
    fake.setRepositories('Proj', [{ id: 'bbbb-2222', name: 'Web' }]);
    await svc.createPipeline({
      project: 'Proj',
      name: 'x',
      repository: 'Web',
      yamlPath: '/azure-pipelines.yml',
      folder: '\\Backend',
    });
    const call = fake.getCreatedPipelines()[0]!;
    expect(call.yamlPath).toBe('/azure-pipelines.yml');
    expect(call.folder).toBe('\\Backend');
  });

  it('throws AdoNotFoundError naming project + repo when the repository does not exist', async () => {
    const { svc, fake } = makeSvc();
    fake.setRepositories('Proj', [{ id: 'bbbb-2222', name: 'Web' }]);
    const input = { project: 'Proj', name: 'x', repository: 'Nope', yamlPath: 'a.yml' };
    await expect(svc.createPipeline(input)).rejects.toBeInstanceOf(AdoNotFoundError);
    await expect(svc.createPipeline(input)).rejects.toThrow(/Repository 'Nope' not found in project 'Proj'/);
    expect(fake.getCreatedPipelines()).toHaveLength(0);
  });

  it('propagates client errors unchanged', async () => {
    const { svc, fake } = makeSvc();
    fake.setRepositories('Proj', [{ id: 'bbbb-2222', name: 'Web' }]);
    fake.injectError('createPipeline', new Error('boom'));
    await expect(
      svc.createPipeline({ project: 'Proj', name: 'x', repository: 'Web', yamlPath: 'a.yml' }),
    ).rejects.toThrow('boom');
  });
});
```

Also add `AdoNotFoundError` to the existing import from `'../../../../src/ado/errors.js'` (the file already imports `AdoConflictError` from there).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/unit/domains/pipelines/writeService.test.ts`
Expected: FAIL — `svc.createPipeline is not a function`.

- [ ] **Step 3: Add the schema**

Append to `src/domains/pipelines/schemas.ts`:

```ts
export const CreatePipelineInput = {
  project: z.string().min(1).describe('ADO project name.'),
  name: z
    .string()
    .min(1)
    .describe('Pipeline name. Must be unique within the folder.'),
  repository: z
    .string()
    .min(1)
    .describe(
      'Azure Repos git repository NAME (not id) that contains the YAML file. Resolved to the '
      + 'repository id automatically (case-insensitive match).',
    ),
  yamlPath: z
    .string()
    .min(1)
    .describe(
      'Path of the pipeline YAML file inside the repository, e.g. \'azure-pipelines.yml\' or '
      + '\'pipelines/deploy.yml\'. A leading \'/\' is added if missing.',
    ),
  folder: z
    .string()
    .min(1)
    .optional()
    .describe('Pipeline folder, e.g. \'\\\\Backend\'. Defaults to the root folder \'\\\\\'.'),
};

export const DeletePipelineInput = {
  project: z.string().min(1).describe('ADO project name.'),
  pipelineId: z
    .number()
    .int()
    .positive()
    .describe('The pipeline (build definition) id. Use `list_pipelines` to discover ids.'),
};
```

- [ ] **Step 4: Implement the service method**

In `src/domains/pipelines/writeService.ts`, add `import { AdoNotFoundError } from '../../ado/errors.js';` at the top (after the type imports). Add the result type next to the others:

```ts
export interface CreatePipelineResult {
  pipelineId: number;
  name: string;
  folder: string;
  url?: string;
  repository: string;
  yamlPath: string;
}

export interface DeletePipelineResult {
  pipelineId: number;
  deleted: true;
}
```

Add a helper above the class:

```ts
const ROOT_FOLDER = '\\';

function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
```

Append inside the class:

```ts
  async createPipeline(args: {
    project: string;
    name: string;
    repository: string;
    yamlPath: string;
    folder?: string;
  }): Promise<CreatePipelineResult> {
    const repos = await this.client.listRepositories({ project: args.project });
    const repo = repos.find(r => r.name?.toLowerCase() === args.repository.toLowerCase());
    if (!repo?.id || !repo.name) {
      throw new AdoNotFoundError(
        `Repository '${args.repository}' not found in project '${args.project}'. `
        + `Use list_repositories to see available names.`,
      );
    }

    const folder = args.folder ?? ROOT_FOLDER;
    const yamlPath = ensureLeadingSlash(args.yamlPath);

    const created = await this.client.createPipeline({
      project: args.project,
      name: args.name,
      folder,
      yamlPath,
      repositoryId: repo.id,
      repositoryName: repo.name,
    });

    return {
      pipelineId: created.id ?? 0,
      name: created.name ?? args.name,
      folder: created.folder ?? folder,
      url: created.url,
      repository: repo.name,
      yamlPath,
    };
  }
```

`AdoNotFoundError(detail)` produces `The requested Azure DevOps resource was not found. Details: <detail>` (see `src/ado/errors.ts:21`), so the detail text is in the message verbatim and the test regex matches.

- [ ] **Step 5: Register the tool**

In `src/domains/pipelines/writeTools.ts`, add `CreatePipelineInput` and `DeletePipelineInput` to the schema import, and append to the returned array (before the closing `];`):

```ts
    {
      name: 'create_pipeline',
      config: {
        title: 'Create a YAML pipeline',
        description:
          'Creates a new pipeline definition that runs the YAML file at `yamlPath` in the named '
          + 'Azure Repos repository. Creating a pipeline runs nothing and is reversible with '
          + '`delete_pipeline`. ADO does not verify that the YAML file exists at creation time — '
          + 'the first run fails instead, so chain `queue_pipeline_run` to validate. Returns the new '
          + 'pipeline id and URL.',
        inputSchema: CreatePipelineInput,
      },
      handler: async args =>
        svc.createPipeline(args as Parameters<typeof svc.createPipeline>[0]),
    },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- test/unit/domains/pipelines/writeService.test.ts`
Expected: PASS (4 new tests).

- [ ] **Step 7: Lint, typecheck, commit**

Run: `pnpm lint:fix && pnpm typecheck && pnpm test`
Expected: all clean.

```bash
git add src/domains/pipelines test/unit/domains/pipelines/writeService.test.ts
git commit -m "feat(pipelines): create_pipeline tool (YAML, azureReposGit)"
```

---

### Task 3: `delete_pipeline`

**Files:**
- Modify: `src/domains/pipelines/writeService.ts` (append method; `DeletePipelineResult` already added in Task 2)
- Modify: `src/domains/pipelines/writeTools.ts` (tool def; `DeletePipelineInput` already imported in Task 2)
- Test: `test/unit/domains/pipelines/writeService.test.ts` (append)

**Interfaces:**
- Consumes: `AdoClient.deletePipelineDefinition({ project, definitionId })`, `FakeAdoClient.getDeletedPipelines()`.
- Produces: `PipelinesWriteService.deletePipeline({ project, pipelineId }): Promise<DeletePipelineResult>`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('pipelinesWriteService.deletePipeline', () => {
  it('forwards project + pipelineId and reports deleted: true', async () => {
    const { svc, fake } = makeSvc();
    const result = await svc.deletePipeline({ project: 'Proj', pipelineId: 12 });
    expect(fake.getDeletedPipelines()).toEqual([{ project: 'Proj', definitionId: 12 }]);
    expect(result).toEqual({ pipelineId: 12, deleted: true });
  });

  it('propagates client errors unchanged', async () => {
    const { svc, fake } = makeSvc();
    fake.injectError('deletePipelineDefinition', new Error('boom'));
    await expect(svc.deletePipeline({ project: 'Proj', pipelineId: 12 })).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/unit/domains/pipelines/writeService.test.ts`
Expected: FAIL — `svc.deletePipeline is not a function`.

- [ ] **Step 3: Implement**

Append inside `PipelinesWriteService`:

```ts
  async deletePipeline(args: { project: string; pipelineId: number }): Promise<DeletePipelineResult> {
    await this.client.deletePipelineDefinition({
      project: args.project,
      definitionId: args.pipelineId,
    });
    return { pipelineId: args.pipelineId, deleted: true };
  }
```

Append the tool def in `writeTools.ts`:

```ts
    {
      name: 'delete_pipeline',
      config: {
        title: 'Delete a pipeline definition',
        description:
          '**Always confirm with the user before calling — this removes the pipeline and its run '
          + 'history from the project.** ADO moves it to the recycle bin, from which it can be '
          + 'restored in the web UI for 30 days. Use `list_pipelines` to find the id.',
        inputSchema: DeletePipelineInput,
      },
      handler: async args =>
        svc.deletePipeline(args as Parameters<typeof svc.deletePipeline>[0]),
    },
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test -- test/unit/domains/pipelines/writeService.test.ts && pnpm lint:fix && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/domains/pipelines test/unit/domains/pipelines/writeService.test.ts
git commit -m "feat(pipelines): delete_pipeline tool"
```

---

### Task 4: `stripForClone` — pure clone-strip rules

The load-bearing correctness piece. One test per rule from the spec's "Clone-strip rules" section.

**Files:**
- Create: `src/domains/releases/cloneDefinition.ts`
- Test: `test/unit/domains/releases/cloneDefinition.test.ts` (new)

**Interfaces:**
- Consumes: `ReleaseDefinition`, `ReleaseDefinitionEnvironment` types and `ReleaseDefinitionSource` value from `src/ado/types.ts`.
- Produces: `export function stripForClone(def: ReleaseDefinition): ReleaseDefinition` — returns a **new** object; never mutates its input.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/domains/releases/cloneDefinition.test.ts`:

```ts
import type { ReleaseDefinition } from '../../../../src/ado/types.js';
import { describe, expect, it } from 'vitest';
import { ReleaseDefinitionSource } from '../../../../src/ado/types.js';
import { stripForClone } from '../../../../src/domains/releases/cloneDefinition.js';

// A definition with every server-owned field populated, so each strip rule has something
// to remove. Deploy phases / tasks / queue ids are the "must survive" payload.
function fixture(): ReleaseDefinition {
  return {
    id: 42,
    revision: 7,
    name: 'Web - Prod',
    path: '\\Web',
    url: 'https://vsrm/x/definitions/42',
    _links: { self: { href: 'https://vsrm/x/definitions/42' } },
    createdBy: { id: 'u1', displayName: 'Someone' },
    createdOn: new Date('2026-01-01T00:00:00Z'),
    modifiedBy: { id: 'u2', displayName: 'Else' },
    modifiedOn: new Date('2026-02-01T00:00:00Z'),
    lastRelease: { id: 900, name: 'Release-900' },
    isDeleted: false,
    comment: 'last edit',
    source: ReleaseDefinitionSource.UserInterface,
    releaseNameFormat: 'Release-$(rev:r)',
    tags: ['web'],
    properties: {},
    variables: { ENV: { value: 'prod' }, KEY: { value: null as unknown as string, isSecret: true } },
    variableGroups: [3],
    triggers: [{ triggerType: 1, artifactAlias: '_web-ci' } as never],
    artifacts: [
      {
        alias: '_web-ci',
        type: 'Build',
        isPrimary: true,
        definitionReference: {
          definition: { id: '15', name: 'web-ci' },
          project: { id: 'p-guid', name: 'Proj' },
        },
      },
    ],
    environments: [
      {
        id: 101,
        name: 'Staging',
        rank: 1,
        owner: { id: 'u1', displayName: 'Someone' },
        badgeUrl: 'https://vsrm/badge/101',
        currentRelease: { id: 900 },
        deployStep: { id: 555, tasks: [] },
        preDeployApprovals: {
          approvals: [{ id: 201, rank: 1, isAutomated: true }],
          approvalOptions: { requiredApproverCount: 0 },
        },
        postDeployApprovals: {
          approvals: [{ id: 202, rank: 1, isAutomated: false, approver: { id: 'u3' } }],
        },
        preDeploymentGates: { id: 301, gates: [] },
        postDeploymentGates: { id: 302, gates: [] },
        environmentTriggers: [
          { definitionEnvironmentId: 101, releaseDefinitionId: 42, triggerType: 1, triggerContent: '{}' },
        ],
        conditions: [{ name: 'ReleaseStarted', conditionType: 1, value: '' }],
        deployPhases: [
          {
            rank: 1,
            phaseType: 1,
            name: 'Run on agent',
            deploymentInput: { queueId: 15, condition: 'succeeded()' },
            workflowTasks: [
              { taskId: 't-guid', version: '1.*', name: 'Deploy', enabled: true, inputs: { a: 'b' } },
            ],
          } as never,
        ],
        retentionPolicy: { daysToKeep: 30, releasesToKeep: 3, retainBuild: true },
        executionPolicy: { concurrencyCount: 1, queueDepthCount: 0 },
        environmentOptions: { emailNotificationType: 'OnlyOnFailure' } as never,
        demands: [],
        schedules: [],
        properties: {},
        variables: { REGION: { value: 'eu' } },
        variableGroups: [4],
      },
      {
        id: 102,
        name: 'Production',
        rank: 2,
        owner: { id: 'u1' },
        preDeployApprovals: { approvals: [{ id: 203, rank: 1, isAutomated: false, approver: { id: 'u3' } }] },
        postDeployApprovals: { approvals: [{ id: 204, rank: 1, isAutomated: true }] },
        conditions: [{ name: 'Staging', conditionType: 2, value: '4' }],
        deployPhases: [],
        environmentTriggers: [],
      },
    ],
  } as unknown as ReleaseDefinition;
}

describe('stripForClone — top level', () => {
  it('removes id, revision, url, _links, audit fields, lastRelease, isDeleted, comment', () => {
    const out = stripForClone(fixture()) as Record<string, unknown>;
    for (const key of ['id', 'revision', 'url', '_links', 'createdBy', 'createdOn', 'modifiedBy', 'modifiedOn', 'lastRelease', 'isDeleted', 'comment']) {
      expect(out, key).not.toHaveProperty(key);
    }
  });

  it('sets source to RestApi', () => {
    expect(stripForClone(fixture()).source).toBe(ReleaseDefinitionSource.RestApi);
  });

  it('keeps name, path, triggers, artifacts, variables, variableGroups, releaseNameFormat, tags, properties byte-for-byte', () => {
    const input = fixture();
    const out = stripForClone(input);
    expect(out.name).toBe(input.name);
    expect(out.path).toBe(input.path);
    expect(out.triggers).toEqual(input.triggers);
    expect(out.artifacts).toEqual(input.artifacts);
    expect(out.variables).toEqual(input.variables);
    expect(out.variableGroups).toEqual(input.variableGroups);
    expect(out.releaseNameFormat).toBe(input.releaseNameFormat);
    expect(out.tags).toEqual(input.tags);
    expect(out.properties).toEqual(input.properties);
  });

  it('does not mutate its input', () => {
    const input = fixture();
    const snapshot = JSON.stringify(input);
    stripForClone(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('stripForClone — per environment', () => {
  it('sets environment id to 0', () => {
    const envs = stripForClone(fixture()).environments ?? [];
    expect(envs.map(e => e.id)).toEqual([0, 0]);
  });

  it('sets every approval id and gate-step id to 0', () => {
    const [staging] = stripForClone(fixture()).environments ?? [];
    expect(staging?.preDeployApprovals?.approvals?.map(a => a.id)).toEqual([0]);
    expect(staging?.postDeployApprovals?.approvals?.map(a => a.id)).toEqual([0]);
    expect(staging?.preDeploymentGates?.id).toBe(0);
    expect(staging?.postDeploymentGates?.id).toBe(0);
  });

  it('removes badgeUrl, currentRelease, deployStep', () => {
    const [staging] = stripForClone(fixture()).environments ?? [];
    const env = staging as Record<string, unknown>;
    expect(env).not.toHaveProperty('badgeUrl');
    expect(env).not.toHaveProperty('currentRelease');
    expect(env).not.toHaveProperty('deployStep');
  });

  it('empties environmentTriggers', () => {
    const envs = stripForClone(fixture()).environments ?? [];
    expect(envs.map(e => e.environmentTriggers)).toEqual([[], []]);
  });

  it('keeps rank, owner, name, variables, variableGroups, conditions, policies, options, demands, schedules, properties', () => {
    const [inStaging] = fixture().environments ?? [];
    const [outStaging] = stripForClone(fixture()).environments ?? [];
    for (const key of ['rank', 'owner', 'name', 'variables', 'variableGroups', 'conditions', 'retentionPolicy', 'executionPolicy', 'environmentOptions', 'demands', 'schedules', 'properties'] as const) {
      expect(outStaging?.[key], key).toEqual(inStaging?.[key]);
    }
  });

  it('keeps deployPhases including queueId and workflowTasks byte-for-byte', () => {
    const [inStaging] = fixture().environments ?? [];
    const [outStaging] = stripForClone(fixture()).environments ?? [];
    expect(outStaging?.deployPhases).toEqual(inStaging?.deployPhases);
  });

  it('keeps approval options and approver identities while zeroing ids', () => {
    const [staging] = stripForClone(fixture()).environments ?? [];
    expect(staging?.preDeployApprovals?.approvalOptions).toEqual({ requiredApproverCount: 0 });
    expect(staging?.postDeployApprovals?.approvals?.[0]?.approver).toEqual({ id: 'u3' });
  });

  it('tolerates environments with missing optional blocks', () => {
    const def = { name: 'x', environments: [{ id: 5, name: 'Only' }] } as unknown as ReleaseDefinition;
    const out = stripForClone(def);
    expect(out.environments?.[0]).toEqual({ id: 0, name: 'Only', environmentTriggers: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/unit/domains/releases/cloneDefinition.test.ts`
Expected: FAIL — cannot find module `cloneDefinition.js`.

- [ ] **Step 3: Implement `stripForClone`**

Create `src/domains/releases/cloneDefinition.ts`:

```ts
import type { ReleaseDefinition, ReleaseDefinitionEnvironment } from '../../ado/types.js';
import { ReleaseDefinitionSource } from '../../ado/types.js';

/**
 * Prepare a fetched release definition for POST as a *new* definition.
 *
 * Rules (see spec §"Clone-strip rules"): server-owned identity/audit fields are removed at
 * the top level; every environment/approval/gate id is reset to 0 (matching the REST 7.1
 * "Definitions - Create" sample); `deployStep`, `badgeUrl`, `currentRelease` are dropped;
 * `environmentTriggers` are emptied because they reference the *source* definition's
 * environment ids. Everything else — deploy phases, tasks, queue ids, approvals, conditions,
 * artifacts, triggers, variables — is preserved verbatim. Returns a new object; the input is
 * not mutated.
 */
export function stripForClone(def: ReleaseDefinition): ReleaseDefinition {
  // Structured clone keeps Dates/nested objects intact and guarantees no aliasing with input.
  const copy = structuredClone(def) as ReleaseDefinition & Record<string, unknown>;

  delete copy.id;
  delete copy.revision;
  delete copy.url;
  delete copy._links;
  delete copy.createdBy;
  delete copy.createdOn;
  delete copy.modifiedBy;
  delete copy.modifiedOn;
  delete copy.lastRelease;
  delete copy.isDeleted;
  delete copy.comment;
  copy.source = ReleaseDefinitionSource.RestApi;

  copy.environments = (copy.environments ?? []).map(stripEnvironment);
  return copy;
}

function stripEnvironment(env: ReleaseDefinitionEnvironment): ReleaseDefinitionEnvironment {
  const out = { ...env } as ReleaseDefinitionEnvironment & Record<string, unknown>;

  out.id = 0;
  delete out.badgeUrl;
  delete out.currentRelease;
  delete out.deployStep;
  out.environmentTriggers = [];

  if (out.preDeployApprovals?.approvals) {
    out.preDeployApprovals = {
      ...out.preDeployApprovals,
      approvals: out.preDeployApprovals.approvals.map(a => ({ ...a, id: 0 })),
    };
  }
  if (out.postDeployApprovals?.approvals) {
    out.postDeployApprovals = {
      ...out.postDeployApprovals,
      approvals: out.postDeployApprovals.approvals.map(a => ({ ...a, id: 0 })),
    };
  }
  if (out.preDeploymentGates) {
    out.preDeploymentGates = { ...out.preDeploymentGates, id: 0 };
  }
  if (out.postDeploymentGates) {
    out.postDeploymentGates = { ...out.postDeploymentGates, id: 0 };
  }

  return out;
}
```

If `delete copy.id` is rejected by the lint config (`@typescript-eslint/no-dynamic-delete` only fires on computed keys, so plain `delete obj.prop` should pass) or by TS because the property is not optional, keep the `& Record<string, unknown>` intersection — that is what makes the `delete` legal. `structuredClone` is global on Node ≥17, so it is available on the Node ≥20 floor.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/unit/domains/releases/cloneDefinition.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Lint, typecheck, commit**

Run: `pnpm lint:fix && pnpm typecheck`

```bash
git add src/domains/releases/cloneDefinition.ts test/unit/domains/releases/cloneDefinition.test.ts
git commit -m "feat(releases): stripForClone — release definition clone rules"
```

---

### Task 5: `create_release_definition`

**Files:**
- Modify: `src/domains/releases/schemas.ts` (append)
- Modify: `src/domains/releases/writeService.ts` (import, result type, method)
- Modify: `src/domains/releases/writeTools.ts` (import + tool def)
- Test: `test/unit/domains/releases/writeService.test.ts` (append)

**Interfaces:**
- Consumes: `stripForClone` (Task 4); `AdoClient.getReleaseDefinition`, `getPipelineDefinition`, `createReleaseDefinition` (Task 1); `mergeReleaseVariables` + `ReleaseVariableInput` already in `writeService.ts`; fake `setReleaseDefinition`, `setPipelineDefinition`, `setNextCreatedReleaseDef`, `getCreatedReleaseDefs`.
- Produces: `ReleasesWriteService.createDefinition(args): Promise<CreateReleaseDefinitionResult>` where
  ```ts
  export interface CreateReleaseDefinitionResult {
    definitionId: number; name: string; path?: string; url?: string;
    environments: string[];
    artifacts: Array<{ alias: string; sourcePipeline?: string }>;
  }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/domains/releases/writeService.test.ts` (the file already imports `ReleaseDefinition`; add `BuildDefinition` to the same type import and `ReleaseDefinitionSource` as a value import from `'../../../../src/ado/types.js'`):

```ts
function sourceDefinition(): ReleaseDefinition {
  return {
    id: 42,
    revision: 3,
    name: 'Web - Prod',
    path: '\\Web',
    url: 'https://vsrm/x/definitions/42',
    variables: { ENV: { value: 'prod' }, KEY: { value: null as unknown as string, isSecret: true } },
    artifacts: [
      {
        alias: '_web-ci',
        type: 'Build',
        definitionReference: {
          definition: { id: '15', name: 'web-ci' },
          project: { id: 'p-guid', name: 'p' },
        },
      },
      {
        alias: '_assets',
        type: 'Build',
        definitionReference: {
          definition: { id: '16', name: 'assets-ci' },
          project: { id: 'p-guid', name: 'p' },
        },
      },
    ],
    environments: [
      { id: 101, name: 'Staging', rank: 1, deployStep: { id: 5 }, environmentTriggers: [{ definitionEnvironmentId: 101 }] },
      { id: 102, name: 'Production', rank: 2 },
    ],
  } as unknown as ReleaseDefinition;
}

describe('releasesWriteService.createDefinition', () => {
  it('clones the source under the new name with stripped ids and posts it', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 42, sourceDefinition());
    fake.setNextCreatedReleaseDef({
      id: 57,
      name: 'Web - Prod (copy)',
      path: '\\Web',
      url: 'https://vsrm/x/definitions/57',
      environments: [{ id: 1, name: 'Staging' }, { id: 2, name: 'Production' }],
      artifacts: [{ alias: '_web-ci', definitionReference: { definition: { id: '15', name: 'web-ci' } } }, { alias: '_assets', definitionReference: { definition: { id: '16', name: 'assets-ci' } } }],
    } as unknown as ReleaseDefinition);

    const result = await svc.createDefinition({
      project: 'p',
      cloneFromDefinitionId: 42,
      name: 'Web - Prod (copy)',
    });

    const posted = fake.getCreatedReleaseDefs()[0]!;
    expect(posted.project).toBe('p');
    expect(posted.definition.name).toBe('Web - Prod (copy)');
    expect(posted.definition.path).toBe('\\Web');
    expect(posted.definition).not.toHaveProperty('id');
    expect(posted.definition).not.toHaveProperty('revision');
    expect(posted.definition.source).toBe(ReleaseDefinitionSource.RestApi);
    expect(posted.definition.environments?.map(e => e.id)).toEqual([0, 0]);
    expect(posted.definition.environments?.[0]).not.toHaveProperty('deployStep');
    expect(posted.definition.environments?.[0]?.environmentTriggers).toEqual([]);
    // Untouched artifacts survive.
    expect(posted.definition.artifacts?.[1]?.definitionReference?.definition).toEqual({ id: '16', name: 'assets-ci' });

    expect(result).toEqual({
      definitionId: 57,
      name: 'Web - Prod (copy)',
      path: '\\Web',
      url: 'https://vsrm/x/definitions/57',
      environments: ['Staging', 'Production'],
      artifacts: [
        { alias: '_web-ci', sourcePipeline: 'web-ci' },
        { alias: '_assets', sourcePipeline: 'assets-ci' },
      ],
    });
  });

  it('applies description and path overrides', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 42, sourceDefinition());
    await svc.createDefinition({
      project: 'p',
      cloneFromDefinitionId: 42,
      name: 'X',
      description: 'cloned by test',
      path: '\\Experiments',
    });
    const posted = fake.getCreatedReleaseDefs()[0]!.definition;
    expect(posted.description).toBe('cloned by test');
    expect(posted.path).toBe('\\Experiments');
  });

  it('rebinds only the named artifact alias to another build definition, resolving its name', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 42, sourceDefinition());
    fake.setPipelineDefinition('p', 99, { id: 99, name: 'web-ci-v2' } as BuildDefinition);
    await svc.createDefinition({
      project: 'p',
      cloneFromDefinitionId: 42,
      name: 'X',
      artifactSources: [{ alias: '_web-ci', buildDefinitionId: 99 }],
    });
    const artifacts = fake.getCreatedReleaseDefs()[0]!.definition.artifacts ?? [];
    expect(artifacts[0]?.definitionReference?.definition).toEqual({ id: '99', name: 'web-ci-v2' });
    expect(artifacts[0]?.definitionReference?.project).toEqual({ id: 'p-guid', name: 'p' });
    expect(artifacts[0]?.type).toBe('Build');
    expect(artifacts[1]?.definitionReference?.definition).toEqual({ id: '16', name: 'assets-ci' });
  });

  it('rejects an unknown artifact alias and lists the valid ones without posting', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 42, sourceDefinition());
    await expect(
      svc.createDefinition({
        project: 'p',
        cloneFromDefinitionId: 42,
        name: 'X',
        artifactSources: [{ alias: '_nope', buildDefinitionId: 99 }],
      }),
    ).rejects.toThrow(/Artifact alias '_nope' not found on release definition 42\. Available: _web-ci, _assets/);
    expect(fake.getCreatedReleaseDefs()).toHaveLength(0);
  });

  it('merges variables over the clone and preserves an untouched secret', async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition('p', 42, sourceDefinition());
    await svc.createDefinition({
      project: 'p',
      cloneFromDefinitionId: 42,
      name: 'X',
      variables: { ENV: { value: 'staging' }, NEW: { value: '1' } },
    });
    const vars = fake.getCreatedReleaseDefs()[0]!.definition.variables ?? {};
    expect(vars.ENV).toEqual({ value: 'staging', isSecret: false, allowOverride: undefined });
    expect(vars.NEW).toEqual({ value: '1', isSecret: false, allowOverride: undefined });
    expect(vars.KEY).toEqual({ value: null, isSecret: true });
  });

  it('propagates a missing source definition', async () => {
    const { svc, fake } = makeSvc();
    fake.injectError('getReleaseDefinition', new Error('not found'));
    await expect(
      svc.createDefinition({ project: 'p', cloneFromDefinitionId: 1, name: 'X' }),
    ).rejects.toThrow('not found');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/unit/domains/releases/writeService.test.ts`
Expected: FAIL — `svc.createDefinition is not a function`.

- [ ] **Step 3: Add the schemas**

Append to `src/domains/releases/schemas.ts`:

```ts
export const CreateReleaseDefinitionInput = {
  project: z.string().min(1).describe('ADO project name.'),
  cloneFromDefinitionId: z
    .number()
    .int()
    .positive()
    .describe(
      'Existing release definition to clone. Its stages, deploy tasks, approvals, and triggers '
      + 'are copied. Use `list_release_definitions` to find the id.',
    ),
  name: z.string().min(1).describe('Name for the new release definition. Must be unique in the project.'),
  description: z.string().optional(),
  path: z
    .string()
    .min(1)
    .optional()
    .describe('Folder for the new definition, e.g. \'\\\\Web\'. Defaults to the source definition\'s folder.'),
  artifactSources: z
    .array(
      z.object({
        alias: z
          .string()
          .min(1)
          .describe('An artifact alias that exists on the source definition (e.g. \'_web-ci\').'),
        buildDefinitionId: z
          .number()
          .int()
          .positive()
          .describe('Build pipeline (definition) id to bind this alias to. Use `list_pipelines`.'),
      }),
    )
    .optional()
    .describe(
      'Rebind existing artifact aliases to different build pipelines. Aliases not listed keep '
      + 'their source binding. Adding or removing aliases is not supported.',
    ),
  variables: z
    .record(z.string().min(1), VariableSetEntry)
    .optional()
    .describe(
      'Definition-level variables to set on the clone, merged over the copied variables. '
      + 'Copied secrets are preserved unless explicitly overridden.',
    ),
};

export const DeleteReleaseDefinitionInput = {
  project: z.string().min(1).describe('ADO project name.'),
  definitionId: z
    .number()
    .int()
    .positive()
    .describe('The release definition id. Use `list_release_definitions` to discover ids.'),
  comment: z.string().optional().describe('Optional comment recorded with the deletion.'),
  forceDelete: z
    .boolean()
    .optional()
    .describe(
      'When false (default), ADO refuses to delete while a deployment from this definition is in '
      + 'progress. Set true to cancel in-flight deployments and delete anyway.',
    ),
};
```

`VariableSetEntry` is already declared in this file (above `UpdateReleaseVariablesInput`); the new schema must be placed **after** that declaration.

- [ ] **Step 4: Implement the service method**

In `src/domains/releases/writeService.ts`:

Add imports at the top:

```ts
import type { Artifact } from '../../ado/types.js';
import { stripForClone } from './cloneDefinition.js';
```

Add result types next to the others:

```ts
export interface CreateReleaseDefinitionResult {
  definitionId: number;
  name: string;
  path?: string;
  url?: string;
  environments: string[];
  artifacts: Array<{ alias: string; sourcePipeline?: string }>;
}

export interface DeleteReleaseDefinitionResult {
  definitionId: number;
  deleted: true;
}
```

Add a helper above the class (next to `findDefinitionEnvironment`):

```ts
function findArtifactByAlias(
  artifacts: Artifact[],
  alias: string,
  definitionId: number,
): Artifact {
  const target = artifacts.find(a => a.alias === alias);
  if (!target) {
    const available = artifacts.map(a => a.alias).filter(Boolean).join(', ');
    throw new Error(
      `Artifact alias '${alias}' not found on release definition ${definitionId}. `
      + `Available: ${available || '(none)'}`,
    );
  }
  return target;
}
```

Append inside `ReleasesWriteService`:

```ts
  async createDefinition(args: {
    project: string;
    cloneFromDefinitionId: number;
    name: string;
    description?: string;
    path?: string;
    artifactSources?: { alias: string; buildDefinitionId: number }[];
    variables?: Record<string, ReleaseVariableInput>;
  }): Promise<CreateReleaseDefinitionResult> {
    const source = await this.client.getReleaseDefinition({
      project: args.project,
      definitionId: args.cloneFromDefinitionId,
    });

    const clone = stripForClone(source);
    clone.name = args.name;
    if (args.description !== undefined) {
      clone.description = args.description;
    }
    if (args.path !== undefined) {
      clone.path = args.path;
    }

    // Rebind named aliases only. Validate every alias before touching anything so an
    // unknown alias fails fast without a partial rewrite.
    const artifacts = clone.artifacts ?? [];
    for (const override of args.artifactSources ?? []) {
      findArtifactByAlias(artifacts, override.alias, args.cloneFromDefinitionId);
    }
    for (const override of args.artifactSources ?? []) {
      const artifact = findArtifactByAlias(artifacts, override.alias, args.cloneFromDefinitionId);
      const buildDef = await this.client.getPipelineDefinition({
        project: args.project,
        definitionId: override.buildDefinitionId,
      });
      artifact.definitionReference = {
        ...(artifact.definitionReference ?? {}),
        definition: {
          id: String(override.buildDefinitionId),
          name: buildDef.name ?? String(override.buildDefinitionId),
        },
      };
    }

    if (args.variables) {
      clone.variables = mergeReleaseVariables(clone.variables, args.variables, undefined);
    }

    const created = await this.client.createReleaseDefinition({
      project: args.project,
      definition: clone,
    });

    return {
      definitionId: created.id ?? 0,
      name: created.name ?? args.name,
      path: created.path,
      url: created.url,
      environments: (created.environments ?? [])
        .map(env => env.name)
        .filter((name): name is string => !!name),
      artifacts: (created.artifacts ?? []).map(a => ({
        alias: a.alias ?? '',
        sourcePipeline: a.definitionReference?.definition?.name,
      })),
    };
  }
```

Note on the variables test expectation: `mergeReleaseVariable` returns `{ value, isSecret, allowOverride }` with `allowOverride` possibly `undefined`; `toEqual` treats an explicit `undefined` property as equal to a missing one, so the test passes either way.

- [ ] **Step 5: Register the tool**

In `src/domains/releases/writeTools.ts`, add `CreateReleaseDefinitionInput` and `DeleteReleaseDefinitionInput` to the schema import and append to the array:

```ts
    {
      name: 'create_release_definition',
      config: {
        title: 'Create a release definition by cloning an existing one',
        description:
          '**Always confirm with the user before calling — this creates a new release pipeline '
          + 'visible to the whole project.** Copies the stages, deploy tasks, approvals, variables, '
          + 'and triggers of `cloneFromDefinitionId` under a new `name`. Optional `path` (folder), '
          + '`description`, `variables`, and `artifactSources` (rebind an existing artifact alias to '
          + 'another build pipeline) customise the copy. Creation deploys nothing; use '
          + '`create_release` afterwards. Returns the new definition id, its stage names, and its '
          + 'artifact bindings.',
        inputSchema: CreateReleaseDefinitionInput,
      },
      handler: async args =>
        svc.createDefinition(args as Parameters<typeof svc.createDefinition>[0]),
    },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- test/unit/domains/releases/writeService.test.ts`
Expected: PASS (6 new tests).

- [ ] **Step 7: Lint, typecheck, commit**

Run: `pnpm lint:fix && pnpm typecheck && pnpm test`

```bash
git add src/domains/releases test/unit/domains/releases/writeService.test.ts
git commit -m "feat(releases): create_release_definition tool (clone mode)"
```

---

### Task 6: `delete_release_definition` + Release manage scope

**Files:**
- Modify: `src/domains/releases/writeService.ts` (method)
- Modify: `src/domains/releases/writeTools.ts` (tool def)
- Modify: `src/ado/errors.ts` (auth hint copy ~line 12–13; `detectMissingScope` ~line 104)
- Modify: `src/setup.ts` (~line 15)
- Modify: `README.md` (scopes table ~line 37)
- Test: `test/unit/domains/releases/writeService.test.ts`, `test/unit/ado/errors.test.ts`

**Interfaces:**
- Consumes: `AdoClient.deleteReleaseDefinition`, fake `getDeletedReleaseDefs()`.
- Produces: `ReleasesWriteService.deleteDefinition({ project, definitionId, comment?, forceDelete? }): Promise<DeleteReleaseDefinitionResult>`.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/domains/releases/writeService.test.ts`:

```ts
describe('releasesWriteService.deleteDefinition', () => {
  it('forwards ids, comment and forceDelete and reports deleted: true', async () => {
    const { svc, fake } = makeSvc();
    const result = await svc.deleteDefinition({
      project: 'p',
      definitionId: 42,
      comment: 'obsolete',
      forceDelete: true,
    });
    expect(fake.getDeletedReleaseDefs()).toEqual([
      { project: 'p', definitionId: 42, comment: 'obsolete', forceDelete: true },
    ]);
    expect(result).toEqual({ definitionId: 42, deleted: true });
  });

  it('defaults forceDelete to false', async () => {
    const { svc, fake } = makeSvc();
    await svc.deleteDefinition({ project: 'p', definitionId: 42 });
    expect(fake.getDeletedReleaseDefs()[0]?.forceDelete).toBe(false);
  });

  it('propagates client errors unchanged', async () => {
    const { svc, fake } = makeSvc();
    fake.injectError('deleteReleaseDefinition', new Error('boom'));
    await expect(svc.deleteDefinition({ project: 'p', definitionId: 42 })).rejects.toThrow('boom');
  });
});
```

Append to `test/unit/ado/errors.test.ts` inside the existing `describe('mapSdkError — scope hint branch', …)` block:

```ts
  it('403 with body mentioning vso.release_manage → AdoScopeError naming the manage tier', () => {
    const err = Object.assign(new Error('The token lacks scope vso.release_manage'), {
      statusCode: 403,
    });
    const mapped = mapSdkError(err);
    expect(mapped).toBeInstanceOf(AdoScopeError);
    expect((mapped as AdoScopeError).scope).toBe('Release (read, write, execute, & manage)');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/unit/domains/releases/writeService.test.ts test/unit/ado/errors.test.ts`
Expected: FAIL — `svc.deleteDefinition is not a function`; scope test gets `'Release (read, write, & execute)'` instead of the manage tier.

- [ ] **Step 3: Implement the service method and tool**

Append inside `ReleasesWriteService`:

```ts
  async deleteDefinition(args: {
    project: string;
    definitionId: number;
    comment?: string;
    forceDelete?: boolean;
  }): Promise<DeleteReleaseDefinitionResult> {
    await this.client.deleteReleaseDefinition({
      project: args.project,
      definitionId: args.definitionId,
      comment: args.comment,
      forceDelete: args.forceDelete ?? false,
    });
    return { definitionId: args.definitionId, deleted: true };
  }
```

Append the tool def in `writeTools.ts`:

```ts
    {
      name: 'delete_release_definition',
      config: {
        title: 'Delete a release definition',
        description:
          '**Always confirm with the user before calling — this removes the release pipeline and '
          + 'all its releases from the project.** ADO soft-deletes it (restorable from the web UI). '
          + 'Refuses with an error while a deployment from this definition is in progress unless '
          + '`forceDelete` is true, which cancels in-flight deployments first. Requires the Release '
          + '"manage" PAT scope.',
        inputSchema: DeleteReleaseDefinitionInput,
      },
      handler: async args =>
        svc.deleteDefinition(args as Parameters<typeof svc.deleteDefinition>[0]),
    },
```

- [ ] **Step 4: Update the scope text in three places plus the scope detector**

`src/ado/errors.ts`:
- In `AdoAuthError`'s message, replace `Release (read, write, & execute)` with `Release (read, write, execute, & manage)`.
- In `detectMissingScope`, add **before** the `vso.release_execute` check (so the more specific token wins):
  ```ts
  if (message.includes('vso.release_manage')) {
    return 'Release (read, write, execute, & manage)';
  }
  ```

`src/setup.ts` line 15: replace `Release (read, write, & execute)` with `Release (read, write, execute, & manage)`.

`README.md` scopes table, Full row: replace `**Release (read, write, & execute)**` with `**Release (read, write, execute, & manage)**`. Directly under the table, add one sentence:

> The "manage" tier of Release is needed only by `delete_release_definition`; every other release tool works with "read, write, & execute".

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS. Also confirm no other test asserted the old scope string: `grep -rn "read, write, & execute" test/` should return nothing; if it does, update that assertion to the new wording.

- [ ] **Step 6: Lint, typecheck, commit**

Run: `pnpm lint:fix && pnpm typecheck`

```bash
git add src/domains/releases src/ado/errors.ts src/setup.ts README.md test/unit/domains/releases/writeService.test.ts test/unit/ado/errors.test.ts
git commit -m "feat(releases): delete_release_definition tool; Release manage scope"
```

---

### Task 7: Docs, version, registration smoke test

**Files:**
- Modify: `README.md` (write-tools table, ~line 140; intro sentence line 3)
- Modify: `docs/ROADMAP.md` (insert before `## Out of scope`)
- Modify: `package.json` (`version`)

- [ ] **Step 1: README tool table rows**

Append after the `delete_work_item_comment` row in the write-tools table:

```markdown
| `create_pipeline` | Create a YAML pipeline from a repository name + yaml path. Reversible via `delete_pipeline`. |
| `delete_pipeline` | Soft-delete a pipeline definition (recycle bin, 30 days). Confirms before calling. |
| `create_release_definition` | Clone an existing release definition under a new name; optional folder, variables, and artifact rebinding. Confirms before calling. |
| `delete_release_definition` | Soft-delete a release definition; `forceDelete` cancels in-flight deployments. Confirms before calling. Needs Release "manage" scope. |
```

In the README intro (line 3), after "manage reviewers." append: " Pipeline and release definitions can be created (YAML pipelines; release definitions by cloning) and deleted."

- [ ] **Step 2: ROADMAP entry**

Insert before `## Out of scope (and likely to stay that way)`:

```markdown
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
- **Strip rules are a pure module** (`cloneDefinition.ts`) with one test per rule, cross-checked against the REST 7.1 create sample (all ids 0, server fields absent, `environmentTriggers` emptied because they reference source env ids).
- **SDK type gap.** `CreatePipelineConfigurationParameters` lacks `path`/`repository`; a local `CreateYamlPipelineParameters` widens it.
- **New PAT scope: Release manage**, needed only by `delete_release_definition`. Updated in setup wizard, auth hint, README.

**Spec:** `docs/superpowers/specs/2026-09-04-azure-devops-mcp-phase-6-definition-creation-design.md`.
**Plan:** `docs/superpowers/plans/2026-09-04-azure-devops-mcp-phase-6-definition-creation.md`.

---

```

- [ ] **Step 3: Bump version**

In `package.json`, change `"version": "0.11.0"` to `"version": "0.12.0"`.

- [ ] **Step 4: Build and smoke-test registration over stdio**

Run:

```bash
pnpm build
cat > /tmp/smoke-phase6.cjs <<'EOF'
const { spawn } = require("node:child_process");
const p = spawn("node", ["dist/index.js"], { env: { ...process.env, AZURE_DEVOPS_BASE_URL: "https://dev.azure.com/x", AZURE_DEVOPS_KIND: "services", AZURE_DEVOPS_PAT: "fake" }, stdio: ["pipe", "pipe", "ignore"] });
let buf = "";
const want = ["create_pipeline", "delete_pipeline", "create_release_definition", "delete_release_definition"];
p.stdout.on("data", d => { buf += d; for (const line of buf.split("\n")) { if (!line.startsWith("{")) continue; const m = JSON.parse(line); if (m.id === 2) { const names = m.result.tools.map(t => t.name); console.log(process.env.AZURE_DEVOPS_READ_ONLY ? "read-only" : "full", "tools:", names.length, "phase6:", JSON.stringify(want.filter(n => names.includes(n)))); p.kill(); process.exit(0); } } });
const send = o => p.stdin.write(JSON.stringify(o) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
setTimeout(() => { send({ jsonrpc: "2.0", method: "notifications/initialized" }); send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }); }, 300);
setTimeout(() => { console.error("timeout"); p.kill(); process.exit(1); }, 5000);
EOF
node /tmp/smoke-phase6.cjs
AZURE_DEVOPS_READ_ONLY=true node /tmp/smoke-phase6.cjs
```

Expected:
```
full tools: 56 phase6: ["create_pipeline","delete_pipeline","create_release_definition","delete_release_definition"]
read-only tools: 23 phase6: []
```

- [ ] **Step 5: Full verification and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all clean; test count = 199 + 4 (Task 2) + 2 (Task 3) + 12 (Task 4) + 6 (Task 5) + 4 (Task 6) = 227.

```bash
git add README.md docs/ROADMAP.md package.json
git commit -m "docs: Phase 6 README + roadmap; bump to 0.12.0"
```

---

### Task 8: Manual verification against a real ADO instance (before release)

Not automatable; do it once from the worktree with the built `dist/index.js` pointed at by a local MCP config, or with a small script using `SdkAdoClient` directly. Record the outcome in the PR description.

- [ ] **Step 1:** `create_pipeline` against a throwaway repo with a trivial `azure-pipelines.yml`; open the pipeline in the UI; `queue_pipeline_run` on it; confirm it runs. Confirm in the UI that ADO stored it as a YAML configuration bound to the right repository and path; if ADO rejected the numeric `type` (400) or stored a non-YAML configuration, change `SdkAdoClient.createPipeline` to send the literal string `'yaml'` with a one-line comment.
- [ ] **Step 2:** `create_release_definition` cloning a real, small definition; open the new definition in the UI; confirm stages, tasks, agent pool, approvals, and artifact binding are intact; `create_release` from it (inert by default); confirm the release lists the expected stages.
- [ ] **Step 3:** `delete_release_definition` on the clone (expect success without `forceDelete` since nothing is deploying); `delete_pipeline` on the test pipeline. Confirm both appear in the respective recycle bins.
- [ ] **Step 3b:** clone a definition that has a scheduled release trigger and an `artifactSources` rebind; confirm in the UI that the clone's schedule is independent and the rebound artifact shows the NEW build pipeline.
- [ ] **Step 3c:** clone a definition with a secret variable; confirm the secret is blank on the clone (expected) and the tool copy says so.
- [ ] **Step 4:** If ADO rejects the cloned payload (400 with a field name), add that field to `stripForClone`, add a test row for it, and re-run Steps 2–3. Note the extra rule in the ROADMAP entry.

---

## Self-review

**Spec coverage:**
- `create_pipeline` (inputs, repo resolution, leading slash, folder default, SDK type gap, error notes) → Task 1 + Task 2.
- `delete_pipeline` → Task 1 + Task 3.
- `create_release_definition` (inputs, service steps 1–6, strip rules, alias validation, variable merge, result shape) → Task 1 + Task 4 + Task 5.
- `delete_release_definition` (`comment`, `forceDelete` default false) → Task 1 + Task 6.
- Confirmation lines on three tools, none on `create_pipeline` → Tasks 3, 5, 6, 2.
- Read-only gate → inherited from `registerAllTools`; verified in Task 7 smoke test.
- PAT scopes: manage tier in three places + `AdoScopeError` branch → Task 6.
- Error mapping (no new classes; 404 for missing repo via `AdoNotFoundError`) → Task 2.
- Layering (no cross-domain import; repo + build-definition lookups via `AdoClient`) → Tasks 2, 5.
- File structure incl. `cloneDefinition.ts` as a pure module → Task 4.
- Testing strategy incl. manual verification → Tasks 2–7 and Task 8.
- Version 0.12.0, ROADMAP, README → Task 7.

**Placeholder scan:** none; every code step carries full code.

**Type consistency:** `AdoClient.createPipeline` args `{ project, name, folder, yamlPath, repositoryId, repositoryName }` used identically in Task 1 (interface, SDK, fake) and Task 2 (service). `deletePipelineDefinition({ project, definitionId })` in Task 1 and Task 3. `createReleaseDefinition({ project, definition })` in Task 1 and Task 5. `deleteReleaseDefinition({ project, definitionId, comment, forceDelete })` in Task 1 and Task 6. `stripForClone(def)` in Task 4 and Task 5. Fake getters `getCreatedPipelines`, `getDeletedPipelines`, `getCreatedReleaseDefs`, `getDeletedReleaseDefs` and setters `setNextCreatedPipeline`, `setNextCreatedReleaseDef` match between Task 1 and the tests in Tasks 2, 3, 5, 6.
