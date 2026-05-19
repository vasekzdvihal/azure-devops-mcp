# Azure DevOps MCP — Phase 4.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 5 write tools that let the LLM retry a single failed pipeline stage and edit the persistent variable / trigger surface of pipeline + release definitions: `retry_pipeline_stage`, `update_pipeline_variables`, `update_pipeline_triggers`, `update_release_variables`, `update_release_environment_variables`.

**Architecture:** Extend the existing `src/domains/pipelines/` and `src/domains/releases/` modules. Definition-edit tools follow a strict service-layer pattern of GET-the-definition → mutate-in-memory → PUT-the-whole-definition, preserving the `revision` field for optimistic concurrency and starting from the existing `variables` object on every PUT to avoid secret loss. `retry_pipeline_stage` is a single SDK call against `BuildApi.updateStage` with `forceRetryAllJobs: true`. No raw-HTTP infrastructure introduced (see spec, "Deviation from the ZDV-240 brief").

**Tech Stack:** TypeScript (ESM, NodeNext), Node 20+, Vitest, Zod, `azure-devops-node-api` v15, MCP SDK.

**Spec:** `docs/superpowers/specs/2026-05-19-azure-devops-mcp-phase-4-2-design.md`

---

## Build sequence rationale

Tasks 1–2 extend the seam (`AdoClient` interface + `FakeAdoClient` stubs) so subsequent service tasks can be TDD-developed against the fake without touching real SDK code. Tasks 3–5 ship pipeline writes (retry + variables + triggers). Tasks 6–7 ship release writes (variables + per-env variables). Task 8 wires up the new MCP tool definitions. Task 9 fills in `SdkAdoClient` production implementations last — covered indirectly via integration. Task 10 finalises docs + version.

Every task ends with a commit using `feat(phase-4.2): …` / `test(phase-4.2): …` / `chore(phase-4.2): …` to mirror Phase 4.1.

---

## Task 1: Extend AdoClient interface with 3 new method signatures

**Files:**
- Modify: `src/ado/client.ts`

- [ ] **Step 1: Read the file**

Read `src/ado/client.ts` end-to-end so you know where Phase 4.1 added its method signatures (around the bottom of the interface, in the "pipeline writes (Phase 4.1)" / "release writes (Phase 4.1)" sections).

- [ ] **Step 2: Append three new signatures**

At the end of the `AdoClient` interface (after `listPendingApprovals`), append:

```typescript
  // pipeline writes (Phase 4.2)
  retryBuildStage(args: {
    project: string;
    runId: number;
    stageName: string;
    forceRetryAllJobs?: boolean;
  }): Promise<void>;

  updatePipelineDefinition(args: {
    project: string;
    definitionId: number;
    definition: BuildDefinition;
  }): Promise<BuildDefinition>;

  // release writes (Phase 4.2)
  updateReleaseDefinition(args: {
    project: string;
    definition: ReleaseDefinition;
  }): Promise<ReleaseDefinition>;
```

No new imports needed — `BuildDefinition` and `ReleaseDefinition` are already imported at the top of the file (used by `getPipelineDefinition` / `getReleaseDefinition`).

- [ ] **Step 3: Build to confirm types compile**

Run: `npm run build`
Expected: SUCCESS (no implementations yet, but the interface compiles). If you get errors about `BuildDefinition` / `ReleaseDefinition` not imported, add them to the existing `import type { ... } from "./types.js"` block at the top.

- [ ] **Step 4: Commit**

```bash
git add src/ado/client.ts
git commit -m "$(cat <<'EOF'
feat(phase-4.2): add AdoClient signatures for stage retry + definition edits

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend FakeAdoClient with stubs for the 3 new methods

**Files:**
- Modify: `test/fakes/FakeAdoClient.ts`

- [ ] **Step 1: Read the existing Phase 4.1 stub patterns**

Open `test/fakes/FakeAdoClient.ts` and read the `// ---- phase-4.1 pipeline write state ----` and `// ---- phase-4.1 release write state ----` sections (around lines 680–880). The pattern is: a recorded-history array, an optional `next…` return value, setter and getter helpers, then the async method.

- [ ] **Step 2: Append Phase 4.2 stub block**

After the `listPendingApprovals` method (end of the class), add:

```typescript
  // ---- phase-4.2 pipeline write state ----
  private retriedStages: Array<{
    project: string;
    runId: number;
    stageName: string;
    forceRetryAllJobs?: boolean;
  }> = [];

  private pipelineDefUpdates: Array<{
    project: string;
    definitionId: number;
    definition: BuildDefinition;
  }> = [];
  private nextUpdatedPipelineDef?: BuildDefinition;

  getRetriedStages() {
    return this.retriedStages;
  }

  setNextUpdatedPipelineDef(def: BuildDefinition): void {
    this.nextUpdatedPipelineDef = def;
  }
  getPipelineDefUpdates() {
    return this.pipelineDefUpdates;
  }

  async retryBuildStage(args: {
    project: string;
    runId: number;
    stageName: string;
    forceRetryAllJobs?: boolean;
  }): Promise<void> {
    this.throwIfInjected("retryBuildStage");
    this.retriedStages.push(args);
  }

  async updatePipelineDefinition(args: {
    project: string;
    definitionId: number;
    definition: BuildDefinition;
  }): Promise<BuildDefinition> {
    this.throwIfInjected("updatePipelineDefinition");
    this.pipelineDefUpdates.push(args);
    return this.nextUpdatedPipelineDef ?? args.definition;
  }

  // ---- phase-4.2 release write state ----
  private releaseDefUpdates: Array<{
    project: string;
    definition: ReleaseDefinition;
  }> = [];
  private nextUpdatedReleaseDef?: ReleaseDefinition;

  setNextUpdatedReleaseDef(def: ReleaseDefinition): void {
    this.nextUpdatedReleaseDef = def;
  }
  getReleaseDefUpdates() {
    return this.releaseDefUpdates;
  }

  async updateReleaseDefinition(args: {
    project: string;
    definition: ReleaseDefinition;
  }): Promise<ReleaseDefinition> {
    this.throwIfInjected("updateReleaseDefinition");
    this.releaseDefUpdates.push(args);
    return this.nextUpdatedReleaseDef ?? args.definition;
  }
```

`BuildDefinition` and `ReleaseDefinition` are already imported in the existing type-import block; no new imports needed.

- [ ] **Step 3: Build to confirm**

Run: `npm run build`
Expected: SUCCESS. (TypeScript now sees a complete `AdoClient` implementation on the fake.)

