# Azure DevOps MCP — Phase 4.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 7 write tools + 1 companion read tool that let the LLM act on Azure DevOps pipeline and release runs (queue/cancel/tag pipelines; create/deploy-stage/approve-gate/cancel releases; list pending approvals).

**Architecture:** Follow the established per-domain layout: each domain has a thin SDK-backed service class (`PipelinesWriteService`, `ReleasesWriteService`) that the MCP tool layer wraps. SDK calls go through the existing `AdoClient` interface seam — production uses `SdkAdoClient` (native `azure-devops-node-api`), tests use `FakeAdoClient`. All writes register behind the existing `AZURE_DEVOPS_READ_ONLY` gate in `registerAllTools`. No raw HTTP infrastructure introduced.

**Tech Stack:** TypeScript (ESM, NodeNext), Node 20+, Vitest, Zod, `azure-devops-node-api` v15, MCP SDK.

**Spec:** `docs/superpowers/specs/2026-05-18-azure-devops-mcp-phase-4-1-design.md`

---

## Build sequence rationale

Tasks 1–3 lay the foundation (error class, interface, fake) so subsequent service tasks can be TDD-developed against `FakeAdoClient` without touching real SDK code. Tasks 4–6 ship pipelines; 7–11 ship releases. Task 12 fills in `SdkAdoClient` production implementations last — it's the largest single file change but has the lowest test-feedback value (covered indirectly via integration). Tasks 13–14 wire everything together. Task 15 updates docs.

Every task ends with a commit. The conventional-commits style mirrors prior phases (`feat(phase-4.1): …`).

---

## Task 1: Add AdoScopeError + 401/403 scope-hint mapping

**Files:**
- Modify: `src/ado/errors.ts`
- Test: `test/unit/ado/errors.test.ts` (create or extend)

- [ ] **Step 1: Read existing error file**

Read `src/ado/errors.ts` end-to-end so you know the shape of `AdoError`, `AdoAuthError`, `AdoConflictError`, and the `mapHttpError(shape)` (or equivalent) function that branches on `statusCode`.

- [ ] **Step 2: Write the failing tests**

Add to (or create) `test/unit/ado/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  AdoScopeError,
  AdoAuthError,
  mapHttpError, // adjust import name to match what errors.ts actually exports
} from "../../../src/ado/errors.js";

describe("AdoScopeError", () => {
  it("extends AdoError with the scope name on the message", () => {
    const err = new AdoScopeError("Build (read & execute)", "underlying detail");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AdoScopeError");
    expect(err.scope).toBe("Build (read & execute)");
    expect(err.message).toContain("Build (read & execute)");
    expect(err.message).toContain("rerun");
  });
});

describe("mapHttpError — scope hint branch", () => {
  it("403 with body mentioning the scope → AdoScopeError naming the right scope", () => {
    const shape = {
      statusCode: 403,
      body: { message: "TF400813: Resource not available for anonymous access. The user requires the 'Release' permission with 'Manage' scope." },
      path: "/_apis/release/releases",
    };
    const err = mapHttpError(shape);
    expect(err).toBeInstanceOf(AdoScopeError);
    expect((err as AdoScopeError).scope).toMatch(/Release/);
  });

  it("403 without scope hint → falls through to AdoAuthError", () => {
    const shape = {
      statusCode: 403,
      body: { message: "Forbidden" },
      path: "/_apis/anything",
    };
    const err = mapHttpError(shape);
    expect(err).toBeInstanceOf(AdoAuthError);
    expect(err).not.toBeInstanceOf(AdoScopeError);
  });

  it("401 with scope hint → AdoScopeError", () => {
    const shape = {
      statusCode: 401,
      body: { message: "Token does not have required scope: vso.build_execute" },
      path: "/_apis/build/builds",
    };
    const err = mapHttpError(shape);
    expect(err).toBeInstanceOf(AdoScopeError);
    expect((err as AdoScopeError).scope).toMatch(/Build/);
  });
});
```

- [ ] **Step 3: Run tests, confirm they fail**

Run: `npm test -- test/unit/ado/errors.test.ts`
Expected: FAIL — `AdoScopeError` not exported / not defined.

- [ ] **Step 4: Implement AdoScopeError and extend mapHttpError**

In `src/ado/errors.ts`, add:

```typescript
export class AdoScopeError extends AdoError {
  readonly scope: string;
  constructor(scope: string, detail?: string) {
    super(
      `This call needs the '${scope}' PAT scope. Update your PAT in Azure DevOps ` +
        `(https://dev.azure.com/_usersSettings/tokens) and rerun ` +
        `\`npx -y @vasekzdvihal/azure-devops-mcp setup\`.` +
        (detail ? ` Underlying detail: ${detail}` : ""),
    );
    this.name = "AdoScopeError";
    this.scope = scope;
  }
}
```

Extend the existing `mapHttpError` function. After the 409 branch, add a 401/403 branch that inspects the body for scope hints and the path for API surface:

```typescript
if (shape.statusCode === 401 || shape.statusCode === 403) {
  const scope = detectMissingScope(shape);
  if (scope) {
    return new AdoScopeError(scope, extractDetail(shape));
  }
  // fall through to existing AdoAuthError branch
}

// helper — keep it in the same file, not exported
function detectMissingScope(shape: { body?: unknown; path?: string }): string | null {
  const message = String(
    (shape.body as { message?: string } | undefined)?.message ?? "",
  ).toLowerCase();
  const path = (shape.path ?? "").toLowerCase();
  // Body-text hints (ADO's wording varies across surfaces).
  if (message.includes("vso.build_execute") || message.includes("'build'")) {
    return "Build (read & execute)";
  }
  if (message.includes("vso.release_execute") || message.includes("'release'")) {
    return "Release (read, write, & execute)";
  }
  // Path-based fallback when the body is generic but the URL identifies the surface.
  if (path.includes("/_apis/build/")) return "Build (read & execute)";
  if (path.includes("/_apis/release/")) return "Release (read, write, & execute)";
  return null;
}

function extractDetail(shape: { body?: unknown }): string | undefined {
  const message = (shape.body as { message?: string } | undefined)?.message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}
```

Adjust the surrounding `mapHttpError` structure to match what's already in the file (the existing 404/409 branches give you the template).

- [ ] **Step 5: Run tests, confirm pass**

Run: `npm test -- test/unit/ado/errors.test.ts`
Expected: PASS (all four tests above).

- [ ] **Step 6: Commit**

```bash
git add src/ado/errors.ts test/unit/ado/errors.test.ts
git commit -m "feat(phase-4.1): add AdoScopeError + 401/403 scope-hint mapping

Maps ADO 401/403 responses that hint at a missing PAT scope to a new
AdoScopeError that names the scope and tells the user to rerun setup.
Generic 401/403 still surfaces as AdoAuthError. Body-text matching plus
URL-path fallback to cover both Build and Release surfaces."
```

---

## Task 2: Extend AdoClient interface with 8 new method signatures

**Files:**
- Modify: `src/ado/client.ts`
- Modify: `src/ado/types.ts` (re-export any new types needed)

- [ ] **Step 1: Read existing files**

Read `src/ado/client.ts` to see the `AdoClient` interface and how existing methods are documented + grouped. Read `src/ado/types.ts` to confirm which SDK types are already re-exported (you'll need `Run`, `RunPipelineParameters`, `Release`, `ReleaseStartMetadata`, `ReleaseApproval`, `Build`).

- [ ] **Step 2: Re-export the SDK types you need**

In `src/ado/types.ts`, ensure the following re-exports exist (add the ones missing):

```typescript
export type {
  Run,
  RunPipelineParameters,
} from "azure-devops-node-api/interfaces/PipelinesInterfaces.js";
export type {
  ReleaseStartMetadata,
  ReleaseEnvironmentUpdateMetadata,
  ReleaseApproval,
  ApprovalStatus,
} from "azure-devops-node-api/interfaces/ReleaseInterfaces.js";
// Build, Release, BuildStatus already re-exported in Phase 3 — confirm; if missing, add.
```

Match the existing re-export style (`export type { … } from "…"`).

- [ ] **Step 3: Add 8 method signatures to AdoClient**

In `src/ado/client.ts`, append the following methods to the `AdoClient` interface (preserve the existing grouping comments — add new groups for `// pipeline writes`, `// release writes`, and a single `// release reads (Phase 4.1)` for `listPendingApprovals`):