- [ ] **Step 4: Run the existing test suite to confirm no regression**

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add test/fakes/FakeAdoClient.ts
git commit -m "$(cat <<'EOF'
test(phase-4.2): extend FakeAdoClient with stubs for retry + definition edits

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Zod schemas for the 5 new tools

**Files:**
- Modify: `src/domains/pipelines/schemas.ts`
- Modify: `src/domains/releases/schemas.ts`

- [ ] **Step 1: Read both schema files**

Read both files end-to-end so the new schemas match the existing style (raw shape objects exported as `const`, no `.refine()` because the tool layer takes raw shapes — cross-field validation goes in the service).

- [ ] **Step 2: Add pipeline schemas**

Append to `src/domains/pipelines/schemas.ts`:

```typescript
export const RetryPipelineStageInput = {
  project: z.string().min(1),
  runId: z.number().int().positive().describe("Build/run id (integer)"),
  stageName: z
    .string()
    .min(1)
    .describe(
      "Stage ref name as it appears in the pipeline YAML (case-sensitive). " +
        "Use `get_pipeline_run` and inspect the timeline to find the exact name.",
    ),
  forceRetryAllJobs: z
    .boolean()
    .optional()
    .describe(
      "When true (default), retries all jobs in the stage including those that already succeeded. " +
        "Set to false to retry only the failed jobs.",
    ),
};

// Variable shape reused by both pipeline + release variable tools.
const VariableSetEntry = z.object({
  value: z.string().describe("New value. For secrets, this is the secret to store."),
  isSecret: z
    .boolean()
    .optional()
    .describe(
      "Mark as secret. If omitted on a variable that was already a secret, " +
        "the existing isSecret:true is preserved (declassification requires explicit isSecret:false).",
    ),
  allowOverride: z
    .boolean()
    .optional()
    .describe("Whether this variable can be overridden at queue time."),
});

export const UpdatePipelineVariablesInput = {
  project: z.string().min(1),
  pipelineId: z.number().int().positive(),
  set: z
    .record(z.string().min(1), VariableSetEntry)
    .optional()
    .describe("Variables to add or update by name."),
  remove: z
    .array(z.string().min(1))
    .optional()
    .describe("Variable names to delete from the definition."),
};

export const UpdatePipelineTriggersInput = {
  project: z.string().min(1),
  pipelineId: z.number().int().positive(),
  triggers: z
    .array(z.record(z.string(), z.unknown()))
    .describe(
      "The full triggers array to set on the definition. Fetch the current definition via " +
        "`get_pipeline_definition` first, mutate the triggers array, then submit. The array " +
        "replaces existing triggers wholesale — omitted triggers are removed.",
    ),
};
```

- [ ] **Step 3: Add release schemas**

Append to `src/domains/releases/schemas.ts`. First add the shared `VariableSetEntry` definition (releases uses an identical shape; defining it locally rather than importing avoids cross-domain coupling):

```typescript
// Same shape as the pipeline variant — kept local to avoid cross-domain coupling.
const VariableSetEntry = z.object({
  value: z.string().describe("New value. For secrets, this is the secret to store."),
  isSecret: z
    .boolean()
    .optional()
    .describe(
      "Mark as secret. If omitted on a variable that was already a secret, " +
        "the existing isSecret:true is preserved.",
    ),
  allowOverride: z
    .boolean()
    .optional()
    .describe("Whether this variable can be overridden at queue time."),
});

export const UpdateReleaseVariablesInput = {
  project: z.string().min(1),
  definitionId: z.number().int().positive().describe("Release definition id"),
  set: z.record(z.string().min(1), VariableSetEntry).optional(),
  remove: z.array(z.string().min(1)).optional(),
};

export const UpdateReleaseEnvironmentVariablesInput = {
  project: z.string().min(1),
  definitionId: z.number().int().positive().describe("Release definition id"),
  environmentName: z
    .string()
    .min(1)
    .describe("Environment name on the release definition (case-insensitive match)."),
  set: z.record(z.string().min(1), VariableSetEntry).optional(),
  remove: z.array(z.string().min(1)).optional(),
};
```

- [ ] **Step 4: Build to confirm**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/pipelines/schemas.ts src/domains/releases/schemas.ts
git commit -m "$(cat <<'EOF'
feat(phase-4.2): add Zod input schemas for 5 new write tools

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: PipelinesWriteService.retryStage (TDD)

**Files:**
- Modify: `src/domains/pipelines/writeService.ts`
- Test: `test/unit/domains/pipelines/writeService.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/domains/pipelines/writeService.test.ts`:

```typescript
import { AdoConflictError } from "../../../../src/ado/errors.js";

describe("PipelinesWriteService.retryStage", () => {
  it("defaults forceRetryAllJobs to true and passes the rest through", async () => {
    const { svc, fake } = makeSvc();
    await svc.retryStage({ project: "Proj", runId: 42, stageName: "Build" });
    expect(fake.getRetriedStages()).toEqual([
      { project: "Proj", runId: 42, stageName: "Build", forceRetryAllJobs: true },
    ]);
  });

  it("respects an explicit forceRetryAllJobs: false", async () => {
    const { svc, fake } = makeSvc();
    await svc.retryStage({
      project: "p",
      runId: 1,
      stageName: "Deploy",
      forceRetryAllJobs: false,
    });
    expect(fake.getRetriedStages()[0]?.forceRetryAllJobs).toBe(false);
  });

  it("propagates an injected AdoConflictError unchanged", async () => {
    const { svc, fake } = makeSvc();
    fake.injectError("retryBuildStage", new AdoConflictError("already succeeded"));
    await expect(
      svc.retryStage({ project: "p", runId: 1, stageName: "Build" }),
    ).rejects.toBeInstanceOf(AdoConflictError);
  });

  it("returns a synthesised confirmation shape after success", async () => {
    const { svc } = makeSvc();
    const result = await svc.retryStage({
      project: "p",
      runId: 7,
      stageName: "Test",
    });
    expect(result).toEqual({ runId: 7, stageName: "Test", retried: true });
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npm test -- test/unit/domains/pipelines/writeService.test.ts`
Expected: FAIL — `svc.retryStage is not a function`.

- [ ] **Step 3: Implement retryStage**

In `src/domains/pipelines/writeService.ts`, add to the class:

```typescript
export interface RetryStageResult {
  runId: number;
  stageName: string;
  retried: true;
}
```

And add the method on `PipelinesWriteService`:

```typescript
  async retryStage(args: {
    project: string;
    runId: number;
    stageName: string;
    forceRetryAllJobs?: boolean;
  }): Promise<RetryStageResult> {
    await this.client.retryBuildStage({
      project: args.project,
      runId: args.runId,
      stageName: args.stageName,
      forceRetryAllJobs: args.forceRetryAllJobs ?? true,
    });
    return { runId: args.runId, stageName: args.stageName, retried: true };
  }
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `npm test -- test/unit/domains/pipelines/writeService.test.ts`
Expected: PASS (all 4 new tests, plus all existing pipeline write tests).

- [ ] **Step 5: Commit**

```bash
git add src/domains/pipelines/writeService.ts test/unit/domains/pipelines/writeService.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-4.2): add PipelinesWriteService.retryStage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: PipelinesWriteService.updateVariables (TDD) — load-bearing secret preservation

**Files:**
- Modify: `src/domains/pipelines/writeService.ts`
- Test: `test/unit/domains/pipelines/writeService.test.ts`

This task carries the highest-risk piece of Phase 4.2. The secret-preservation test is non-negotiable.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/domains/pipelines/writeService.test.ts`:

```typescript
import type { BuildDefinition } from "../../../../src/ado/types.js";

function makePipelineDef(opts: {
  variables?: Record<string, { value?: string | null; isSecret?: boolean; allowOverride?: boolean }>;
  revision?: number;
}): BuildDefinition {
  return {
    id: 7,
    name: "test-pipeline",
    revision: opts.revision ?? 5,
    variables: opts.variables,
  } as BuildDefinition;
}