```typescript
  // ----- pipeline writes (Phase 4.1) -----

  queuePipelineRun(args: {
    project: string;
    pipelineId: number;
    branch?: string;
    templateParameters?: Record<string, string>;
    variables?: Record<string, { value: string; isSecret?: boolean }>;
  }): Promise<Run>;

  cancelPipelineRun(args: { project: string; runId: number }): Promise<Build>;

  addBuildTags(args: { project: string; runId: number; tags: string[] }): Promise<string[]>;
  removeBuildTag(args: { project: string; runId: number; tag: string }): Promise<string[]>;

  // ----- release writes (Phase 4.1) -----

  createRelease(args: {
    project: string;
    metadata: ReleaseStartMetadata;
  }): Promise<Release>;

  updateReleaseEnvironment(args: {
    project: string;
    releaseId: number;
    environmentId: number;
    update: ReleaseEnvironmentUpdateMetadata;
  }): Promise<unknown>;

  cancelRelease(args: {
    project: string;
    releaseId: number;
    comment?: string;
  }): Promise<Release>;

  updateReleaseApproval(args: {
    project: string;
    approvalId: number;
    status: "approved" | "rejected";
    comment?: string;
  }): Promise<ReleaseApproval>;

  // ----- release reads (Phase 4.1) -----

  listPendingApprovals(args: {
    project: string;
    releaseId?: number;
    assignedTo?: string;
  }): Promise<ReleaseApproval[]>;
```

Notes:
- `addBuildTags` and `removeBuildTag` are kept separate (matching SDK) — the service wraps them.
- `updateReleaseEnvironment` returns `unknown` because the SDK returns a heavy `ReleaseEnvironment` type the domain doesn't need; the service shapes it.
- `getRelease` is already on the interface from Phase 3 — `deployStage` in the service uses it for env-name resolution, no new SDK signature needed.

- [ ] **Step 4: Verify the project still typechecks**

Run: `npm run typecheck`
Expected: FAIL — `SdkAdoClient` and `FakeAdoClient` now miss these methods. That's expected; Tasks 3 and 12 fix them.

- [ ] **Step 5: Commit**

```bash
git add src/ado/client.ts src/ado/types.ts
git commit -m "feat(phase-4.1): add AdoClient signatures for pipeline + release writes

Adds 7 write signatures (queuePipelineRun, cancelPipelineRun,
addBuildTags, removeBuildTag, createRelease, updateReleaseEnvironment,
cancelRelease, updateReleaseApproval) + 1 read signature
(listPendingApprovals). SdkAdoClient and FakeAdoClient implementations
follow in the next tasks — typecheck is expected to fail until then."
```

---

## Task 3: Extend FakeAdoClient with stubs for the 8 new methods

**Files:**
- Modify: `test/fakes/FakeAdoClient.ts`

- [ ] **Step 1: Read existing FakeAdoClient**

Read `test/fakes/FakeAdoClient.ts` to understand the existing pattern: each method records args in a `Map` or array, returns a configurable "next" result, and exposes `getX()` introspection methods for tests. Replicate that pattern.

- [ ] **Step 2: Add new state, setters, getters, and method implementations**

Add the following at the end of the `FakeAdoClient` class (preserve all existing methods). Adapt naming to match existing conventions exactly.

```typescript
  // ---- phase-4.1 pipeline write state ----
  private queuedRuns: Array<{
    project: string;
    pipelineId: number;
    branch?: string;
    templateParameters?: Record<string, string>;
    variables?: Record<string, { value: string; isSecret?: boolean }>;
  }> = [];
  private nextQueuedRun?: Run;

  private cancelledRuns: Array<{ project: string; runId: number }> = [];
  private nextCancelledRun?: Build;

  private addedTags: Array<{ project: string; runId: number; tags: string[] }> = [];
  private removedTags: Array<{ project: string; runId: number; tag: string }> = [];
  private nextTagsState?: string[];

  setNextQueuedRun(run: Run): void {
    this.nextQueuedRun = run;
  }
  getQueuedRuns() {
    return this.queuedRuns;
  }

  setNextCancelledRun(build: Build): void {
    this.nextCancelledRun = build;
  }
  getCancelledRuns() {
    return this.cancelledRuns;
  }

  setNextTagsState(tags: string[]): void {
    this.nextTagsState = tags;
  }
  getAddedTags() {
    return this.addedTags;
  }
  getRemovedTags() {
    return this.removedTags;
  }

  async queuePipelineRun(args: {
    project: string;
    pipelineId: number;
    branch?: string;
    templateParameters?: Record<string, string>;
    variables?: Record<string, { value: string; isSecret?: boolean }>;
  }): Promise<Run> {
    this.maybeThrow("queuePipelineRun");
    this.queuedRuns.push(args);
    if (!this.nextQueuedRun) {
      throw new Error("FakeAdoClient: setNextQueuedRun not called");
    }
    return this.nextQueuedRun;
  }

  async cancelPipelineRun(args: { project: string; runId: number }): Promise<Build> {
    this.maybeThrow("cancelPipelineRun");
    this.cancelledRuns.push(args);
    if (!this.nextCancelledRun) {
      throw new Error("FakeAdoClient: setNextCancelledRun not called");
    }
    return this.nextCancelledRun;
  }

  async addBuildTags(args: { project: string; runId: number; tags: string[] }): Promise<string[]> {
    this.maybeThrow("addBuildTags");
    this.addedTags.push(args);
    return this.nextTagsState ?? args.tags;
  }

  async removeBuildTag(args: { project: string; runId: number; tag: string }): Promise<string[]> {
    this.maybeThrow("removeBuildTag");
    this.removedTags.push(args);
    return this.nextTagsState ?? [];
  }

  // ---- phase-4.1 release write state ----
  private createdReleases: Array<{ project: string; metadata: ReleaseStartMetadata }> = [];
  private nextCreatedRelease?: Release;

  private deployedEnvironments: Array<{
    project: string;
    releaseId: number;
    environmentId: number;
    update: ReleaseEnvironmentUpdateMetadata;
  }> = [];

  private cancelledReleases: Array<{ project: string; releaseId: number; comment?: string }> = [];
  private nextCancelledRelease?: Release;

  private approvedGates: Array<{
    project: string;
    approvalId: number;
    status: "approved" | "rejected";
    comment?: string;
  }> = [];
  private nextUpdatedApproval?: ReleaseApproval;

  setNextCreatedRelease(release: Release): void {
    this.nextCreatedRelease = release;
  }
  getCreatedReleases() {
    return this.createdReleases;
  }

  getDeployedEnvironments() {
    return this.deployedEnvironments;
  }

  setNextCancelledRelease(release: Release): void {
    this.nextCancelledRelease = release;
  }
  getCancelledReleases() {
    return this.cancelledReleases;
  }

  setNextUpdatedApproval(approval: ReleaseApproval): void {
    this.nextUpdatedApproval = approval;
  }
  getApprovedGates() {
    return this.approvedGates;
  }

  async createRelease(args: { project: string; metadata: ReleaseStartMetadata }): Promise<Release> {
    this.maybeThrow("createRelease");
    this.createdReleases.push(args);
    if (!this.nextCreatedRelease) {
      throw new Error("FakeAdoClient: setNextCreatedRelease not called");
    }
    return this.nextCreatedRelease;
  }

  async updateReleaseEnvironment(args: {
    project: string;
    releaseId: number;
    environmentId: number;
    update: ReleaseEnvironmentUpdateMetadata;
  }): Promise<unknown> {
    this.maybeThrow("updateReleaseEnvironment");
    this.deployedEnvironments.push(args);
    return {};
  }

  async cancelRelease(args: {
    project: string;
    releaseId: number;
    comment?: string;
  }): Promise<Release> {
    this.maybeThrow("cancelRelease");
    this.cancelledReleases.push(args);
    if (!this.nextCancelledRelease) {
      throw new Error("FakeAdoClient: setNextCancelledRelease not called");
    }
    return this.nextCancelledRelease;
  }

  async updateReleaseApproval(args: {
    project: string;
    approvalId: number;
    status: "approved" | "rejected";
    comment?: string;
  }): Promise<ReleaseApproval> {
    this.maybeThrow("updateReleaseApproval");
    this.approvedGates.push(args);
    if (!this.nextUpdatedApproval) {
      throw new Error("FakeAdoClient: setNextUpdatedApproval not called");
    }
    return this.nextUpdatedApproval;
  }

  // ---- phase-4.1 release read state ----
  private pendingApprovalsByKey = new Map<string, ReleaseApproval[]>();

  setPendingApprovals(args: { project: string; releaseId?: number }, approvals: ReleaseApproval[]): void {
    this.pendingApprovalsByKey.set(`${args.project}|${args.releaseId ?? "*"}`, approvals);
  }

  async listPendingApprovals(args: {
    project: string;
    releaseId?: number;
    assignedTo?: string;
  }): Promise<ReleaseApproval[]> {
    this.maybeThrow("listPendingApprovals");
    return (
      this.pendingApprovalsByKey.get(`${args.project}|${args.releaseId ?? "*"}`) ??
      this.pendingApprovalsByKey.get(`${args.project}|*`) ??
      []
    );
  }
```