describe("PipelinesWriteService.updateVariables", () => {
  it("preserves existing secrets when updating an unrelated plain variable (LOAD-BEARING)", async () => {
    const { svc, fake } = makeSvc();
    fake.setPipelineDefinition("p", 7, makePipelineDef({
      variables: {
        existingSecret: { isSecret: true, value: null },
        plainVar: { value: "foo" },
      },
    }));

    await svc.updateVariables({
      project: "p",
      pipelineId: 7,
      set: { plainVar: { value: "bar" } },
    });

    const put = fake.getPipelineDefUpdates();
    expect(put).toHaveLength(1);
    const sent = put[0]!.definition.variables!;
    expect(sent.existingSecret).toBeDefined();
    expect(sent.existingSecret.isSecret).toBe(true);
    expect(sent.plainVar.value).toBe("bar");
  });

  it("preserves isSecret:true when caller updates a secret without re-asserting isSecret", async () => {
    const { svc, fake } = makeSvc();
    fake.setPipelineDefinition("p", 7, makePipelineDef({
      variables: { dbPassword: { isSecret: true, value: null } },
    }));

    await svc.updateVariables({
      project: "p",
      pipelineId: 7,
      set: { dbPassword: { value: "new-secret" } },
    });

    const sent = fake.getPipelineDefUpdates()[0]!.definition.variables!;
    expect(sent.dbPassword.isSecret).toBe(true);
    expect(sent.dbPassword.value).toBe("new-secret");
  });

  it("allows explicit declassification when caller passes isSecret: false", async () => {
    const { svc, fake } = makeSvc();
    fake.setPipelineDefinition("p", 7, makePipelineDef({
      variables: { wasSecret: { isSecret: true, value: null } },
    }));

    await svc.updateVariables({
      project: "p",
      pipelineId: 7,
      set: { wasSecret: { value: "now-plain", isSecret: false } },
    });

    expect(fake.getPipelineDefUpdates()[0]!.definition.variables!.wasSecret.isSecret).toBe(false);
  });

  it("removes named variables", async () => {
    const { svc, fake } = makeSvc();
    fake.setPipelineDefinition("p", 7, makePipelineDef({
      variables: { keepMe: { value: "a" }, dropMe: { value: "b" } },
    }));

    await svc.updateVariables({ project: "p", pipelineId: 7, remove: ["dropMe"] });

    const sent = fake.getPipelineDefUpdates()[0]!.definition.variables!;
    expect(sent.keepMe).toBeDefined();
    expect(sent.dropMe).toBeUndefined();
  });

  it("round-trips the revision field on the PUT", async () => {
    const { svc, fake } = makeSvc();
    fake.setPipelineDefinition("p", 7, makePipelineDef({ revision: 42, variables: { x: { value: "1" } } }));

    await svc.updateVariables({ project: "p", pipelineId: 7, set: { x: { value: "2" } } });

    expect(fake.getPipelineDefUpdates()[0]!.definition.revision).toBe(42);
  });

  it("does both set and remove in a single call", async () => {
    const { svc, fake } = makeSvc();
    fake.setPipelineDefinition("p", 7, makePipelineDef({
      variables: { keep: { value: "k" }, drop: { value: "d" } },
    }));

    await svc.updateVariables({
      project: "p",
      pipelineId: 7,
      set: { add: { value: "new" } },
      remove: ["drop"],
    });

    const sent = fake.getPipelineDefUpdates()[0]!.definition.variables!;
    expect(sent.keep.value).toBe("k");
    expect(sent.add.value).toBe("new");
    expect(sent.drop).toBeUndefined();
  });

  it("throws when both set and remove are empty/missing", async () => {
    const { svc, fake } = makeSvc();
    fake.setPipelineDefinition("p", 7, makePipelineDef({ variables: {} }));
    await expect(svc.updateVariables({ project: "p", pipelineId: 7 })).rejects.toThrow(
      /at least one of set or remove/,
    );
    await expect(
      svc.updateVariables({ project: "p", pipelineId: 7, set: {}, remove: [] }),
    ).rejects.toThrow(/at least one of set or remove/);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npm test -- test/unit/domains/pipelines/writeService.test.ts`
Expected: FAIL — `svc.updateVariables is not a function`.

- [ ] **Step 3: Implement updateVariables**

In `src/domains/pipelines/writeService.ts`, add:

```typescript
import type { BuildDefinition, BuildDefinitionVariable } from "../../ado/types.js";

// Variable input shape — kept local to mirror the schema (single source of truth in tools.ts).
export interface VariableInput {
  value: string;
  isSecret?: boolean;
  allowOverride?: boolean;
}

export interface UpdateVariablesResult {
  pipelineId: number;
  variables: Record<string, { value: string | null; isSecret: boolean }>;
}

function mergeVariables(
  existing: Record<string, BuildDefinitionVariable> | undefined,
  setOps: Record<string, VariableInput> | undefined,
  removeOps: string[] | undefined,
): Record<string, BuildDefinitionVariable> {
  // Start from existing — this is the secret-preservation guarantee.
  const merged: Record<string, BuildDefinitionVariable> = { ...(existing ?? {}) };
  for (const name of removeOps ?? []) {
    delete merged[name];
  }
  for (const [name, v] of Object.entries(setOps ?? {})) {
    const prev = merged[name];
    merged[name] = {
      value: v.value,
      // If caller didn't say, fall back to the prior isSecret (preserves "was a secret").
      isSecret: v.isSecret ?? prev?.isSecret ?? false,
      allowOverride: v.allowOverride ?? prev?.allowOverride,
    };
  }
  return merged;
}

function projectVariables(
  vars: Record<string, BuildDefinitionVariable> | undefined,
): Record<string, { value: string | null; isSecret: boolean }> {
  const out: Record<string, { value: string | null; isSecret: boolean }> = {};
  for (const [name, v] of Object.entries(vars ?? {})) {
    out[name] = {
      // Secrets get nulled out so callers can't accidentally surface the stored value.
      value: v.isSecret ? null : (v.value ?? null),
      isSecret: !!v.isSecret,
    };
  }
  return out;
}
```

Add the method to the class:

```typescript
  async updateVariables(args: {
    project: string;
    pipelineId: number;
    set?: Record<string, VariableInput>;
    remove?: string[];
  }): Promise<UpdateVariablesResult> {
    const setCount = Object.keys(args.set ?? {}).length;
    const removeCount = (args.remove ?? []).length;
    if (setCount + removeCount === 0) {
      throw new Error("updateVariables: provide at least one of set or remove");
    }

    const definition = await this.client.getPipelineDefinition({
      project: args.project,
      definitionId: args.pipelineId,
    });

    const mergedVars = mergeVariables(definition.variables, args.set, args.remove);

    const updated = await this.client.updatePipelineDefinition({
      project: args.project,
      definitionId: args.pipelineId,
      definition: { ...definition, variables: mergedVars },
    });

    return {
      pipelineId: args.pipelineId,
      variables: projectVariables(updated.variables),
    };
  }
```

`BuildDefinitionVariable` may not be exported from `src/ado/types.ts` yet. If `npm run build` fails on the import, open `src/ado/types.ts` and add `export type { BuildDefinitionVariable } from "azure-devops-node-api/interfaces/BuildInterfaces.js";` near the other build interface re-exports.

- [ ] **Step 4: Run tests, confirm they pass**

Run: `npm test -- test/unit/domains/pipelines/writeService.test.ts`
Expected: PASS (all `updateVariables` tests including the load-bearing secret preservation case).

- [ ] **Step 5: Commit**

```bash
git add src/domains/pipelines/writeService.ts src/ado/types.ts test/unit/domains/pipelines/writeService.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-4.2): add PipelinesWriteService.updateVariables with secret preservation

The service starts from the existing variables map on every PUT, so secrets
that come back from GET with value:null are re-sent intact. Includes a
load-bearing test for the secret-loss failure mode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: PipelinesWriteService.updateTriggers (TDD)

**Files:**
- Modify: `src/domains/pipelines/writeService.ts`
- Test: `test/unit/domains/pipelines/writeService.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/domains/pipelines/writeService.test.ts`:

```typescript
describe("PipelinesWriteService.updateTriggers", () => {
  it("replaces the triggers array wholesale, preserving the rest of the definition", async () => {
    const { svc, fake } = makeSvc();
    fake.setPipelineDefinition("p", 7, {
      id: 7,
      name: "pipeline",
      revision: 12,
      variables: { kept: { value: "v" } },
      triggers: [{ triggerType: 2 /* CI */ }],
    } as BuildDefinition);

    const newTriggers = [
      { triggerType: 2, branchFilters: ["+refs/heads/main"] },
      { triggerType: 8 /* Schedule */, schedules: [{ daysToBuild: 1 }] },
    ];

    await svc.updateTriggers({ project: "p", pipelineId: 7, triggers: newTriggers });

    const put = fake.getPipelineDefUpdates();
    expect(put).toHaveLength(1);
    expect(put[0]!.definition.triggers).toEqual(newTriggers);
    expect(put[0]!.definition.variables).toEqual({ kept: { value: "v" } });
    expect(put[0]!.definition.revision).toBe(12);
  });

  it("returns the triggers echoed back from the response", async () => {
    const { svc, fake } = makeSvc();
    fake.setPipelineDefinition("p", 7, { id: 7, revision: 1 } as BuildDefinition);
    const newTriggers = [{ triggerType: 2 }];
    const result = await svc.updateTriggers({ project: "p", pipelineId: 7, triggers: newTriggers });
    expect(result).toEqual({ pipelineId: 7, triggers: newTriggers });
  });

  it("accepts an empty array to remove all triggers (manual-only pipeline)", async () => {
    const { svc, fake } = makeSvc();
    fake.setPipelineDefinition("p", 7, { id: 7, revision: 1, triggers: [{ triggerType: 2 }] } as BuildDefinition);
    await svc.updateTriggers({ project: "p", pipelineId: 7, triggers: [] });
    expect(fake.getPipelineDefUpdates()[0]!.definition.triggers).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npm test -- test/unit/domains/pipelines/writeService.test.ts`
Expected: FAIL — `svc.updateTriggers is not a function`.

- [ ] **Step 3: Implement updateTriggers**

In `src/domains/pipelines/writeService.ts`, add the result type:

```typescript
export interface UpdateTriggersResult {
  pipelineId: number;
  triggers: unknown[];
}
```

And the method on the class:

```typescript
  async updateTriggers(args: {
    project: string;
    pipelineId: number;
    triggers: unknown[];
  }): Promise<UpdateTriggersResult> {
    const definition = await this.client.getPipelineDefinition({
      project: args.project,
      definitionId: args.pipelineId,
    });

    // The triggers array is loosely-typed (Zod gives us record<string, unknown>[]); the
    // SDK accepts BuildTrigger[] which is a discriminated union. We cast through — ADO
    // validates the shape server-side and surfaces a 400 with a useful message on bad input.
    const updated = await this.client.updatePipelineDefinition({
      project: args.project,
      definitionId: args.pipelineId,
      definition: { ...definition, triggers: args.triggers as BuildDefinition["triggers"] },
    });

    return {
      pipelineId: args.pipelineId,
      triggers: (updated.triggers ?? []) as unknown[],
    };
  }
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `npm test -- test/unit/domains/pipelines/writeService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/pipelines/writeService.ts test/unit/domains/pipelines/writeService.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-4.2): add PipelinesWriteService.updateTriggers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: ReleasesWriteService.updateVariables (TDD)

**Files:**
- Modify: `src/domains/releases/writeService.ts`
- Test: `test/unit/domains/releases/writeService.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/domains/releases/writeService.test.ts`:

```typescript
import type { ReleaseDefinition } from "../../../../src/ado/types.js";

function makeReleaseDef(opts: {
  variables?: Record<string, { value?: string | null; isSecret?: boolean }>;
  environments?: Array<{ id: number; name: string; variables?: Record<string, { value?: string | null; isSecret?: boolean }> }>;
  revision?: number;
}): ReleaseDefinition {
  return {
    id: 99,
    name: "release-def",
    revision: opts.revision ?? 3,
    variables: opts.variables,
    environments: opts.environments,
  } as ReleaseDefinition;
}

describe("ReleasesWriteService.updateVariables", () => {
  it("preserves existing secrets when updating an unrelated plain var (LOAD-BEARING)", async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition("p", 99, makeReleaseDef({
      variables: {
        existingSecret: { isSecret: true, value: null },
        plainVar: { value: "foo" },
      },
    }));

    await svc.updateVariables({
      project: "p",
      definitionId: 99,
      set: { plainVar: { value: "bar" } },
    });

    const sent = fake.getReleaseDefUpdates()[0]!.definition.variables!;
    expect(sent.existingSecret).toBeDefined();
    expect(sent.existingSecret.isSecret).toBe(true);
    expect(sent.plainVar.value).toBe("bar");
  });

  it("preserves isSecret:true when updating a secret without re-asserting", async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition("p", 99, makeReleaseDef({
      variables: { token: { isSecret: true, value: null } },
    }));
    await svc.updateVariables({
      project: "p",
      definitionId: 99,
      set: { token: { value: "new" } },
    });
    const sent = fake.getReleaseDefUpdates()[0]!.definition.variables!;
    expect(sent.token.isSecret).toBe(true);
    expect(sent.token.value).toBe("new");
  });

  it("removes named variables", async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition("p", 99, makeReleaseDef({
      variables: { keep: { value: "k" }, drop: { value: "d" } },
    }));
    await svc.updateVariables({ project: "p", definitionId: 99, remove: ["drop"] });
    const sent = fake.getReleaseDefUpdates()[0]!.definition.variables!;
    expect(sent.keep).toBeDefined();
    expect(sent.drop).toBeUndefined();
  });

  it("round-trips revision", async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition("p", 99, makeReleaseDef({ revision: 17, variables: { a: { value: "1" } } }));
    await svc.updateVariables({ project: "p", definitionId: 99, set: { a: { value: "2" } } });
    expect(fake.getReleaseDefUpdates()[0]!.definition.revision).toBe(17);
  });

  it("throws when both set and remove are empty/missing", async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition("p", 99, makeReleaseDef({ variables: {} }));
    await expect(svc.updateVariables({ project: "p", definitionId: 99 })).rejects.toThrow(
      /at least one of set or remove/,
    );
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npm test -- test/unit/domains/releases/writeService.test.ts`
Expected: FAIL — `svc.updateVariables is not a function`.

- [ ] **Step 3: Implement updateVariables**

In `src/domains/releases/writeService.ts`, add at the top after the existing imports:

```typescript
import type {
  ReleaseDefinition,
  ConfigurationVariableValue,
} from "../../ado/types.js";

export interface ReleaseVariableInput {
  value: string;
  isSecret?: boolean;
  allowOverride?: boolean;
}

export interface UpdateReleaseVariablesResult {
  definitionId: number;
  variables: Record<string, { value: string | null; isSecret: boolean }>;
}

function mergeReleaseVariables(
  existing: Record<string, ConfigurationVariableValue> | undefined,
  setOps: Record<string, ReleaseVariableInput> | undefined,
  removeOps: string[] | undefined,
): Record<string, ConfigurationVariableValue> {
  const merged: Record<string, ConfigurationVariableValue> = { ...(existing ?? {}) };
  for (const name of removeOps ?? []) delete merged[name];
  for (const [name, v] of Object.entries(setOps ?? {})) {
    const prev = merged[name];
    merged[name] = {
      value: v.value,
      isSecret: v.isSecret ?? prev?.isSecret ?? false,
      allowOverride: v.allowOverride ?? prev?.allowOverride,
    };
  }
  return merged;
}

function projectReleaseVariables(
  vars: Record<string, ConfigurationVariableValue> | undefined,
): Record<string, { value: string | null; isSecret: boolean }> {
  const out: Record<string, { value: string | null; isSecret: boolean }> = {};
  for (const [name, v] of Object.entries(vars ?? {})) {
    out[name] = {
      value: v.isSecret ? null : (v.value ?? null),
      isSecret: !!v.isSecret,
    };
  }
  return out;
}
```

If `ConfigurationVariableValue` isn't exported from `src/ado/types.ts`, add `export type { ConfigurationVariableValue } from "azure-devops-node-api/interfaces/ReleaseInterfaces.js";` to that file.

Add the method to `ReleasesWriteService`:

```typescript
  async updateVariables(args: {
    project: string;
    definitionId: number;
    set?: Record<string, ReleaseVariableInput>;
    remove?: string[];
  }): Promise<UpdateReleaseVariablesResult> {
    const setCount = Object.keys(args.set ?? {}).length;
    const removeCount = (args.remove ?? []).length;
    if (setCount + removeCount === 0) {
      throw new Error("updateVariables: provide at least one of set or remove");
    }

    const definition = await this.client.getReleaseDefinition({
      project: args.project,
      definitionId: args.definitionId,
    });

    const mergedVars = mergeReleaseVariables(definition.variables, args.set, args.remove);

    const updated = await this.client.updateReleaseDefinition({
      project: args.project,
      definition: { ...definition, variables: mergedVars },
    });

    return {
      definitionId: args.definitionId,
      variables: projectReleaseVariables(updated.variables),
    };
  }
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `npm test -- test/unit/domains/releases/writeService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/releases/writeService.ts src/ado/types.ts test/unit/domains/releases/writeService.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-4.2): add ReleasesWriteService.updateVariables with secret preservation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: ReleasesWriteService.updateEnvironmentVariables (TDD)

**Files:**
- Modify: `src/domains/releases/writeService.ts`
- Test: `test/unit/domains/releases/writeService.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/domains/releases/writeService.test.ts`:

```typescript
describe("ReleasesWriteService.updateEnvironmentVariables", () => {
  it("mutates only the target environment's variables (preserves others)", async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition("p", 99, makeReleaseDef({
      environments: [
        { id: 1, name: "Dev", variables: { devOnly: { value: "d" } } },
        {
          id: 2,
          name: "Prod",
          variables: {
            prodSecret: { isSecret: true, value: null },
            plainVar: { value: "old" },
          },
        },
      ],
    }));

    await svc.updateEnvironmentVariables({
      project: "p",
      definitionId: 99,
      environmentName: "Prod",
      set: { plainVar: { value: "new" } },
    });

    const sentDef = fake.getReleaseDefUpdates()[0]!.definition;
    const dev = sentDef.environments!.find((e) => e.name === "Dev")!;
    const prod = sentDef.environments!.find((e) => e.name === "Prod")!;
    // Dev's variables untouched.
    expect(dev.variables).toEqual({ devOnly: { value: "d" } });
    // Prod's secret preserved, plain variable updated.
    expect(prod.variables!.prodSecret).toBeDefined();
    expect(prod.variables!.prodSecret.isSecret).toBe(true);
    expect(prod.variables!.plainVar.value).toBe("new");
  });

  it("matches the environment name case-insensitively", async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition("p", 99, makeReleaseDef({
      environments: [{ id: 1, name: "Production", variables: {} }],
    }));
    await svc.updateEnvironmentVariables({
      project: "p",
      definitionId: 99,
      environmentName: "PRODUCTION",
      set: { x: { value: "1" } },
    });
    expect(fake.getReleaseDefUpdates()).toHaveLength(1);
  });

  it("throws with the available environment list when the name doesn't match", async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition("p", 99, makeReleaseDef({
      environments: [
        { id: 1, name: "Dev", variables: {} },
        { id: 2, name: "Prod", variables: {} },
      ],
    }));
    await expect(
      svc.updateEnvironmentVariables({
        project: "p",
        definitionId: 99,
        environmentName: "Staging",
        set: { x: { value: "1" } },
      }),
    ).rejects.toThrow(/Staging.*Dev, Prod/);
  });

  it("removes per-environment variables", async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition("p", 99, makeReleaseDef({
      environments: [{ id: 1, name: "Dev", variables: { keep: { value: "k" }, drop: { value: "d" } } }],
    }));
    await svc.updateEnvironmentVariables({
      project: "p",
      definitionId: 99,
      environmentName: "Dev",
      remove: ["drop"],
    });
    const env = fake.getReleaseDefUpdates()[0]!.definition.environments!.find((e) => e.name === "Dev")!;
    expect(env.variables!.keep).toBeDefined();
    expect(env.variables!.drop).toBeUndefined();
  });

  it("throws when both set and remove are empty/missing", async () => {
    const { svc, fake } = makeSvc();
    fake.setReleaseDefinition("p", 99, makeReleaseDef({
      environments: [{ id: 1, name: "Dev", variables: {} }],
    }));
    await expect(
      svc.updateEnvironmentVariables({
        project: "p",
        definitionId: 99,
        environmentName: "Dev",
      }),
    ).rejects.toThrow(/at least one of set or remove/);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npm test -- test/unit/domains/releases/writeService.test.ts`
Expected: FAIL — `svc.updateEnvironmentVariables is not a function`.

- [ ] **Step 3: Implement updateEnvironmentVariables**

Add to `ReleasesWriteService`:

```typescript
  async updateEnvironmentVariables(args: {
    project: string;
    definitionId: number;
    environmentName: string;
    set?: Record<string, ReleaseVariableInput>;
    remove?: string[];
  }): Promise<{
    definitionId: number;
    environmentId: number;
    environmentName: string;
    variables: Record<string, { value: string | null; isSecret: boolean }>;
  }> {
    const setCount = Object.keys(args.set ?? {}).length;
    const removeCount = (args.remove ?? []).length;
    if (setCount + removeCount === 0) {
      throw new Error("updateEnvironmentVariables: provide at least one of set or remove");
    }

    const definition = await this.client.getReleaseDefinition({
      project: args.project,
      definitionId: args.definitionId,
    });

    const envs = definition.environments ?? [];
    const target = envs.find(
      (e) => e.name?.toLowerCase() === args.environmentName.toLowerCase(),
    );
    if (!target || target.id == null) {
      const available = envs.map((e) => e.name).filter(Boolean).join(", ");
      throw new Error(
        `Environment '${args.environmentName}' not found on release definition ${args.definitionId}. ` +
          `Available: ${available || "(none)"}`,
      );
    }

    const mergedVars = mergeReleaseVariables(target.variables, args.set, args.remove);

    // Replace the target env's variables in place; other envs are untouched.
    const nextEnvs = envs.map((e) =>
      e.id === target.id ? { ...e, variables: mergedVars } : e,
    );

    const updated = await this.client.updateReleaseDefinition({
      project: args.project,
      definition: { ...definition, environments: nextEnvs },
    });

    const updatedTarget =
      (updated.environments ?? []).find((e) => e.id === target.id) ?? target;

    return {
      definitionId: args.definitionId,
      environmentId: target.id,
      environmentName: target.name ?? args.environmentName,
      variables: projectReleaseVariables(updatedTarget.variables),
    };
  }
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `npm test -- test/unit/domains/releases/writeService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/releases/writeService.ts test/unit/domains/releases/writeService.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-4.2): add ReleasesWriteService.updateEnvironmentVariables

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wire up the 5 new MCP tool definitions