Add the new type imports to the top of the file:

```typescript
import type {
  // existing imports …
  Run,
  ReleaseStartMetadata,
  ReleaseEnvironmentUpdateMetadata,
  ReleaseApproval,
} from "../../src/ado/types.js";
```

`maybeThrow(name)` is the existing error-injection helper — verify it exists. If the fake uses `errors.get(name)` directly, use that pattern instead.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS for `test/fakes/FakeAdoClient.ts`. The `SdkAdoClient` errors from Task 2 are still present — they're fixed in Task 12.

- [ ] **Step 4: Commit**

```bash
git add test/fakes/FakeAdoClient.ts
git commit -m "test(phase-4.1): extend FakeAdoClient with stubs for 8 new methods

Mirrors the existing per-method pattern: state arrays record args from
each call, setNextX() configures the response, getX() exposes the
recorded calls for assertions. Production SdkAdoClient impl follows in
a later task."
```

---

## Task 4: Pipeline write tool input schemas

**Files:**
- Modify: `src/domains/pipelines/schemas.ts`

- [ ] **Step 1: Read existing schemas**

Read `src/domains/pipelines/schemas.ts` to see how Phase 3 read-tool schemas are structured (naming convention, common helpers like `ProjectIdSchema`, `pipelineIdSchema`, etc.).

- [ ] **Step 2: Append the three write schemas**

Add to the end of the file:

```typescript
import { z } from "zod";
// (other existing imports unchanged)

export const QueuePipelineRunInput = z.object({
  project: z.string().min(1).describe("Project name or id"),
  pipelineId: z.number().int().positive().describe("Pipeline (build definition) id"),
  branch: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Source ref to run the pipeline on (e.g. 'refs/heads/main' or 'main'). " +
        "Omit to use the pipeline's default branch.",
    ),
  templateParameters: z
    .record(z.string(), z.string())
    .optional()
    .describe("Template parameters to override (YAML pipelines only)"),
  variables: z
    .record(
      z.string(),
      z.object({
        value: z.string(),
        isSecret: z.boolean().optional(),
      }),
    )
    .optional()
    .describe("Run-scoped variable overrides"),
});

export const CancelPipelineRunInput = z.object({
  project: z.string().min(1),
  runId: z.number().int().positive().describe("Build/run id"),
});

export const UpdateBuildTagsInput = z
  .object({
    project: z.string().min(1),
    runId: z.number().int().positive(),
    addTags: z.array(z.string().min(1)).optional(),
    removeTags: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => (v.addTags?.length ?? 0) + (v.removeTags?.length ?? 0) > 0, {
    message: "Provide at least one tag in addTags or removeTags",
  });
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/domains/pipelines/schemas.ts
git commit -m "feat(phase-4.1): add Zod schemas for pipeline write tools"
```

---

## Task 5: PipelinesWriteService (TDD)

**Files:**
- Create: `src/domains/pipelines/writeService.ts`
- Create: `test/unit/domains/pipelines/writeService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/domains/pipelines/writeService.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { PipelinesWriteService } from "../../../../src/domains/pipelines/writeService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type { Run, Build } from "../../../../src/ado/types.js";

function makeSvc() {
  const fake = new FakeAdoClient();
  const svc = new PipelinesWriteService(fake);
  return { svc, fake };
}

describe("PipelinesWriteService.queueRun", () => {
  it("passes project + pipelineId through and converts branch shorthand to refs/heads/<name>", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextQueuedRun({ id: 999, name: "20260518.1", url: "https://x/runs/999" } as Run);
    const result = await svc.queueRun({
      project: "Proj",
      pipelineId: 7,
      branch: "main",
    });
    const calls = fake.getQueuedRuns();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.project).toBe("Proj");
    expect(calls[0]?.pipelineId).toBe(7);
    expect(calls[0]?.branch).toBe("refs/heads/main");
    expect(result.runId).toBe(999);
    expect(result.url).toBe("https://x/runs/999");
  });

  it("leaves fully-qualified refs alone", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextQueuedRun({ id: 1, url: "x" } as Run);
    await svc.queueRun({ project: "p", pipelineId: 1, branch: "refs/heads/release/v2" });
    expect(fake.getQueuedRuns()[0]?.branch).toBe("refs/heads/release/v2");
  });

  it("omits branch when not provided", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextQueuedRun({ id: 1, url: "x" } as Run);
    await svc.queueRun({ project: "p", pipelineId: 1 });
    expect(fake.getQueuedRuns()[0]?.branch).toBeUndefined();
  });

  it("forwards templateParameters + variables verbatim", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextQueuedRun({ id: 1, url: "x" } as Run);
    await svc.queueRun({
      project: "p",
      pipelineId: 1,
      templateParameters: { env: "prod" },
      variables: { FOO: { value: "bar", isSecret: true } },
    });
    const call = fake.getQueuedRuns()[0]!;
    expect(call.templateParameters).toEqual({ env: "prod" });
    expect(call.variables).toEqual({ FOO: { value: "bar", isSecret: true } });
  });
});

describe("PipelinesWriteService.cancelRun", () => {
  it("calls the client with project + runId and returns shaped result", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextCancelledRun({ id: 42, status: 4 } as Build);
    const result = await svc.cancelRun({ project: "p", runId: 42 });
    expect(fake.getCancelledRuns()).toEqual([{ project: "p", runId: 42 }]);
    expect(result.runId).toBe(42);
    expect(result.status).toBe("cancelling");
  });
});

describe("PipelinesWriteService.updateTags", () => {
  it("calls addBuildTags once when only addTags provided", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextTagsState(["a", "b"]);
    const result = await svc.updateTags({
      project: "p",
      runId: 1,
      addTags: ["a", "b"],
    });
    expect(fake.getAddedTags()).toEqual([{ project: "p", runId: 1, tags: ["a", "b"] }]);
    expect(fake.getRemovedTags()).toEqual([]);
    expect(result.tags).toEqual(["a", "b"]);
  });

  it("loops removeBuildTag once per tag when only removeTags provided", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextTagsState([]);
    await svc.updateTags({ project: "p", runId: 1, removeTags: ["x", "y"] });
    expect(fake.getRemovedTags()).toEqual([
      { project: "p", runId: 1, tag: "x" },
      { project: "p", runId: 1, tag: "y" },
    ]);
    expect(fake.getAddedTags()).toEqual([]);
  });

  it("does both when both arrays present", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextTagsState(["a"]);
    await svc.updateTags({
      project: "p",
      runId: 1,
      addTags: ["a"],
      removeTags: ["old"],
    });
    expect(fake.getAddedTags()).toHaveLength(1);
    expect(fake.getRemovedTags()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/domains/pipelines/writeService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `src/domains/pipelines/writeService.ts`:

```typescript
import type { AdoClient } from "../../ado/client.js";
import type { BuildStatus } from "../../ado/types.js";