**Files:**
- Modify: `src/domains/pipelines/writeTools.ts`
- Modify: `src/domains/releases/writeTools.ts`

- [ ] **Step 1: Extend pipeline writeTools**

Replace the `buildPipelineWriteTools` function body in `src/domains/pipelines/writeTools.ts` so that it includes three additional entries. The full updated file:

```typescript
import type { PipelinesWriteService } from "./writeService.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  QueuePipelineRunInput,
  CancelPipelineRunInput,
  UpdateBuildTagsInput,
  RetryPipelineStageInput,
  UpdatePipelineVariablesInput,
  UpdatePipelineTriggersInput,
} from "./schemas.js";

export function buildPipelineWriteTools(svc: PipelinesWriteService): ToolDefinition[] {
  return [
    {
      name: "queue_pipeline_run",
      config: {
        title: "Queue a new run of a pipeline",
        description:
          "Starts a new build/run of the named pipeline. Optional `branch` overrides the default; " +
          "`templateParameters` and `variables` let YAML pipelines parameterize the run. Returns the " +
          "new run id and URL so you can chain `get_pipeline_run` to watch it.",
        inputSchema: QueuePipelineRunInput,
      },
      handler: async (args) => svc.queueRun(args as Parameters<typeof svc.queueRun>[0]),
    },
    {
      name: "cancel_pipeline_run",
      config: {
        title: "Cancel an in-progress pipeline run",
        description:
          "Cancels a running build. Already-completed runs return a clear conflict error; this " +
          "tool does not retry or noop in that case.",
        inputSchema: CancelPipelineRunInput,
      },
      handler: async (args) => svc.cancelRun(args as Parameters<typeof svc.cancelRun>[0]),
    },
    {
      name: "update_build_tags",
      config: {
        title: "Add and/or remove tags on a build/run",
        description:
          "Adds tags in `addTags` and removes tags in `removeTags` from a build. Either array (or " +
          "both) may be supplied; at least one tag is required across the two arrays. Returns the " +
          "final tag list after the changes.",
        inputSchema: UpdateBuildTagsInput,
      },
      handler: async (args) => svc.updateTags(args as Parameters<typeof svc.updateTags>[0]),
    },
    {
      name: "retry_pipeline_stage",
      config: {
        title: "Retry a single failed stage of a YAML multi-stage pipeline",
        description:
          "Re-runs the named stage in an existing pipeline run instead of re-queueing the whole " +
          "pipeline. `stageName` must match the stage's ref name as it appears in YAML (case-sensitive). " +
          "By default retries all jobs in the stage (`forceRetryAllJobs: true`); set to false to retry " +
          "only the failed jobs. Attempting to retry a stage on a run that is not in a retryable state " +
          "returns a clear conflict error.",
        inputSchema: RetryPipelineStageInput,
      },
      handler: async (args) => svc.retryStage(args as Parameters<typeof svc.retryStage>[0]),
    },
    {
      name: "update_pipeline_variables",
      config: {
        title: "Add, update, or remove variables on a pipeline definition",
        description:
          "**Always confirm with the user before calling — this changes pipeline configuration " +
          "visible to every future run.** Use `set` to add or update variables and `remove` to delete " +
          "them. Existing secrets are preserved automatically: if you don't include a secret in `set`, " +
          "its stored value is kept. To declassify a secret, include it in `set` with " +
          "`isSecret: false`. At least one of `set` or `remove` is required.",
        inputSchema: UpdatePipelineVariablesInput,
      },
      handler: async (args) => svc.updateVariables(args as Parameters<typeof svc.updateVariables>[0]),
    },
    {
      name: "update_pipeline_triggers",
      config: {
        title: "Replace the triggers on a pipeline definition",
        description:
          "**Always confirm with the user before calling — this changes pipeline configuration " +
          "visible to every future run.** Replaces the entire `triggers` array on the definition. " +
          "Fetch the current definition via `get_pipeline_definition`, edit the triggers array, then " +
          "submit it here — any trigger not present in your submitted array is removed.",
        inputSchema: UpdatePipelineTriggersInput,
      },
      handler: async (args) => svc.updateTriggers(args as Parameters<typeof svc.updateTriggers>[0]),
    },
  ];
}
```