const BUILD_STATUS_FROM_ENUM: Record<number, string> = {
  0: "none",
  1: "inProgress",
  2: "completed",
  4: "cancelling",
  8: "postponed",
  32: "notStarted",
  64: "all",
};

function ensureRefsHeads(branch?: string): string | undefined {
  if (!branch) return undefined;
  return branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
}

export interface QueueRunResult {
  runId: number;
  name?: string;
  url?: string;
}

export interface CancelRunResult {
  runId: number;
  status: string;
}

export interface UpdateTagsResult {
  tags: string[];
}

export class PipelinesWriteService {
  constructor(private readonly client: AdoClient) {}

  async queueRun(args: {
    project: string;
    pipelineId: number;
    branch?: string;
    templateParameters?: Record<string, string>;
    variables?: Record<string, { value: string; isSecret?: boolean }>;
  }): Promise<QueueRunResult> {
    const run = await this.client.queuePipelineRun({
      project: args.project,
      pipelineId: args.pipelineId,
      branch: ensureRefsHeads(args.branch),
      templateParameters: args.templateParameters,
      variables: args.variables,
    });
    return {
      runId: run.id ?? 0,
      name: run.name,
      url: (run as { url?: string }).url,
    };
  }

  async cancelRun(args: { project: string; runId: number }): Promise<CancelRunResult> {
    const build = await this.client.cancelPipelineRun({
      project: args.project,
      runId: args.runId,
    });
    return {
      runId: build.id ?? args.runId,
      status: BUILD_STATUS_FROM_ENUM[(build.status as BuildStatus) ?? 0] ?? "unknown",
    };
  }

  async updateTags(args: {
    project: string;
    runId: number;
    addTags?: string[];
    removeTags?: string[];
  }): Promise<UpdateTagsResult> {
    let latest: string[] = [];
    if (args.addTags && args.addTags.length > 0) {
      latest = await this.client.addBuildTags({
        project: args.project,
        runId: args.runId,
        tags: args.addTags,
      });
    }
    if (args.removeTags && args.removeTags.length > 0) {
      for (const tag of args.removeTags) {
        latest = await this.client.removeBuildTag({
          project: args.project,
          runId: args.runId,
          tag,
        });
      }
    }
    return { tags: latest };
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/domains/pipelines/writeService.test.ts`
Expected: PASS (all 7 tests above).

- [ ] **Step 5: Commit**

```bash
git add src/domains/pipelines/writeService.ts test/unit/domains/pipelines/writeService.test.ts
git commit -m "feat(phase-4.1): add PipelinesWriteService (queue / cancel / update tags)"
```

---

## Task 6: pipelines/writeTools.ts — MCP tool registration

**Files:**
- Create: `src/domains/pipelines/writeTools.ts`

- [ ] **Step 1: Read the existing pattern**

Read `src/domains/pullRequests/writeTools.ts` to copy the structure (`buildXWriteTools(svc): ToolDefinition[]` returning an array of `{ name, config: { title, description, inputSchema }, handler }`).

- [ ] **Step 2: Implement the file**

Create `src/domains/pipelines/writeTools.ts`:

```typescript
import type { PipelinesWriteService } from "./writeService.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  QueuePipelineRunInput,
  CancelPipelineRunInput,
  UpdateBuildTagsInput,
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
      handler: async (args) =>
        svc.queueRun(args as Parameters<typeof svc.queueRun>[0]),
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
      handler: async (args) =>
        svc.cancelRun(args as Parameters<typeof svc.cancelRun>[0]),
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
      handler: async (args) =>
        svc.updateTags(args as Parameters<typeof svc.updateTags>[0]),
    },
  ];
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS for this file. (SdkAdoClient errors from Task 2 remain.)

- [ ] **Step 4: Commit**

```bash
git add src/domains/pipelines/writeTools.ts
git commit -m "feat(phase-4.1): add MCP tool definitions for pipeline writes"
```

---

## Task 7: Release write schemas + list_pending_approvals schema

**Files:**
- Modify: `src/domains/releases/schemas.ts`

- [ ] **Step 1: Read existing release schemas**

Read `src/domains/releases/schemas.ts` for naming and helper patterns.

- [ ] **Step 2: Append the five schemas**

```typescript
export const CreateReleaseInput = z.object({
  project: z.string().min(1),
  definitionId: z.number().int().positive().describe("Release definition id"),
  description: z.string().optional(),
  artifacts: z
    .array(
      z.object({
        alias: z.string().min(1).describe("Artifact alias from the release definition"),
        buildId: z.number().int().positive().describe("Build id to bind to the alias"),
      }),
    )
    .optional()
    .describe("Artifact bindings. Omit to use the definition's default artifact resolution."),
  variables: z
    .record(z.string(), z.object({ value: z.string(), isSecret: z.boolean().optional() }))
    .optional()
    .describe("Release-scoped variable overrides"),
});

export const DeployReleaseStageInput = z.object({
  project: z.string().min(1),
  releaseId: z.number().int().positive(),
  environmentName: z.string().min(1).describe("Stage name (e.g. 'Production')"),
  comment: z.string().optional(),
});

export const ApproveReleaseGateInput = z.object({
  project: z.string().min(1),
  approvalId: z.number().int().positive(),
  status: z.enum(["approved", "rejected"]),
  comment: z.string().optional(),
});

export const CancelReleaseInput = z.object({
  project: z.string().min(1),
  releaseId: z.number().int().positive(),
  comment: z.string().optional(),
});

export const ListPendingApprovalsInput = z.object({
  project: z.string().min(1),
  releaseId: z.number().int().positive().optional(),
  assignedTo: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Identity descriptor or display name. Omit for all pending approvals in the project.",
    ),
});
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/domains/releases/schemas.ts
git commit -m "feat(phase-4.1): add Zod schemas for release writes + list_pending_approvals"
```

---

## Task 8: ReleasesWriteService (TDD)