- [ ] **Step 2: Extend release writeTools**

Open `src/domains/releases/writeTools.ts`. Add the two new tool definitions after the existing four. Update the imports at the top to include the new schemas:

```typescript
import {
  CreateReleaseInput,
  DeployReleaseStageInput,
  ApproveReleaseGateInput,
  CancelReleaseInput,
  UpdateReleaseVariablesInput,
  UpdateReleaseEnvironmentVariablesInput,
} from "./schemas.js";
```

(Match the actual import list as it exists in the file — only add the two new identifiers; do not drop existing ones.)

Append to the returned array (inside `buildReleaseWriteTools`):

```typescript
    {
      name: "update_release_variables",
      config: {
        title: "Add, update, or remove definition-level variables on a release definition",
        description:
          "**Always confirm with the user before calling — this changes release configuration " +
          "visible to every future deployment.** Use `set` to add or update variables and `remove` " +
          "to delete them. Existing secrets are preserved automatically; declassify a secret " +
          "by including it in `set` with `isSecret: false`. At least one of `set` or `remove` is " +
          "required.",
        inputSchema: UpdateReleaseVariablesInput,
      },
      handler: async (args) => svc.updateVariables(args as Parameters<typeof svc.updateVariables>[0]),
    },
    {
      name: "update_release_environment_variables",
      config: {
        title: "Add, update, or remove per-environment variables on a release definition",
        description:
          "**Always confirm with the user before calling — this changes release configuration " +
          "visible to every future deployment.** Mutates only the named environment's variables " +
          "(case-insensitive name match). Other environments and definition-level variables are " +
          "untouched. Secret preservation rules match `update_release_variables`. At least one of " +
          "`set` or `remove` is required.",
        inputSchema: UpdateReleaseEnvironmentVariablesInput,
      },
      handler: async (args) =>
        svc.updateEnvironmentVariables(args as Parameters<typeof svc.updateEnvironmentVariables>[0]),
    },
```