**Files:**
- Create: `src/domains/releases/writeService.ts`
- Create: `test/unit/domains/releases/writeService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/domains/releases/writeService.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ReleasesWriteService } from "../../../../src/domains/releases/writeService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type { Release, ReleaseApproval, Build } from "../../../../src/ado/types.js";

function makeSvc() {
  const fake = new FakeAdoClient();
  const svc = new ReleasesWriteService(fake);
  return { svc, fake };
}

describe("ReleasesWriteService.createRelease", () => {
  it("forwards definitionId + description + variables", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextCreatedRelease({ id: 5, name: "Release-5", environments: [] } as unknown as Release);
    const result = await svc.createRelease({
      project: "p",
      definitionId: 11,
      description: "test run",
      variables: { ENV: { value: "stg" } },
    });
    const call = fake.getCreatedReleases()[0]!;
    expect(call.project).toBe("p");
    expect(call.metadata.definitionId).toBe(11);
    expect(call.metadata.description).toBe("test run");
    expect(call.metadata.variables).toEqual({ ENV: { value: "stg" } });
    expect(result.releaseId).toBe(5);
    expect(result.name).toBe("Release-5");
  });

  it("shapes artifacts to { alias, instanceReference: { id, name } } using getBuild for the name", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextCreatedRelease({ id: 6, name: "R6", environments: [] } as unknown as Release);
    fake.setNextBuild({ id: 100, buildNumber: "20260518.1" } as Build);
    await svc.createRelease({
      project: "p",
      definitionId: 1,
      artifacts: [{ alias: "drop", buildId: 100 }],
    });
    const sent = fake.getCreatedReleases()[0]!.metadata.artifacts!;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      alias: "drop",
      instanceReference: { id: "100", name: "20260518.1" },
    });
  });

  it("omits artifacts entirely when not provided", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextCreatedRelease({ id: 1 } as unknown as Release);
    await svc.createRelease({ project: "p", definitionId: 1 });
    expect(fake.getCreatedReleases()[0]!.metadata.artifacts).toBeUndefined();
  });
});

describe("ReleasesWriteService.deployStage", () => {
  it("resolves environmentName to environmentId via getRelease and sends status=inProgress", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextRelease({
      id: 5,
      environments: [
        { id: 10, name: "Dev" },
        { id: 20, name: "Production" },
      ],
    } as unknown as Release);
    await svc.deployStage({
      project: "p",
      releaseId: 5,
      environmentName: "Production",
      comment: "go",
    });
    const call = fake.getDeployedEnvironments()[0]!;
    expect(call.releaseId).toBe(5);
    expect(call.environmentId).toBe(20);
    expect(call.update.status).toBe(2); // EnvironmentStatus.InProgress
    expect(call.update.comment).toBe("go");
  });

  it("throws when environmentName not found", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextRelease({ id: 5, environments: [{ id: 10, name: "Dev" }] } as unknown as Release);
    await expect(
      svc.deployStage({ project: "p", releaseId: 5, environmentName: "Production" }),
    ).rejects.toThrow(/Production/);
  });
});

describe("ReleasesWriteService.approveGate", () => {
  it("maps 'approved' → ApprovalStatus.Approved (4)", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextUpdatedApproval({ id: 42, status: 4 } as ReleaseApproval);
    const result = await svc.approveGate({
      project: "p",
      approvalId: 42,
      status: "approved",
      comment: "ok",
    });
    const call = fake.getApprovedGates()[0]!;
    expect(call.status).toBe("approved");
    expect(call.comment).toBe("ok");
    expect(result.approvalId).toBe(42);
    expect(result.status).toBe("approved");
  });

  it("maps 'rejected' → ApprovalStatus.Rejected (8)", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextUpdatedApproval({ id: 1, status: 8 } as ReleaseApproval);
    const result = await svc.approveGate({ project: "p", approvalId: 1, status: "rejected" });
    expect(result.status).toBe("rejected");
  });
});

describe("ReleasesWriteService.cancelRelease", () => {
  it("calls client with project + releaseId + comment and returns shaped result", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextCancelledRelease({ id: 9, status: 4, name: "R9" } as unknown as Release);
    const result = await svc.cancelRelease({ project: "p", releaseId: 9, comment: "ship later" });
    expect(fake.getCancelledReleases()).toEqual([{ project: "p", releaseId: 9, comment: "ship later" }]);
    expect(result.releaseId).toBe(9);
    expect(result.status).toBe("abandoned");
  });
});
```

You'll also need to make sure `FakeAdoClient` has `setNextBuild` + `getBuild` for the `createRelease` artifact-name-lookup test. Read the fake to confirm — Phase 3 already added these; if not, add them in the same task before the implementation step.

- [ ] **Step 2: Run, confirm failure**

Run: `npm test -- test/unit/domains/releases/writeService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `src/domains/releases/writeService.ts`:

```typescript
import type { AdoClient } from "../../ado/client.js";
import type {
  Release,
  ReleaseStartMetadata,
  ReleaseEnvironmentUpdateMetadata,
} from "../../ado/types.js";

// ReleaseStatus enum (from ReleaseInterfaces): 1=draft, 2=active, 4=abandoned.
const RELEASE_STATUS_FROM_ENUM: Record<number, string> = {
  1: "draft",
  2: "active",
  4: "abandoned",
};

// ApprovalStatus enum (from ReleaseInterfaces): 1=pending, 2=approved (wait — verify),
// 4=approved, 8=rejected, 16=reassigned, 32=canceled. The numbers in the SDK source are:
// 0=undefined, 1=pending, 2=approved, 4=rejected, 16=reassigned, 32=canceled, 64=skipped.
// Cross-check against the enum file before relying on these values.
const APPROVAL_STATUS_TO_ENUM: Record<"approved" | "rejected", number> = {
  approved: 2,
  rejected: 4,
};
const APPROVAL_STATUS_FROM_ENUM: Record<number, string> = {
  0: "undefined",
  1: "pending",
  2: "approved",
  4: "rejected",
  16: "reassigned",
  32: "canceled",
  64: "skipped",
};

export interface CreateReleaseResult {
  releaseId: number;
  name?: string;
  environments: { id: number; name: string; status?: string }[];
}

export interface DeployStageResult {
  releaseId: number;
  environmentId: number;
  environmentName: string;
}

export interface ApproveGateResult {
  approvalId: number;
  status: string;
}

export interface CancelReleaseResult {
  releaseId: number;
  status: string;
}

export class ReleasesWriteService {
  constructor(private readonly client: AdoClient) {}

  async createRelease(args: {
    project: string;
    definitionId: number;
    description?: string;
    artifacts?: { alias: string; buildId: number }[];
    variables?: Record<string, { value: string; isSecret?: boolean }>;
  }): Promise<CreateReleaseResult> {
    let shapedArtifacts: ReleaseStartMetadata["artifacts"] | undefined;
    if (args.artifacts && args.artifacts.length > 0) {
      shapedArtifacts = [];
      for (const a of args.artifacts) {
        const build = await this.client.getBuild({
          project: args.project,
          buildId: a.buildId,
        });
        shapedArtifacts.push({
          alias: a.alias,
          instanceReference: {
            id: String(a.buildId),
            name: build.buildNumber ?? String(a.buildId),
          },
        });
      }
    }

    const metadata: ReleaseStartMetadata = {
      definitionId: args.definitionId,
      description: args.description,
      artifacts: shapedArtifacts,
      variables: args.variables,
    };

    const release = await this.client.createRelease({
      project: args.project,
      metadata,
    });

    return {
      releaseId: release.id ?? 0,
      name: release.name,
      environments: (release.environments ?? []).map((e) => ({
        id: e.id ?? 0,
        name: e.name ?? "",
        status: typeof e.status === "number" ? String(e.status) : undefined,
      })),
    };
  }

  async deployStage(args: {
    project: string;
    releaseId: number;
    environmentName: string;
    comment?: string;
  }): Promise<DeployStageResult> {
    const release = await this.client.getRelease({
      project: args.project,
      releaseId: args.releaseId,
    });
    const env = (release.environments ?? []).find(
      (e) => e.name?.toLowerCase() === args.environmentName.toLowerCase(),
    );
    if (!env || env.id == null) {
      const available = (release.environments ?? []).map((e) => e.name).join(", ");
      throw new Error(
        `Environment '${args.environmentName}' not found on release ${args.releaseId}. ` +
          `Available: ${available || "(none)"}`,
      );
    }

    const update: ReleaseEnvironmentUpdateMetadata = {
      status: 2, // EnvironmentStatus.InProgress
      comment: args.comment,
    };

    await this.client.updateReleaseEnvironment({
      project: args.project,
      releaseId: args.releaseId,
      environmentId: env.id,
      update,
    });

    return {
      releaseId: args.releaseId,
      environmentId: env.id,
      environmentName: env.name ?? args.environmentName,
    };
  }

  async approveGate(args: {
    project: string;
    approvalId: number;
    status: "approved" | "rejected";
    comment?: string;
  }): Promise<ApproveGateResult> {
    const result = await this.client.updateReleaseApproval({
      project: args.project,
      approvalId: args.approvalId,
      status: args.status,
      comment: args.comment,
    });
    return {
      approvalId: result.id ?? args.approvalId,
      status: APPROVAL_STATUS_FROM_ENUM[(result.status as number) ?? 0] ?? "unknown",
    };
  }

  async cancelRelease(args: {
    project: string;
    releaseId: number;
    comment?: string;
  }): Promise<CancelReleaseResult> {
    const release = await this.client.cancelRelease(args);
    return {
      releaseId: release.id ?? args.releaseId,
      status: RELEASE_STATUS_FROM_ENUM[(release.status as number) ?? 0] ?? "unknown",
    };
  }
}
```

**Critical: enum values.** The `ApprovalStatus` and `ReleaseStatus` enum values are read from `azure-devops-node-api/interfaces/ReleaseInterfaces.d.ts`. Before committing this task, open that file and confirm the numeric mappings above. If they differ, update the maps and the test expectations.

The `SdkAdoClient.updateReleaseApproval` implementation in Task 12 is responsible for translating the `"approved" | "rejected"` string in the args back to the SDK's numeric `ApprovalStatus` before sending. The service layer uses strings end-to-end.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/domains/releases/writeService.test.ts`
Expected: PASS (all tests above).

- [ ] **Step 5: Commit**

```bash
git add src/domains/releases/writeService.ts test/unit/domains/releases/writeService.test.ts
git commit -m "feat(phase-4.1): add ReleasesWriteService (create / deploy / approve / cancel)"
```

---

## Task 9: list_pending_approvals on ReleasesReadService (TDD)

**Files:**
- Modify: `src/domains/releases/readService.ts`
- Modify: `test/unit/domains/releases/readService.test.ts` (or create file)

- [ ] **Step 1: Write the failing test**

Append to (or create) `test/unit/domains/releases/readService.test.ts`:

```typescript
describe("ReleasesReadService.listPendingApprovals", () => {
  it("returns shaped approval list filtered by project", async () => {
    const fake = new FakeAdoClient();
    const svc = new ReleasesReadService(fake);
    fake.setPendingApprovals({ project: "p" }, [
      {
        id: 1,
        release: { id: 10, name: "R10" },
        releaseEnvironment: { id: 20, name: "Prod" },
        approver: { displayName: "Alice" },
        createdOn: new Date("2026-05-18T10:00:00Z"),
      } as unknown as ReleaseApproval,
    ]);
    const result = await svc.listPendingApprovals({ project: "p" });
    expect(result).toEqual([
      {
        approvalId: 1,
        releaseId: 10,
        releaseName: "R10",
        environmentName: "Prod",
        approver: "Alice",
        createdOn: "2026-05-18T10:00:00.000Z",
      },
    ]);
  });

  it("forwards releaseId + assignedTo to the client", async () => {
    const fake = new FakeAdoClient();
    const svc = new ReleasesReadService(fake);
    fake.setPendingApprovals({ project: "p", releaseId: 5 }, []);
    await svc.listPendingApprovals({ project: "p", releaseId: 5, assignedTo: "Alice" });
    expect(fake.getPendingApprovalsCalls()).toEqual([
      { project: "p", releaseId: 5, assignedTo: "Alice" },
    ]);
  });
});
```

Before running this test, extend `FakeAdoClient.listPendingApprovals` (added in Task 3) to record its args. Add:

```typescript
  private pendingApprovalsCalls: Array<{
    project: string;
    releaseId?: number;
    assignedTo?: string;
  }> = [];

  getPendingApprovalsCalls() {
    return this.pendingApprovalsCalls;
  }
```

…and push to it inside `listPendingApprovals` (before the existing `return` statement):

```typescript
    this.pendingApprovalsCalls.push(args);
```

This is a small follow-up to Task 3 — if you implemented Task 3 as written, the recording isn't there yet.

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- test/unit/domains/releases/readService.test.ts`
Expected: FAIL — `listPendingApprovals` not defined on service.

- [ ] **Step 3: Implement on the service**

Append to `src/domains/releases/readService.ts` (inside the `ReleasesReadService` class):

```typescript
  async listPendingApprovals(args: {
    project: string;
    releaseId?: number;
    assignedTo?: string;
  }): Promise<
    {
      approvalId: number;
      releaseId: number;
      releaseName: string;
      environmentName: string;
      approver: string | null;
      createdOn: string | null;
    }[]
  > {
    const approvals = await this.client.listPendingApprovals(args);
    return approvals.map((a) => ({
      approvalId: a.id ?? 0,
      releaseId: a.release?.id ?? 0,
      releaseName: a.release?.name ?? "",
      environmentName: a.releaseEnvironment?.name ?? "",
      approver: a.approver?.displayName ?? null,
      createdOn:
        a.createdOn instanceof Date ? a.createdOn.toISOString() : (a.createdOn ?? null),
    }));
  }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/domains/releases/readService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/releases/readService.ts test/unit/domains/releases/readService.test.ts
git commit -m "feat(phase-4.1): add listPendingApprovals to ReleasesReadService"
```

---

## Task 10: releases/writeTools.ts

**Files:**
- Create: `src/domains/releases/writeTools.ts`

- [ ] **Step 1: Implement**

```typescript
import type { ReleasesWriteService } from "./writeService.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  CreateReleaseInput,
  DeployReleaseStageInput,
  ApproveReleaseGateInput,
  CancelReleaseInput,
} from "./schemas.js";