- [ ] **Step 3: Build to confirm**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: All tests pass (including the new service-layer ones).

- [ ] **Step 5: Commit**

```bash
git add src/domains/pipelines/writeTools.ts src/domains/releases/writeTools.ts
git commit -m "$(cat <<'EOF'
feat(phase-4.2): add MCP tool definitions for retry + 4 definition-edit writes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Implement the 3 new SdkAdoClient methods

**Files:**
- Modify: `src/ado/sdkClient.ts`

- [ ] **Step 1: Read the Phase 4.1 write methods**

Open `src/ado/sdkClient.ts` and read the Phase 4.1 methods (around `queuePipelineRun`, `cancelPipelineRun`, `createRelease`). The pattern: get the typed SDK API via `this.api.getBuildApi()` / `getReleaseApi()`, call the SDK method, wrap errors with `mapSdkError`, re-throw any pre-existing `AdoError` untouched.

- [ ] **Step 2: Append three new methods**

Add to the `SdkAdoClient` class, after `removeBuildTag` for the pipeline methods and after `listPendingApprovals` for the release method:

```typescript
  async retryBuildStage(args: {
    project: string;
    runId: number;
    stageName: string;
    forceRetryAllJobs?: boolean;
  }): Promise<void> {
    try {
      const build = await this.api.getBuildApi();
      await build.updateStage(
        {
          forceRetryAllJobs: args.forceRetryAllJobs ?? true,
          state: /* StageUpdateType.Retry */ 0,
        },
        args.runId,
        args.stageName,
        args.project,
      );
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async updatePipelineDefinition(args: {
    project: string;
    definitionId: number;
    definition: BuildDefinition;
  }): Promise<BuildDefinition> {
    try {
      const build = await this.api.getBuildApi();
      return await build.updateDefinition(args.definition, args.project, args.definitionId);
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async updateReleaseDefinition(args: {
    project: string;
    definition: ReleaseDefinition;
  }): Promise<ReleaseDefinition> {
    try {
      const rel = await this.api.getReleaseApi();
      return await rel.updateReleaseDefinition(args.definition, args.project);
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }
```

Confirm `BuildDefinition` and `ReleaseDefinition` are already in the top-of-file type import block (they are, used by the existing `listPipelines` / `getPipelineDefinition` / `listReleaseDefinitions` methods).

**On `StageUpdateType.Retry`:** The `azure-devops-node-api/interfaces/BuildInterfaces.js` enum defines `Cancel = 0, Retry = 1`. Verify the numeric value before committing by running:

```bash
grep -A 5 "enum StageUpdateType" node_modules/azure-devops-node-api/interfaces/BuildInterfaces.d.ts
```

If the verified value is `Retry = 1`, update the inline comment and number in the code above to `/* StageUpdateType.Retry */ 1`. (The plan ships with `0` as a placeholder for the comment-vs-value sanity check the implementer must do here — the SDK enum value is the source of truth, not the plan.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass. (The new SDK methods aren't unit-tested directly — they're thin wrappers covered indirectly via the service-layer tests against `FakeAdoClient`.)

- [ ] **Step 5: Commit**

```bash
git add src/ado/sdkClient.ts
git commit -m "$(cat <<'EOF'
feat(phase-4.2): implement retryBuildStage + updatePipelineDefinition + updateReleaseDefinition on SdkAdoClient

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Smoke-test the MCP surface manually

**Files:**
- None — manual verification step.

The unit tests cover the service logic, but the only end-to-end signal that the new tools are wired through `registerAllTools` correctly is a manual probe.

- [ ] **Step 1: Build the project fresh**

Run: `npm run build`

- [ ] **Step 2: Start the server in read-only mode and verify the new write tools are absent**

Run: `AZURE_DEVOPS_READ_ONLY=true node dist/index.js` in one terminal. In another, send an `initialize` + `tools/list` request via the MCP inspector (or `npx @modelcontextprotocol/inspector`). Verify:
- `retry_pipeline_stage`, `update_pipeline_variables`, `update_pipeline_triggers`, `update_release_variables`, `update_release_environment_variables` are **absent** from the tool list.

Stop the server.

- [ ] **Step 3: Start the server normally and verify the new write tools are present**

Run: `node dist/index.js`. Re-issue `tools/list`. Verify all 5 new tools appear, with the descriptions from Task 9, and that their `inputSchema` includes the expected fields.

Stop the server.

If anything's off, the registration must be fixed before continuing — `buildPipelineWriteTools` / `buildReleaseWriteTools` returning the new defs is the only place this can break. Re-run unit tests after any fix.

- [ ] **Step 4: No commit needed (verification only)**

---

## Task 12: Update ROADMAP + bump version

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `package.json`

- [ ] **Step 1: Bump version**

In `package.json`, change `"version": "0.6.0"` to `"version": "0.7.0"`. Minor bump matches the Phase 4.1 convention (0.5.x → 0.6.0 on a feature phase release).

- [ ] **Step 2: Add Phase 4.2 ✅ block to ROADMAP**

Find the existing "✅ Phase 4.1" section in `docs/ROADMAP.md` and add a new section directly after it (above the next 🟡 / 💡 section). Match the format used by Phase 4.1's block:

```markdown
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
```

- [ ] **Step 3: Final build + test**

Run: `npm run build && npm test`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add package.json docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
chore(phase-4.2): finalize release — ROADMAP block + v0.7.0

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: (Optional) PR**

If using the standard PR workflow:

```bash
git push -u origin HEAD
gh pr create --title "Phase 4.2 — pipeline + release definition edits + retry_pipeline_stage" --body "$(cat <<'EOF'
## Summary

Ships 5 write tools deferred from Phase 4.1:
- `retry_pipeline_stage` — re-run a single failed stage of a multi-stage pipeline
- `update_pipeline_variables` — add/update/remove pipeline definition variables (secrets preserved)
- `update_pipeline_triggers` — replace pipeline triggers wholesale
- `update_release_variables` — add/update/remove release definition variables
- `update_release_environment_variables` — per-environment variable overrides

## Deviation from ZDV-240

The ticket assumed retry_pipeline_stage needed raw-HTTP infra because the endpoint wasn't wrapped by `azure-devops-node-api`. Verification showed `BuildApi.updateStage` does wrap it with the required `forceRetryAllJobs` parameter, so this PR uses the SDK method and defers raw-HTTP infra until a future tool genuinely needs it.

## Test plan
- [x] All existing tests pass
- [x] New service-layer tests for all 5 tools pass
- [x] Load-bearing secret-preservation test passes for `update_pipeline_variables` and `update_release_variables`
- [x] Manual smoke: tools/list includes the 5 new tools when read-only is off, excludes them when on
- [ ] Manual smoke against a real ADO instance (reviewer)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage check:**
- `retry_pipeline_stage` → Task 4 (service) + Task 9 (tool) + Task 10 (SDK).
- `update_pipeline_variables` (incl. secret preservation) → Task 5 + Task 9 + Task 10.
- `update_pipeline_triggers` → Task 6 + Task 9 + Task 10.
- `update_release_variables` → Task 7 + Task 9 + Task 10.
- `update_release_environment_variables` → Task 8 + Task 9 + Task 10.
- AdoClient signatures → Task 1.
- FakeAdoClient stubs → Task 2.
- Zod schemas → Task 3.
- Read-only mode gating → no change required (relies on existing `registerAllTools` plumbing); verified in Task 11.
- ROADMAP + version → Task 12.
- Spec's "raw HTTP appendix" → not built (deferred per the spec); no task needed.
- PAT scopes → no change required (verified in spec); no task needed.

**Type-consistency check:**
- `VariableInput` (pipeline) and `ReleaseVariableInput` (release) are defined in their respective service files in Task 5 / Task 7 and used in Task 9 / Task 10 only via `Parameters<typeof svc.method>[0]`, so a rename would propagate via TypeScript automatically.
- `BuildDefinitionVariable` and `ConfigurationVariableValue` re-exports from `src/ado/types.ts` are added defensively in Task 5 / Task 7 if they don't already exist.
- The `StageUpdateType.Retry` numeric value is a known unknown — Task 10 has an explicit `grep` verification step rather than trusting the plan's placeholder.