export function buildReleaseWriteTools(svc: ReleasesWriteService): ToolDefinition[] {
  return [
    {
      name: "create_release",
      config: {
        title: "Create a release from a definition",
        description:
          "Creates a new release for the given release definition. `artifacts` binds aliases to " +
          "build ids; omit to use the definition's default artifact resolution. `variables` overrides " +
          "release-scoped variables. Returns the new release id and its environment list so you can " +
          "chain `deploy_release_stage` or `list_deployments`.",
        inputSchema: CreateReleaseInput,
      },
      handler: async (args) =>
        svc.createRelease(args as Parameters<typeof svc.createRelease>[0]),
    },
    {
      name: "deploy_release_stage",
      config: {
        title: "Manually deploy a release stage",
        description:
          "Manually triggers deployment of one environment (stage) on an existing release. " +
          "Always confirm with the user before calling — this deploys to a live environment.",
        inputSchema: DeployReleaseStageInput,
      },
      handler: async (args) =>
        svc.deployStage(args as Parameters<typeof svc.deployStage>[0]),
    },
    {
      name: "approve_release_gate",
      config: {
        title: "Approve or reject a release approval gate",
        description:
          "Sets the status of a pre- or post-deploy approval. Use `list_pending_approvals` to find " +
          "approvalId. Always confirm with the user before calling — your name is recorded on the " +
          "approval and is visible to everyone watching the release.",
        inputSchema: ApproveReleaseGateInput,
      },
      handler: async (args) =>
        svc.approveGate(args as Parameters<typeof svc.approveGate>[0]),
    },
    {
      name: "cancel_release",
      config: {
        title: "Abandon a release",
        description:
          "Marks an in-flight release as abandoned. Already-abandoned releases return a clear " +
          "conflict error.",
        inputSchema: CancelReleaseInput,
      },
      handler: async (args) =>
        svc.cancelRelease(args as Parameters<typeof svc.cancelRelease>[0]),
    },
  ];
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/domains/releases/writeTools.ts
git commit -m "feat(phase-4.1): add MCP tool definitions for release writes"
```

---

## Task 11: Add list_pending_approvals to releases/readTools.ts

**Files:**
- Modify: `src/domains/releases/readTools.ts`

- [ ] **Step 1: Add the tool entry**

Read the file and add the following entry (place it after `list_deployments` to keep approvals near deployments):

```typescript
    {
      name: "list_pending_approvals",
      config: {
        title: "List pending release approvals",
        description:
          "Lists release approvals currently in 'pending' state for the project. Optional " +
          "`releaseId` narrows to one release; optional `assignedTo` filters by approver identity " +
          "(display name or descriptor). Use the returned `approvalId` with `approve_release_gate`.",
        inputSchema: ListPendingApprovalsInput,
      },
      handler: async (args) =>
        svc.listPendingApprovals(args as Parameters<typeof svc.listPendingApprovals>[0]),
    },
```

Import `ListPendingApprovalsInput` from `./schemas.js`.

- [ ] **Step 2: Commit**

```bash
git add src/domains/releases/readTools.ts
git commit -m "feat(phase-4.1): expose list_pending_approvals as an MCP tool"
```

---

## Task 12: Implement the 8 new methods on SdkAdoClient

**Files:**
- Modify: `src/ado/sdkClient.ts`

- [ ] **Step 1: Read the file**

Read `src/ado/sdkClient.ts` to see how existing methods are organized (per-API getter caching, error wrapping pattern via `wrapAdoCall(name, fn)` or equivalent).

- [ ] **Step 2: Add a PipelinesApi getter if not present**

If `SdkAdoClient` doesn't already memoize `getPipelinesApi`, add it next to the existing `getBuildApi` / `getReleaseApi` / etc. getters:

```typescript
  private pipelinesApi?: Promise<PipelinesApi>;
  private getPipelines(): Promise<PipelinesApi> {
    return (this.pipelinesApi ??= this.connection.getPipelinesApi());
  }
```

Add `import type { PipelinesApi } from "azure-devops-node-api/PipelinesApi.js";` and `RunPipelineParameters` import.

- [ ] **Step 3: Implement the 8 methods**

Append the following to `SdkAdoClient`. Wrap each in the same error-mapping helper used by existing methods (call it `wrapAdoCall` or whatever the file uses). The error wrapper is what turns 401/403/404/409 into `AdoScopeError` / `AdoAuthError` / `AdoNotFoundError` / `AdoConflictError`.

```typescript
  async queuePipelineRun(args: {
    project: string;
    pipelineId: number;
    branch?: string;
    templateParameters?: Record<string, string>;
    variables?: Record<string, { value: string; isSecret?: boolean }>;
  }): Promise<Run> {
    return wrapAdoCall("queuePipelineRun", async () => {
      const pipelines = await this.getPipelines();
      const runParameters: RunPipelineParameters = {
        templateParameters: args.templateParameters,
        variables: args.variables,
        resources: args.branch
          ? {
              repositories: {
                self: { refName: args.branch },
              },
            }
          : undefined,
      };
      return pipelines.runPipeline(runParameters, args.project, args.pipelineId);
    });
  }

  async cancelPipelineRun(args: { project: string; runId: number }): Promise<Build> {
    return wrapAdoCall("cancelPipelineRun", async () => {
      const build = await this.getBuild();
      return build.updateBuild(
        { status: 4 /* BuildStatus.Cancelling */ } as Build,
        args.project,
        args.runId,
      );
    });
  }

  async addBuildTags(args: { project: string; runId: number; tags: string[] }): Promise<string[]> {
    return wrapAdoCall("addBuildTags", async () => {
      const build = await this.getBuild();
      return build.addBuildTags(args.tags, args.project, args.runId);
    });
  }

  async removeBuildTag(args: { project: string; runId: number; tag: string }): Promise<string[]> {
    return wrapAdoCall("removeBuildTag", async () => {
      const build = await this.getBuild();
      return build.deleteBuildTag(args.project, args.runId, args.tag);
    });
  }

  async createRelease(args: {
    project: string;
    metadata: ReleaseStartMetadata;
  }): Promise<Release> {
    return wrapAdoCall("createRelease", async () => {
      const release = await this.getRelease();
      return release.createRelease(args.metadata, args.project);
    });
  }

  async updateReleaseEnvironment(args: {
    project: string;
    releaseId: number;
    environmentId: number;
    update: ReleaseEnvironmentUpdateMetadata;
  }): Promise<unknown> {
    return wrapAdoCall("updateReleaseEnvironment", async () => {
      const release = await this.getRelease();
      return release.updateReleaseEnvironment(
        args.update,
        args.project,
        args.releaseId,
        args.environmentId,
      );
    });
  }

  async cancelRelease(args: {
    project: string;
    releaseId: number;
    comment?: string;
  }): Promise<Release> {
    return wrapAdoCall("cancelRelease", async () => {
      const release = await this.getRelease();
      return release.updateRelease(
        { status: 4 /* ReleaseStatus.Abandoned */, comment: args.comment } as Release,
        args.project,
        args.releaseId,
      );
    });
  }

  async updateReleaseApproval(args: {
    project: string;
    approvalId: number;
    status: "approved" | "rejected";
    comment?: string;
  }): Promise<ReleaseApproval> {
    return wrapAdoCall("updateReleaseApproval", async () => {
      const release = await this.getRelease();
      const numericStatus = args.status === "approved" ? 2 : 4; // ApprovalStatus enum
      return release.updateReleaseApproval(
        { status: numericStatus, comments: args.comment } as ReleaseApproval,
        args.project,
        args.approvalId,
      );
    });
  }

  async listPendingApprovals(args: {
    project: string;
    releaseId?: number;
    assignedTo?: string;
  }): Promise<ReleaseApproval[]> {
    return wrapAdoCall("listPendingApprovals", async () => {
      const release = await this.getRelease();
      const result = await release.getApprovals(
        args.project,
        args.assignedTo,
        1 /* ApprovalStatus.Pending */,
        args.releaseId ? [args.releaseId] : undefined,
      );
      // PagedList — cast to array (the SDK returns an array-like with paging metadata).
      return Array.from(result ?? []);
    });
  }
```

**Verify the enum numbers** (`ApprovalStatus.Pending=1`, `ApprovalStatus.Approved=2`, `ApprovalStatus.Rejected=4`, `ReleaseStatus.Abandoned=4`, `BuildStatus.Cancelling=4`, `EnvironmentStatus.InProgress=2`) against the `azure-devops-node-api/interfaces/{Release,Build}Interfaces.d.ts` files before committing. Adjust both this file and the service's reverse-mapping tables if they differ.

- [ ] **Step 4: Run full test + typecheck**

```
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ado/sdkClient.ts
git commit -m "feat(phase-4.1): implement 8 new methods on SdkAdoClient

queuePipelineRun (PipelinesApi.runPipeline), cancelPipelineRun
(BuildApi.updateBuild status=cancelling), addBuildTags / removeBuildTag,
createRelease, updateReleaseEnvironment (status=inProgress),
cancelRelease (status=abandoned), updateReleaseApproval
(string→enum mapping), listPendingApprovals (getApprovals statusFilter
=pending). Error wrapping reuses the existing layer; 401/403 with scope
hints now surface as AdoScopeError."
```

---

## Task 13: Wire new tools into registerAllTools

**Files:**
- Modify: `src/mcp/registerTools.ts`

- [ ] **Step 1: Read existing registration**

Open `src/mcp/registerTools.ts` and review how `buildPullRequestWriteTools` is gated by `options.readOnly`.

- [ ] **Step 2: Add the four new imports and wiring**

Add imports:

```typescript
import { PipelinesWriteService } from "../domains/pipelines/writeService.js";
import { buildPipelineWriteTools } from "../domains/pipelines/writeTools.js";
import { ReleasesWriteService } from "../domains/releases/writeService.js";
import { buildReleaseWriteTools } from "../domains/releases/writeTools.js";
```

In `registerAllTools`, find where `writeTools` is constructed (the PR-write block) and extend it:

```typescript
  const writeTools = options.readOnly
    ? []
    : [
        ...buildPullRequestWriteTools(new PullRequestsWriteService(client)),
        ...buildPipelineWriteTools(new PipelinesWriteService(client)),
        ...buildReleaseWriteTools(new ReleasesWriteService(client)),
      ];
```

`list_pending_approvals` is registered automatically because `buildReleaseReadTools` is already called for read tools — the Task 11 change picks it up.

- [ ] **Step 3: Full test + typecheck + run dev**

```
npm run typecheck
npm test
```

Expected: PASS.

Optionally smoke-test by starting the MCP in dev mode (`npm run dev` then send a `tools/list` request via the MCP inspector or `ListTools` call) and confirm the 8 new tools appear when `AZURE_DEVOPS_READ_ONLY` is unset.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/registerTools.ts
git commit -m "feat(phase-4.1): wire pipeline + release write tools into registerAllTools

Gated by options.readOnly (same plumbing as PR-write tools). The new
list_pending_approvals read tool registers unconditionally via the
existing buildReleaseReadTools call."
```

---

## Task 14: Update setup wizard scope text

**Files:**
- Modify: `src/setup.ts`

- [ ] **Step 1: Edit the scope-list printout**

In `src/setup.ts`, find the existing `process.stdout.write("Required PAT scopes:\n…")` block (around lines 11–17) and replace with:

```typescript
  process.stdout.write(
    "Required PAT scopes:\n" +
      "  Read access:   Code (read), Identity (read), Build (read), Release (read)\n" +
      "  Write access:  also add Code (write), Pull Request (write), Build (read & execute), Release (read, write, & execute)\n" +
      "If you only want read tools, use a read-only PAT or set AZURE_DEVOPS_READ_ONLY=true.\n\n",
  );
```

- [ ] **Step 2: Commit**

```bash
git add src/setup.ts
git commit -m "docs(setup): list Build and Release write scopes for Phase 4.1 tools"
```

---

## Task 15: ROADMAP — mark Phase 2.2 shipped + add Phase 4.1 section + fix Phase 4 stub

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Replace the Phase 2.2 planned block with a shipped block**

In `docs/ROADMAP.md`, find the `## 🟡 Phase 2.2 — PR comments, votes & edits` block (added in PR #4) and replace it with:

```markdown
## ✅ Phase 2.2 — PR comments, votes & edits

**Status:** shipped (commit `091ef83`, released in v0.4.0 / v0.5.0).

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

**Cross-cutting:** all tools registered behind the existing `AZURE_DEVOPS_READ_ONLY` gate; `vote_on_pull_request` includes the "always confirm before calling" line in its description; 409 mapping (already-resolved threads, etc.) uses the existing `AdoConflictError`. PAT scopes already requested as part of Phase 2.1 setup.
```

- [ ] **Step 2: Add a Phase 4.1 ✅ block before the existing Phase 4 entry**

If there's no Phase 4 entry in ROADMAP yet, add Phase 4.1 between the Phase 3.1 block and the Phase 5 (Work items) block. If there's a placeholder Phase 4 entry, replace its tools table with the 4.1 shipped block:

```markdown
## ✅ Phase 4.1 — Pipeline & release run actions

**Status:** shipped <date when the implementation PR merges>.

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
| `list_pending_approvals` (read) | companion query for approve_release_gate |

**Key decisions made / locked here:**
- **All native SDK.** Every tool maps to a typed method on `azure-devops-node-api` (`BuildApi`, `PipelinesApi`, `ReleaseApi`) — no raw HTTP introduced.
- **`retry_pipeline_stage` deferred** to Phase 4.2 because the Pipelines REST stage-retry endpoint isn't wrapped by the SDK; YAML re-run via `queue_pipeline_run` is the workaround.
- **`AdoScopeError`** maps 401/403 with scope hints (body or URL path) to a specific message naming the missing PAT scope. Generic 401/403 still surfaces as `AdoAuthError`.
- **Setup wizard scope list** updated; no live probing — runtime errors catch drift.
- **Confirmation pattern:** `deploy_release_stage` and `approve_release_gate` include "always confirm before calling" in their tool description, matching the Phase 2.x pattern (`vote_on_pull_request`, `complete_pull_request`).
- **No idempotency wrappers.** Cancelling an already-completed run / abandoned release / etc. propagates as `AdoConflictError` — the caller decides whether to ignore.

**Plan:** `docs/superpowers/plans/2026-05-18-azure-devops-mcp-phase-4-1.md`. Spec: `docs/superpowers/specs/2026-05-18-azure-devops-mcp-phase-4-1-design.md`.

**Deferred to Phase 4.2:** `retry_pipeline_stage` (needs raw HTTP), all definition-edit tools (`update_pipeline_variables`, `update_pipeline_triggers`, `update_release_variables`, `update_release_environment_variables`).
```

Set the actual merge date in `**Status:** shipped …` when committing this task (or in a follow-up commit after the PR merges, whichever fits the workflow).

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): mark Phase 2.2 shipped; add ✅ Phase 4.1 block"
```

---

## After all tasks: PR

- [ ] Push the branch (`zdvihal/zdv-173-phase-4-1` or similar) and open a PR titled `feat(phase-4.1): pipeline & release run actions`.
- [ ] PR description references the spec + plan and lists the 8 new tools.
- [ ] Confirm CI passes (`npm test`, `npm run typecheck`, `npm run build`).
- [ ] After merge: tag `v0.6.0` (minor — new tools), let the existing publish workflow ship to npm.
- [ ] Mark ZDV-173 still open (it's the parent issue; create a child issue for Phase 4.2 and link).

---

## Self-review notes

- Every task ends with a passing test or typecheck command and a commit.
- Enum values for `ApprovalStatus`, `ReleaseStatus`, `BuildStatus`, `EnvironmentStatus` are called out as "verify against SDK source before committing" — they're the single biggest implementation risk and shouldn't be trusted blindly.
- The reverse-mapping tables in Tasks 5 and 8 must stay in sync with the enum values used in Task 12's `SdkAdoClient` calls. If you change one, change both.
- No placeholders, no "TODO", no "similar to above" — every code block is self-contained.
