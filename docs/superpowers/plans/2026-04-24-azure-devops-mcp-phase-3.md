# Azure DevOps MCP — Phase 3 (Releases, Pipelines & Commits) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 9 read-only tools across three new domains (releases, pipelines, commits) so the LLM can answer deployment, CI, and branch-history questions like "who last published Newton.n2 to production and what was published?".

**Architecture:** Extend `AdoClient` with 9 new read method signatures. Add three new feature folders under `src/domains/` (releases, pipelines, commits) each with `readService.ts`, `readTools.ts`, `schemas.ts` — mirroring the Phase 1 PR shape. Reuse existing infra: `sdkClient` for connections, `errorBoundary` for MCP wrapping, `ado/errors.ts` bucket mapping, and `pullRequests/repoResolution.ts` for cwd auto-detect on the commits domain. One new error hint (Release API 404 at collection root → "classic releases may not be enabled"). No new dependencies.

**Tech Stack:** Same as Phase 1/2 — TypeScript, `azure-devops-node-api`, `zod`, vitest.

**Spec reference:** `docs/superpowers/specs/2026-04-24-azure-devops-mcp-releases-pipelines-commits-design.md`

**Out of Phase 3 (deferred to a later phase):** Any write operations — queue a build, re-run a stage, approve a release gate, cancel a run, tag a build. Also: work items, wiki, artifacts, test results, pagination cursors.

---

## File map for Phase 3

```
azure-mcp/
├── package.json                                     # MODIFY: bump version to 0.3.0
├── README.md                                        # MODIFY: Phase 3 tool catalog, PAT scope additions
├── docs/
│   └── ROADMAP.md                                   # MODIFY: mark Phase 3 shipped
│
├── src/
│   ├── ado/
│   │   ├── client.ts                                # MODIFY: +9 read method signatures
│   │   ├── sdkClient.ts                             # MODIFY: +9 implementations
│   │   ├── errors.ts                                # MODIFY: Release-collection-404 hint in AdoNotFoundError
│   │   └── types.ts                                 # MODIFY: re-export Release/Build/Commit SDK types
│   │
│   ├── domains/
│   │   ├── releases/                                # NEW
│   │   │   ├── schemas.ts
│   │   │   ├── readService.ts
│   │   │   └── readTools.ts
│   │   ├── pipelines/                               # NEW
│   │   │   ├── schemas.ts
│   │   │   ├── readService.ts
│   │   │   └── readTools.ts
│   │   └── commits/                                 # NEW
│   │       ├── schemas.ts
│   │       ├── readService.ts
│   │       └── readTools.ts
│   │
│   └── mcp/
│       └── registerTools.ts                         # MODIFY: wire 3 new domains into read tool array
│
└── test/
    ├── fakes/
    │   └── FakeAdoClient.ts                         # MODIFY: +9 method stubs + setters + error injection keys
    │
    └── unit/
        ├── ado/
        │   └── errors.test.ts                       # MODIFY: add Release-collection-404 hint test
        │
        └── domains/
            ├── releases/
            │   └── readService.test.ts              # NEW
            ├── pipelines/
            │   └── readService.test.ts              # NEW
            └── commits/
                └── readService.test.ts              # NEW
```

**Unchanged:** `config/`, `git/`, `domains/identity/`, `domains/projects/`, `domains/repositories/`, `domains/pullRequests/`, `mcp/errorBoundary.ts`, `setup.ts`, `index.ts`, `tsconfig.json`.

---

## Conventions (carry over from Phase 0/1/2)

- **Commit after every task.** One task = one commit.
- **TDD for service logic.** Mechanical scaffolding (interface signatures, SDK wrappers, Zod schemas, tool definitions) is implemented and verified via `npm run typecheck` + `npm test`.
- **All code is ESM.** Relative imports use `.js` extension on `.ts` source files.
- **No `any`.** Strict TS, `noUncheckedIndexedAccess` is on — narrow with `??` fallbacks.
- **AdoError pattern in SdkAdoClient catches:** every catch should `if (err instanceof AdoError) throw err;` BEFORE calling `mapSdkError(err)`. Preserves typed errors when the try block synthesizes them itself.
- **Run from `/Users/vasekzdvihal/source/GitHub/azure-mcp`** for all `npm`, `git`, `node` commands.

---

## Task 1: Re-export Release / Build / Commit SDK types

**Files:**
- Modify: `src/ado/types.ts`

Widen the type surface so downstream files never import directly from `azure-devops-node-api/interfaces/...`.

- [ ] **Step 1: Add new re-exports**

Edit `src/ado/types.ts`, append after the existing `GitInterfaces` re-exports block:

```ts
// Release (classic release pipelines)
export type {
  Release,
  ReleaseDefinition,
  Deployment,
  ReleaseEnvironment,
  Artifact,
  DeploymentStatus,
  ReleaseStatus,
} from "azure-devops-node-api/interfaces/ReleaseInterfaces.js";

// Build (classic build + YAML pipelines)
export type {
  Build,
  BuildDefinitionReference,
  Timeline,
  TimelineRecord,
  BuildStatus,
  BuildResult,
} from "azure-devops-node-api/interfaces/BuildInterfaces.js";

// Git commits & branches
export type {
  GitBranchStats,
  GitCommitRef,
  GitQueryCommitsCriteria,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ado/types.ts
git commit -m "feat(phase-3): re-export release, build, commit SDK types"
```

---

## Task 2: Extend `AdoClient` interface with 9 new methods

**Files:**
- Modify: `src/ado/client.ts`

- [ ] **Step 1: Add imports**

At the top of `src/ado/client.ts`, extend the existing type import block:

```ts
import type {
  Identity,
  TeamProjectReference,
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitPullRequestChange,
  PullRequestStatus,
  Comment,
  CommentThreadStatus,
  IdentityRefWithVote,
  Release,
  ReleaseDefinition,
  Deployment,
  DeploymentStatus,
  ReleaseStatus,
  Build,
  BuildDefinitionReference,
  Timeline,
  BuildStatus,
  BuildResult,
  GitBranchStats,
  GitCommitRef,
} from "./types.js";
```

- [ ] **Step 2: Append new method signatures to the interface**

Inside `interface AdoClient { ... }` in `src/ado/client.ts`, add at the bottom (before the closing `}`):

```ts
  // releases (classic Release pipelines)
  listReleaseDefinitions(args: { project: string }): Promise<ReleaseDefinition[]>;

  listReleases(args: {
    project: string;
    definitionId?: number;
    status?: ReleaseStatus;
    top?: number;
  }): Promise<Release[]>;

  getRelease(args: { project: string; releaseId: number }): Promise<Release>;

  listDeployments(args: {
    project: string;
    definitionId?: number;
    deploymentStatus?: DeploymentStatus;
    top?: number;
  }): Promise<Deployment[]>;

  // pipelines (classic-build + YAML, both via BuildApi)
  listPipelines(args: {
    project: string;
    repositoryId?: string;
  }): Promise<BuildDefinitionReference[]>;

  listPipelineRuns(args: {
    project: string;
    pipelineId?: number;
    branch?: string;
    status?: BuildStatus;
    result?: BuildResult;
    top?: number;
  }): Promise<Build[]>;

  getPipelineRun(args: {
    project: string;
    runId: number;
  }): Promise<{ build: Build; timeline: Timeline | null }>;

  // commits & branches
  listBranches(args: {
    project: string;
    repository: string;
  }): Promise<GitBranchStats[]>;

  listCommits(args: {
    project: string;
    repository: string;
    branch?: string;
    fromDate?: string;
    toDate?: string;
    author?: string;
    top?: number;
  }): Promise<GitCommitRef[]>;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: two errors — `SdkAdoClient` and `FakeAdoClient` don't implement the new methods yet. That's expected; we'll fix in Tasks 3 and 4.

- [ ] **Step 4: Commit**

```bash
git add src/ado/client.ts
git commit -m "feat(phase-3): extend AdoClient with releases/pipelines/commits signatures"
```

---

## Task 3: Implement the 9 new methods on `SdkAdoClient`

**Files:**
- Modify: `src/ado/sdkClient.ts`

- [ ] **Step 1: Update imports**

At the top of `src/ado/sdkClient.ts`, extend the existing type import block:

```ts
import type {
  Identity,
  TeamProjectReference,
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitPullRequestChange,
  PullRequestStatus,
  Comment,
  CommentThreadStatus,
  IdentityRefWithVote,
  Release,
  ReleaseDefinition,
  Deployment,
  DeploymentStatus,
  ReleaseStatus,
  Build,
  BuildDefinitionReference,
  Timeline,
  BuildStatus,
  BuildResult,
  GitBranchStats,
  GitCommitRef,
  GitQueryCommitsCriteria,
} from "./types.js";
```

- [ ] **Step 2: Append the 9 implementations**

Inside `export class SdkAdoClient implements AdoClient { ... }`, add at the bottom (before the closing `}`):

```ts
  // -------- releases --------

  async listReleaseDefinitions(args: { project: string }): Promise<ReleaseDefinition[]> {
    try {
      const rel = await this.api.getReleaseApi();
      const defs = await rel.getReleaseDefinitions(args.project);
      return defs;
    } catch (err) {
      const mapped = mapSdkError(err);
      // A 404 on the first release endpoint we hit in a project is almost
      // certainly "classic releases are not enabled on this collection" rather
      // than "project missing" — the non-release tools against the same
      // project would have returned before reaching this code path. Give the
      // user a concrete hint.
      if (mapped instanceof AdoNotFoundError) {
        throw new AdoNotFoundError(
          "Release API unavailable — this collection may not have classic releases enabled, " +
            "or the project name is wrong. " +
            (mapped.message.replace(/^.*Details:\s*/, "Details: ") ?? ""),
        );
      }
      throw mapped;
    }
  }

  async listReleases(args: {
    project: string;
    definitionId?: number;
    status?: ReleaseStatus;
    top?: number;
  }): Promise<Release[]> {
    try {
      const rel = await this.api.getReleaseApi();
      const releases = await rel.getReleases(
        args.project,
        args.definitionId,
        undefined, // definitionEnvironmentId
        undefined, // searchText
        undefined, // createdBy
        args.status,
        undefined, // environmentStatusFilter
        undefined, // minCreatedTime
        undefined, // maxCreatedTime
        undefined, // queryOrder
        args.top,
      );
      return releases;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async getRelease(args: { project: string; releaseId: number }): Promise<Release> {
    try {
      const rel = await this.api.getReleaseApi();
      const release = await rel.getRelease(args.project, args.releaseId);
      if (!release) throw new AdoNotFoundError(`Release ${args.releaseId} not found`);
      return release;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async listDeployments(args: {
    project: string;
    definitionId?: number;
    deploymentStatus?: DeploymentStatus;
    top?: number;
  }): Promise<Deployment[]> {
    try {
      const rel = await this.api.getReleaseApi();
      const deployments = await rel.getDeployments(
        args.project,
        args.definitionId,
        undefined, // definitionEnvironmentId
        undefined, // createdBy
        undefined, // minModifiedTime
        undefined, // maxModifiedTime
        args.deploymentStatus,
        undefined, // operationStatus
        undefined, // latestAttemptsOnly
        undefined, // queryOrder
        args.top,
      );
      return deployments;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  // -------- pipelines (BuildApi) --------

  async listPipelines(args: {
    project: string;
    repositoryId?: string;
  }): Promise<BuildDefinitionReference[]> {
    try {
      const build = await this.api.getBuildApi();
      const defs = await build.getDefinitions(
        args.project,
        undefined, // name
        args.repositoryId,
      );
      return defs;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async listPipelineRuns(args: {
    project: string;
    pipelineId?: number;
    branch?: string;
    status?: BuildStatus;
    result?: BuildResult;
    top?: number;
  }): Promise<Build[]> {
    try {
      const build = await this.api.getBuildApi();
      const runs = await build.getBuilds(
        args.project,
        args.pipelineId !== undefined ? [args.pipelineId] : undefined,
        undefined, // queues
        undefined, // buildNumber
        undefined, // minTime
        undefined, // maxTime
        undefined, // requestedFor
        undefined, // reasonFilter
        args.status,
        args.result,
        undefined, // tagFilters
        undefined, // properties
        args.top,
        undefined, // continuationToken
        undefined, // maxBuildsPerDefinition
        undefined, // deletedFilter
        undefined, // queryOrder
        args.branch,
      );
      return runs;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async getPipelineRun(args: {
    project: string;
    runId: number;
  }): Promise<{ build: Build; timeline: Timeline | null }> {
    try {
      const build = await this.api.getBuildApi();
      const b = await build.getBuild(args.project, args.runId);
      if (!b) throw new AdoNotFoundError(`Pipeline run ${args.runId} not found`);
      // Timeline may be null for very old runs or builds that never started a
      // plan. The get_pipeline_run tool returns whatever is available.
      let timeline: Timeline | null = null;
      try {
        timeline = await build.getBuildTimeline(args.project, args.runId);
      } catch {
        timeline = null;
      }
      return { build: b, timeline };
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  // -------- commits & branches --------

  async listBranches(args: {
    project: string;
    repository: string;
  }): Promise<GitBranchStats[]> {
    try {
      const git = await this.api.getGitApi();
      const branches = await git.getBranches(args.repository, args.project);
      return branches;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async listCommits(args: {
    project: string;
    repository: string;
    branch?: string;
    fromDate?: string;
    toDate?: string;
    author?: string;
    top?: number;
  }): Promise<GitCommitRef[]> {
    try {
      const git = await this.api.getGitApi();
      const criteria: GitQueryCommitsCriteria = {
        ...(args.branch
          ? { itemVersion: { version: args.branch, versionType: 0 /* Branch */ } }
          : {}),
        ...(args.fromDate ? { fromDate: args.fromDate } : {}),
        ...(args.toDate ? { toDate: args.toDate } : {}),
        ...(args.author ? { author: args.author } : {}),
      };
      const commits = await git.getCommits(
        args.repository,
        criteria,
        args.project,
        undefined, // skip
        args.top,
      );
      return commits;
    } catch (err) {
      throw mapSdkError(err);
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: one remaining error — `FakeAdoClient` still doesn't implement the new methods. That's fixed in Task 4.

- [ ] **Step 4: Commit**

```bash
git add src/ado/sdkClient.ts
git commit -m "feat(phase-3): implement releases/pipelines/commits on SdkAdoClient"
```

---

## Task 4: Extend `FakeAdoClient` with stubs + setters for the 9 new methods

**Files:**
- Modify: `test/fakes/FakeAdoClient.ts`

- [ ] **Step 1: Update imports**

At the top of `test/fakes/FakeAdoClient.ts`, extend the existing type import block:

```ts
import type {
  Identity,
  TeamProjectReference,
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitPullRequestChange,
  PullRequestStatus,
  Comment,
  CommentThreadStatus,
  IdentityRefWithVote,
  Release,
  ReleaseDefinition,
  Deployment,
  DeploymentStatus,
  ReleaseStatus,
  Build,
  BuildDefinitionReference,
  Timeline,
  BuildStatus,
  BuildResult,
  GitBranchStats,
  GitCommitRef,
} from "../../src/ado/types.js";
```

- [ ] **Step 2: Add private state + setters + impls**

Inside `class FakeAdoClient implements AdoClient`, just before the `// ---- AdoClient impl ----` marker, add:

```ts
  // ---- phase-3 state ----
  private releaseDefs = new Map<string, ReleaseDefinition[]>(); // project
  private releases = new Map<string, Release[]>(); // project
  private releaseDetails = new Map<string, Release>(); // `${project} ${releaseId}`
  private deployments = new Map<string, Deployment[]>(); // project
  private pipelines = new Map<string, BuildDefinitionReference[]>(); // project
  private pipelineRuns = new Map<string, Build[]>(); // project
  private pipelineRunDetails = new Map<
    string,
    { build: Build; timeline: Timeline | null }
  >(); // `${project} ${runId}`
  private branches = new Map<string, GitBranchStats[]>(); // `${project} ${repo}`
  private commits = new Map<string, GitCommitRef[]>(); // `${project} ${repo}`

  // ---- phase-3 setup helpers ----
  setReleaseDefinitions(project: string, defs: ReleaseDefinition[]): void {
    this.releaseDefs.set(project, defs);
  }
  setReleases(project: string, releases: Release[]): void {
    this.releases.set(project, releases);
  }
  setRelease(project: string, releaseId: number, release: Release): void {
    this.releaseDetails.set(`${project} ${releaseId}`, release);
  }
  setDeployments(project: string, deployments: Deployment[]): void {
    this.deployments.set(project, deployments);
  }
  setPipelines(project: string, pipelines: BuildDefinitionReference[]): void {
    this.pipelines.set(project, pipelines);
  }
  setPipelineRuns(project: string, runs: Build[]): void {
    this.pipelineRuns.set(project, runs);
  }
  setPipelineRun(
    project: string,
    runId: number,
    detail: { build: Build; timeline: Timeline | null },
  ): void {
    this.pipelineRunDetails.set(`${project} ${runId}`, detail);
  }
  setBranches(project: string, repository: string, branches: GitBranchStats[]): void {
    this.branches.set(`${project} ${repository}`, branches);
  }
  setCommits(project: string, repository: string, commits: GitCommitRef[]): void {
    this.commits.set(`${project} ${repository}`, commits);
  }
```

- [ ] **Step 3: Append the 9 impls**

At the very bottom of the class body (just before the closing `}` of `class FakeAdoClient`), add:

```ts
  async listReleaseDefinitions(args: { project: string }): Promise<ReleaseDefinition[]> {
    this.throwIfInjected("listReleaseDefinitions");
    return this.releaseDefs.get(args.project) ?? [];
  }

  async listReleases(args: {
    project: string;
    definitionId?: number;
    status?: ReleaseStatus;
    top?: number;
  }): Promise<Release[]> {
    this.throwIfInjected("listReleases");
    return this.releases.get(args.project) ?? [];
  }

  async getRelease(args: { project: string; releaseId: number }): Promise<Release> {
    this.throwIfInjected("getRelease");
    const r = this.releaseDetails.get(`${args.project} ${args.releaseId}`);
    if (!r) throw new Error(`FakeAdoClient.getRelease: no release configured for ${args.project} ${args.releaseId}`);
    return r;
  }

  async listDeployments(args: {
    project: string;
    definitionId?: number;
    deploymentStatus?: DeploymentStatus;
    top?: number;
  }): Promise<Deployment[]> {
    this.throwIfInjected("listDeployments");
    return this.deployments.get(args.project) ?? [];
  }

  async listPipelines(args: {
    project: string;
    repositoryId?: string;
  }): Promise<BuildDefinitionReference[]> {
    this.throwIfInjected("listPipelines");
    return this.pipelines.get(args.project) ?? [];
  }

  async listPipelineRuns(args: {
    project: string;
    pipelineId?: number;
    branch?: string;
    status?: BuildStatus;
    result?: BuildResult;
    top?: number;
  }): Promise<Build[]> {
    this.throwIfInjected("listPipelineRuns");
    return this.pipelineRuns.get(args.project) ?? [];
  }

  async getPipelineRun(args: {
    project: string;
    runId: number;
  }): Promise<{ build: Build; timeline: Timeline | null }> {
    this.throwIfInjected("getPipelineRun");
    const d = this.pipelineRunDetails.get(`${args.project} ${args.runId}`);
    if (!d) throw new Error(`FakeAdoClient.getPipelineRun: no run configured for ${args.project} ${args.runId}`);
    return d;
  }

  async listBranches(args: {
    project: string;
    repository: string;
  }): Promise<GitBranchStats[]> {
    this.throwIfInjected("listBranches");
    return this.branches.get(`${args.project} ${args.repository}`) ?? [];
  }

  async listCommits(args: {
    project: string;
    repository: string;
    branch?: string;
    fromDate?: string;
    toDate?: string;
    author?: string;
    top?: number;
  }): Promise<GitCommitRef[]> {
    this.throwIfInjected("listCommits");
    return this.commits.get(`${args.project} ${args.repository}`) ?? [];
  }
```

- [ ] **Step 4: Typecheck + test**

```bash
npm run typecheck
npm test
```
Expected: typecheck passes; all existing tests still pass (no new tests yet).

- [ ] **Step 5: Commit**

```bash
git add test/fakes/FakeAdoClient.ts
git commit -m "test(phase-3): extend FakeAdoClient with releases/pipelines/commits stubs"
```

---

## Task 5: Releases — schemas + `list_release_definitions` (TDD)

**Files:**
- Create: `src/domains/releases/schemas.ts`
- Create: `src/domains/releases/readService.ts`
- Create: `test/unit/domains/releases/readService.test.ts`

- [ ] **Step 1: Create the schemas file**

Write `src/domains/releases/schemas.ts`:

```ts
import { z } from "zod";

export const ProjectOnly = {
  project: z.string().min(1).describe("ADO project name."),
};

export const ListReleasesInput = {
  project: z.string().min(1).describe("ADO project name."),
  definitionId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Filter to releases of this release-definition id."),
  status: z
    .enum(["active", "abandoned", "draft"])
    .optional()
    .describe("Filter by release status. Default: no filter (all)."),
  top: z.number().int().positive().max(200).optional().describe("Max results (default 25)."),
};

export const ReleaseId = {
  project: z.string().min(1).describe("ADO project name."),
  releaseId: z.number().int().positive().describe("The release id (integer)."),
};

export const ListDeploymentsInput = {
  project: z.string().min(1).describe("ADO project name."),
  definitionId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Filter to this release-definition id."),
  status: z
    .enum([
      "notDeployed",
      "inProgress",
      "succeeded",
      "partiallySucceeded",
      "failed",
      "all",
    ])
    .optional()
    .describe("Filter by deployment status. 'all' returns every status."),
  top: z.number().int().positive().max(200).optional().describe("Max results (default 25)."),
};
```

- [ ] **Step 2: Write the failing test**

Create `test/unit/domains/releases/readService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ReleasesReadService } from "../../../../src/domains/releases/readService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type { ReleaseDefinition } from "../../../../src/ado/types.js";

describe("ReleasesReadService.listDefinitions", () => {
  it("shapes release definitions to compact summaries", async () => {
    const fake = new FakeAdoClient();
    const defs: ReleaseDefinition[] = [
      {
        id: 1,
        name: "Newton.n2-Deploy",
        path: "\\Newton",
        createdBy: { displayName: "Alice", id: "a1" },
        createdOn: new Date("2026-01-15T08:00:00Z"),
        modifiedOn: new Date("2026-04-01T14:00:00Z"),
      },
    ];
    fake.setReleaseDefinitions("MyProj", defs);
    const svc = new ReleasesReadService(fake);

    const result = await svc.listDefinitions({ project: "MyProj" });

    expect(result).toEqual([
      {
        id: 1,
        name: "Newton.n2-Deploy",
        path: "\\Newton",
        createdBy: "Alice",
        createdOn: "2026-01-15T08:00:00.000Z",
        modifiedOn: "2026-04-01T14:00:00.000Z",
      },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- test/unit/domains/releases/readService.test.ts
```
Expected: FAIL — cannot find `readService.js`.

- [ ] **Step 4: Write the service skeleton with `listDefinitions`**

Create `src/domains/releases/readService.ts`:

```ts
import type { AdoClient } from "../../ado/client.js";
import type {
  Release,
  ReleaseDefinition,
  Deployment,
  DeploymentStatus,
  ReleaseStatus,
} from "../../ado/types.js";

const RELEASE_STATUS_TO_ENUM: Record<string, ReleaseStatus> = {
  draft: 1,
  active: 2,
  abandoned: 4,
};

const RELEASE_STATUS_FROM_ENUM: Record<number, string> = {
  0: "undefined",
  1: "draft",
  2: "active",
  4: "abandoned",
};

const DEPLOYMENT_STATUS_TO_ENUM: Record<string, DeploymentStatus> = {
  notDeployed: 1,
  inProgress: 2,
  succeeded: 4,
  partiallySucceeded: 8,
  failed: 16,
  all: 31,
};

const DEPLOYMENT_STATUS_FROM_ENUM: Record<number, string> = {
  0: "undefined",
  1: "notDeployed",
  2: "inProgress",
  4: "succeeded",
  8: "partiallySucceeded",
  16: "failed",
};

export interface ReleaseDefinitionSummary {
  id: number;
  name: string;
  path?: string;
  createdBy?: string;
  createdOn?: string;
  modifiedOn?: string;
}

export interface ReleaseSummary {
  id: number;
  name: string;
  definitionId?: number;
  definitionName?: string;
  status: string;
  createdOn?: string;
  createdBy?: string;
  description?: string;
}

export interface ReleaseDetail extends ReleaseSummary {
  stages: Array<{
    environmentName: string;
    status: string;
    deployedBy?: string;
    completedOn?: string;
  }>;
  artifacts: Array<{
    alias?: string;
    sourceBuildId?: string;
    sourceBranch?: string;
    sourceVersion?: string;
  }>;
}

export interface DeploymentSummary {
  deploymentId: number;
  releaseId?: number;
  releaseName?: string;
  definitionId?: number;
  definitionName?: string;
  environmentName?: string;
  status: string;
  requestedBy?: string;
  requestedOn?: string;
  startedOn?: string;
  completedOn?: string;
  sourceBuildId?: string;
  sourceBranch?: string;
  sourceVersion?: string;
}

export class ReleasesReadService {
  constructor(private readonly client: AdoClient) {}

  async listDefinitions(args: { project: string }): Promise<ReleaseDefinitionSummary[]> {
    const defs = await this.client.listReleaseDefinitions({ project: args.project });
    return defs.map(shapeDefinition);
  }
}

function shapeDefinition(d: ReleaseDefinition): ReleaseDefinitionSummary {
  return {
    id: d.id ?? 0,
    name: d.name ?? "",
    path: d.path,
    createdBy: d.createdBy?.displayName,
    createdOn: d.createdOn?.toISOString(),
    modifiedOn: d.modifiedOn?.toISOString(),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- test/unit/domains/releases/readService.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domains/releases/schemas.ts src/domains/releases/readService.ts test/unit/domains/releases/readService.test.ts
git commit -m "feat(phase-3): releases — list_release_definitions"
```

---

## Task 6: Releases — `list_releases` (TDD)

**Files:**
- Modify: `src/domains/releases/readService.ts`
- Modify: `test/unit/domains/releases/readService.test.ts`

- [ ] **Step 1: Write the failing test**

Extend the import block at the top of `test/unit/domains/releases/readService.test.ts` — the existing import of `ReleaseDefinition` from `types.js` becomes:

```ts
import type { ReleaseDefinition, Release } from "../../../../src/ado/types.js";
```

Then append a new describe block at the bottom of the file:

```ts
describe("ReleasesReadService.list", () => {
  it("maps enum status to ADO enum on the way in and string on the way out", async () => {
    const fake = new FakeAdoClient();
    const releases: Release[] = [
      {
        id: 1001,
        name: "Release-42",
        status: 2, // active
        releaseDefinition: { id: 9, name: "Newton.n2-Deploy" },
        createdBy: { displayName: "Bob", id: "b1" },
        createdOn: new Date("2026-04-20T09:00:00Z"),
        description: "Scheduled deploy",
      },
    ];
    fake.setReleases("MyProj", releases);
    const svc = new ReleasesReadService(fake);

    const result = await svc.list({ project: "MyProj", status: "active", top: 10 });

    expect(result).toEqual([
      {
        id: 1001,
        name: "Release-42",
        definitionId: 9,
        definitionName: "Newton.n2-Deploy",
        status: "active",
        createdBy: "Bob",
        createdOn: "2026-04-20T09:00:00.000Z",
        description: "Scheduled deploy",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/releases/readService.test.ts
```
Expected: FAIL — `svc.list is not a function`.

- [ ] **Step 3: Implement `list`**

Inside `class ReleasesReadService` in `src/domains/releases/readService.ts`, add after `listDefinitions`:

```ts
  async list(args: {
    project: string;
    definitionId?: number;
    status?: string;
    top?: number;
  }): Promise<ReleaseSummary[]> {
    const status = args.status ? RELEASE_STATUS_TO_ENUM[args.status] : undefined;
    const releases = await this.client.listReleases({
      project: args.project,
      definitionId: args.definitionId,
      status,
      top: args.top,
    });
    return releases.map(shapeRelease);
  }
```

And add the shaper at the bottom of the file (below the existing `shapeDefinition`):

```ts
function shapeRelease(r: Release): ReleaseSummary {
  return {
    id: r.id ?? 0,
    name: r.name ?? "",
    definitionId: r.releaseDefinition?.id,
    definitionName: r.releaseDefinition?.name,
    status: RELEASE_STATUS_FROM_ENUM[r.status ?? 0] ?? "unknown",
    createdBy: r.createdBy?.displayName,
    createdOn: r.createdOn?.toISOString(),
    description: r.description,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/domains/releases/readService.test.ts
```
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/domains/releases/readService.ts test/unit/domains/releases/readService.test.ts
git commit -m "feat(phase-3): releases — list_releases"
```

---

## Task 7: Releases — `get_release` (TDD)

**Files:**
- Modify: `src/domains/releases/readService.ts`
- Modify: `test/unit/domains/releases/readService.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new describe block at the bottom of `test/unit/domains/releases/readService.test.ts` (no new imports needed — `Release` is already imported from Task 6):

```ts
describe("ReleasesReadService.get", () => {
  it("returns stages + artifacts with flattened environment info", async () => {
    const fake = new FakeAdoClient();
    const release: Release = {
      id: 1001,
      name: "Release-42",
      status: 2,
      releaseDefinition: { id: 9, name: "Newton.n2-Deploy" },
      createdBy: { displayName: "Bob", id: "b1" },
      createdOn: new Date("2026-04-20T09:00:00Z"),
      description: "Scheduled deploy",
      environments: [
        {
          name: "Dev",
          status: 4, // succeeded
          postDeployApprovals: [],
          deploySteps: [
            {
              requestedBy: { displayName: "Bob" },
              lastModifiedOn: new Date("2026-04-20T09:15:00Z"),
            },
          ],
        },
        {
          name: "Production",
          status: 4,
          deploySteps: [
            {
              requestedBy: { displayName: "Carol" },
              lastModifiedOn: new Date("2026-04-20T10:00:00Z"),
            },
          ],
        },
      ],
      artifacts: [
        {
          alias: "_Newton.n2-CI",
          definitionReference: {
            version: { id: "12345", name: "20260420.1" },
            branch: { id: "refs/heads/main", name: "main" },
          },
        },
      ],
    };
    fake.setRelease("MyProj", 1001, release);
    const svc = new ReleasesReadService(fake);

    const result = await svc.get({ project: "MyProj", releaseId: 1001 });

    expect(result.id).toBe(1001);
    expect(result.name).toBe("Release-42");
    expect(result.stages).toEqual([
      {
        environmentName: "Dev",
        status: "succeeded",
        deployedBy: "Bob",
        completedOn: "2026-04-20T09:15:00.000Z",
      },
      {
        environmentName: "Production",
        status: "succeeded",
        deployedBy: "Carol",
        completedOn: "2026-04-20T10:00:00.000Z",
      },
    ]);
    expect(result.artifacts).toEqual([
      {
        alias: "_Newton.n2-CI",
        sourceBuildId: "12345",
        sourceBranch: "refs/heads/main",
        sourceVersion: undefined,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/releases/readService.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `get`**

Inside `class ReleasesReadService`, add after `list`:

```ts
  async get(args: { project: string; releaseId: number }): Promise<ReleaseDetail> {
    const release = await this.client.getRelease({
      project: args.project,
      releaseId: args.releaseId,
    });
    return shapeReleaseDetail(release);
  }
```

Also at the top of the file, add `ReleaseEnvironment` and `Artifact` to the type imports:

```ts
import type {
  Release,
  ReleaseDefinition,
  Deployment,
  DeploymentStatus,
  ReleaseStatus,
  ReleaseEnvironment,
  Artifact,
} from "../../ado/types.js";
```

Add the detail shaper at the bottom:

```ts
// Release stage status uses the EnvironmentStatus enum (0=undefined, 2=inProgress,
// 4=succeeded, 8=canceled, 16=rejected, 32=queued, 64=scheduled, 128=partiallySucceeded).
const ENVIRONMENT_STATUS_FROM_ENUM: Record<number, string> = {
  0: "undefined",
  2: "inProgress",
  4: "succeeded",
  8: "canceled",
  16: "rejected",
  32: "queued",
  64: "scheduled",
  128: "partiallySucceeded",
};

function shapeReleaseDetail(r: Release): ReleaseDetail {
  return {
    ...shapeRelease(r),
    stages: (r.environments ?? []).map(shapeStage),
    artifacts: (r.artifacts ?? []).map(shapeArtifact),
  };
}

function shapeStage(env: ReleaseEnvironment): ReleaseDetail["stages"][number] {
  const latestStep = env.deploySteps?.[env.deploySteps.length - 1];
  return {
    environmentName: env.name ?? "",
    status: ENVIRONMENT_STATUS_FROM_ENUM[env.status ?? 0] ?? "unknown",
    deployedBy: latestStep?.requestedBy?.displayName,
    completedOn: latestStep?.lastModifiedOn?.toISOString(),
  };
}

function shapeArtifact(a: Artifact): ReleaseDetail["artifacts"][number] {
  const ref = a.definitionReference ?? {};
  return {
    alias: a.alias,
    sourceBuildId: ref.version?.id,
    sourceBranch: ref.branch?.id,
    sourceVersion: ref.sourceVersion?.id,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/domains/releases/readService.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/releases/readService.ts test/unit/domains/releases/readService.test.ts
git commit -m "feat(phase-3): releases — get_release with stages + artifacts"
```

---

## Task 8: Releases — `list_deployments` (TDD)

**Files:**
- Modify: `src/domains/releases/readService.ts`
- Modify: `test/unit/domains/releases/readService.test.ts`

- [ ] **Step 1: Write the failing test**

Extend the import block at the top of `test/unit/domains/releases/readService.test.ts` to include `Deployment`:

```ts
import type { ReleaseDefinition, Release, Deployment } from "../../../../src/ado/types.js";
```

Then append a new describe block at the bottom:

```ts
describe("ReleasesReadService.listDeployments", () => {
  it("flattens deployment entries and passes status filter through", async () => {
    const fake = new FakeAdoClient();
    const deployments: Deployment[] = [
      {
        id: 5001,
        deploymentStatus: 4, // succeeded
        release: { id: 1001, name: "Release-42" },
        releaseDefinition: { id: 9, name: "Newton.n2-Deploy" },
        releaseEnvironment: { id: 2, name: "Production" },
        requestedBy: { displayName: "Carol", id: "c1" },
        requestedFor: { displayName: "Carol", id: "c1" },
        queuedOn: new Date("2026-04-20T09:55:00Z"),
        startedOn: new Date("2026-04-20T09:56:00Z"),
        completedOn: new Date("2026-04-20T10:00:00Z"),
        release_Artifacts: [
          {
            definitionReference: {
              version: { id: "12345", name: "20260420.1" },
              branch: { id: "refs/heads/main", name: "main" },
            },
          },
        ],
      },
    ];
    fake.setDeployments("MyProj", deployments);
    const svc = new ReleasesReadService(fake);

    const result = await svc.listDeployments({
      project: "MyProj",
      status: "succeeded",
      top: 10,
    });

    expect(result).toEqual([
      {
        deploymentId: 5001,
        releaseId: 1001,
        releaseName: "Release-42",
        definitionId: 9,
        definitionName: "Newton.n2-Deploy",
        environmentName: "Production",
        status: "succeeded",
        requestedBy: "Carol",
        requestedOn: "2026-04-20T09:55:00.000Z",
        startedOn: "2026-04-20T09:56:00.000Z",
        completedOn: "2026-04-20T10:00:00.000Z",
        sourceBuildId: "12345",
        sourceBranch: "refs/heads/main",
        sourceVersion: undefined,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/releases/readService.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `listDeployments`**

Inside `class ReleasesReadService`, add after `get`:

```ts
  async listDeployments(args: {
    project: string;
    definitionId?: number;
    status?: string;
    top?: number;
  }): Promise<DeploymentSummary[]> {
    const deploymentStatus = args.status ? DEPLOYMENT_STATUS_TO_ENUM[args.status] : undefined;
    const deployments = await this.client.listDeployments({
      project: args.project,
      definitionId: args.definitionId,
      deploymentStatus,
      top: args.top,
    });
    return deployments.map(shapeDeployment);
  }
```

Add the shaper at the bottom of the file:

```ts
function shapeDeployment(d: Deployment): DeploymentSummary {
  // `release_Artifacts` is the odd property name the SDK emits for the build
  // artifact associated with the deployment. Keep the source-build metadata
  // on the flat row so "what was deployed" is one-hop visible.
  const primaryArtifact = d.release_Artifacts?.[0];
  const ref = primaryArtifact?.definitionReference ?? {};
  return {
    deploymentId: d.id ?? 0,
    releaseId: d.release?.id,
    releaseName: d.release?.name,
    definitionId: d.releaseDefinition?.id,
    definitionName: d.releaseDefinition?.name,
    environmentName: d.releaseEnvironment?.name,
    status: DEPLOYMENT_STATUS_FROM_ENUM[d.deploymentStatus ?? 0] ?? "unknown",
    requestedBy: d.requestedBy?.displayName,
    requestedOn: d.queuedOn?.toISOString(),
    startedOn: d.startedOn?.toISOString(),
    completedOn: d.completedOn?.toISOString(),
    sourceBuildId: ref.version?.id,
    sourceBranch: ref.branch?.id,
    sourceVersion: ref.sourceVersion?.id,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/domains/releases/readService.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/releases/readService.ts test/unit/domains/releases/readService.test.ts
git commit -m "feat(phase-3): releases — list_deployments"
```

---

## Task 9: Releases — `readTools.ts` and register in MCP

**Files:**
- Create: `src/domains/releases/readTools.ts`
- Modify: `src/mcp/registerTools.ts`

- [ ] **Step 1: Create the tools file**

Write `src/domains/releases/readTools.ts`:

```ts
import type { ReleasesReadService } from "./readService.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  ProjectOnly,
  ListReleasesInput,
  ReleaseId,
  ListDeploymentsInput,
} from "./schemas.js";

export function buildReleasesReadTools(svc: ReleasesReadService): ToolDefinition[] {
  return [
    {
      name: "list_release_definitions",
      config: {
        title: "List release definitions (classic Release pipelines)",
        description:
          "Lists classic Release pipeline definitions in a project. Use this to find the " +
          "release-definition id, then pass it to `list_releases` or `list_deployments` to " +
          "narrow down to a specific pipeline.",
        inputSchema: ProjectOnly,
      },
      handler: async (args) =>
        svc.listDefinitions(args as Parameters<typeof svc.listDefinitions>[0]),
    },
    {
      name: "list_releases",
      config: {
        title: "List releases (classic Release runs)",
        description:
          "Lists release instances in a project. Each release corresponds to one run of a " +
          "release definition (which may deploy to multiple stages). Filter by definitionId or " +
          "status (active/abandoned/draft).",
        inputSchema: ListReleasesInput,
      },
      handler: async (args) => svc.list(args as Parameters<typeof svc.list>[0]),
    },
    {
      name: "get_release",
      config: {
        title: "Get a release with stages and artifacts",
        description:
          "Returns one release: stages (each with status + who deployed + when), artifacts " +
          "(with source build id and branch so you can chain to `get_pipeline_run` to find the " +
          "commit that was deployed).",
        inputSchema: ReleaseId,
      },
      handler: async (args) => svc.get(args as Parameters<typeof svc.get>[0]),
    },
    {
      name: "list_deployments",
      config: {
        title: "List deployments (per-stage flattened)",
        description:
          "Returns one row per stage deployment. This is the best tool to answer 'who last " +
          "deployed X to Production?' — pass `status: 'succeeded'`, `top: 1`, and filter the " +
          "result client-side by environment name (e.g. 'Production').",
        inputSchema: ListDeploymentsInput,
      },
      handler: async (args) =>
        svc.listDeployments(args as Parameters<typeof svc.listDeployments>[0]),
    },
  ];
}
```

- [ ] **Step 2: Wire into `registerTools.ts`**

Edit `src/mcp/registerTools.ts`. Add imports near the top with the other domain imports:

```ts
import { ReleasesReadService } from "../domains/releases/readService.js";
import { buildReleasesReadTools } from "../domains/releases/readTools.js";
```

Extend the `readTools` array inside `registerAllTools` to include the new domain. Replace the existing `readTools` initializer with:

```ts
  const readTools = [
    ...buildIdentityTools(new IdentityService(client)),
    ...buildProjectsTools(new ProjectsService(client)),
    ...buildRepositoriesTools(new RepositoriesService(client)),
    ...buildPullRequestReadTools(new PullRequestsReadService(client)),
    ...buildReleasesReadTools(new ReleasesReadService(client)),
  ];
```

- [ ] **Step 3: Build + test**

```bash
npm run typecheck
npm test
npm run build
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/domains/releases/readTools.ts src/mcp/registerTools.ts
git commit -m "feat(phase-3): register 4 release read tools in MCP server"
```

---

## Task 10: Pipelines — schemas + `list_pipelines` (TDD)

**Files:**
- Create: `src/domains/pipelines/schemas.ts`
- Create: `src/domains/pipelines/readService.ts`
- Create: `test/unit/domains/pipelines/readService.test.ts`

- [ ] **Step 1: Create the schemas file**

Write `src/domains/pipelines/schemas.ts`:

```ts
import { z } from "zod";

export const ListPipelinesInput = {
  project: z.string().min(1).describe("ADO project name."),
  repositoryId: z
    .string()
    .optional()
    .describe(
      "Filter to pipelines that build this repository id (GUID). " +
        "Use `list_repositories` to resolve repo name → id.",
    ),
};

export const ListPipelineRunsInput = {
  project: z.string().min(1).describe("ADO project name."),
  pipelineId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Filter to runs of this pipeline id."),
  branch: z
    .string()
    .optional()
    .describe("Filter by source branch ref (e.g. 'refs/heads/main')."),
  status: z
    .enum(["inProgress", "completed", "cancelling", "postponed", "notStarted"])
    .optional()
    .describe("Filter by run status."),
  result: z
    .enum(["succeeded", "partiallySucceeded", "failed", "canceled"])
    .optional()
    .describe("Filter by run result (only relevant when status is 'completed')."),
  top: z.number().int().positive().max(200).optional().describe("Max results (default 25)."),
};

export const PipelineRunId = {
  project: z.string().min(1).describe("ADO project name."),
  runId: z.number().int().positive().describe("The run id (integer)."),
};
```

- [ ] **Step 2: Write the failing test**

Create `test/unit/domains/pipelines/readService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PipelinesReadService } from "../../../../src/domains/pipelines/readService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type { BuildDefinitionReference } from "../../../../src/ado/types.js";

describe("PipelinesReadService.list", () => {
  it("shapes pipeline definitions distinguishing classic vs yaml", async () => {
    const fake = new FakeAdoClient();
    const defs: BuildDefinitionReference[] = [
      {
        id: 10,
        name: "Newton.n2-CI",
        path: "\\Newton",
        type: 2, // build (classic + yaml both come back as 2)
        process: { type: 2 /* yaml */ } as unknown as BuildDefinitionReference["process"],
        repository: { id: "repo-guid-1", defaultBranch: "refs/heads/main" },
      },
      {
        id: 11,
        name: "Newton.n2-Classic",
        type: 2,
        process: { type: 1 /* designerJson - classic */ } as unknown as BuildDefinitionReference["process"],
        repository: { id: "repo-guid-1", defaultBranch: "refs/heads/main" },
      },
    ];
    fake.setPipelines("MyProj", defs);
    const svc = new PipelinesReadService(fake);

    const result = await svc.list({ project: "MyProj" });

    expect(result).toEqual([
      { id: 10, name: "Newton.n2-CI", path: "\\Newton", type: "yaml", repositoryId: "repo-guid-1", defaultBranch: "refs/heads/main" },
      { id: 11, name: "Newton.n2-Classic", path: undefined, type: "classic", repositoryId: "repo-guid-1", defaultBranch: "refs/heads/main" },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- test/unit/domains/pipelines/readService.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Write the service**

Create `src/domains/pipelines/readService.ts`:

```ts
import type { AdoClient } from "../../ado/client.js";
import type {
  Build,
  BuildDefinitionReference,
  BuildResult,
  BuildStatus,
  Timeline,
  TimelineRecord,
} from "../../ado/types.js";

const BUILD_STATUS_TO_ENUM: Record<string, BuildStatus> = {
  inProgress: 1,
  completed: 2,
  cancelling: 4,
  postponed: 8,
  notStarted: 32,
};

const BUILD_STATUS_FROM_ENUM: Record<number, string> = {
  0: "none",
  1: "inProgress",
  2: "completed",
  4: "cancelling",
  8: "postponed",
  32: "notStarted",
};

const BUILD_RESULT_TO_ENUM: Record<string, BuildResult> = {
  succeeded: 2,
  partiallySucceeded: 4,
  failed: 8,
  canceled: 32,
};

const BUILD_RESULT_FROM_ENUM: Record<number, string> = {
  0: "none",
  2: "succeeded",
  4: "partiallySucceeded",
  8: "failed",
  32: "canceled",
};

export interface PipelineSummary {
  id: number;
  name: string;
  path?: string;
  type: "classic" | "yaml" | "unknown";
  repositoryId?: string;
  defaultBranch?: string;
}

export interface PipelineRunSummary {
  id: number;
  buildNumber?: string;
  pipelineId?: number;
  pipelineName?: string;
  status: string;
  result: string;
  sourceBranch?: string;
  sourceVersion?: string;
  requestedBy?: string;
  requestedFor?: string;
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
}

export interface PipelineRunDetail extends PipelineRunSummary {
  stages: Array<{
    name: string;
    status: string;
    result: string;
    startTime?: string;
    finishTime?: string;
  }>;
}

export class PipelinesReadService {
  constructor(private readonly client: AdoClient) {}

  async list(args: { project: string; repositoryId?: string }): Promise<PipelineSummary[]> {
    const defs = await this.client.listPipelines({
      project: args.project,
      repositoryId: args.repositoryId,
    });
    return defs.map(shapePipeline);
  }
}

function shapePipeline(d: BuildDefinitionReference): PipelineSummary {
  // DefinitionType enum: 1=xaml (ancient), 2=build. The classic-vs-yaml split
  // lives on `process.type`: 1=designer (classic), 2=yaml.
  const procType = (d.process as { type?: number } | undefined)?.type;
  const type: PipelineSummary["type"] =
    procType === 2 ? "yaml" : procType === 1 ? "classic" : "unknown";
  return {
    id: d.id ?? 0,
    name: d.name ?? "",
    path: d.path,
    type,
    repositoryId: d.repository?.id,
    defaultBranch: d.repository?.defaultBranch,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- test/unit/domains/pipelines/readService.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domains/pipelines/schemas.ts src/domains/pipelines/readService.ts test/unit/domains/pipelines/readService.test.ts
git commit -m "feat(phase-3): pipelines — list_pipelines"
```

---

## Task 11: Pipelines — `list_pipeline_runs` (TDD)

**Files:**
- Modify: `src/domains/pipelines/readService.ts`
- Modify: `test/unit/domains/pipelines/readService.test.ts`

- [ ] **Step 1: Write the failing test**

Extend the import block at the top of `test/unit/domains/pipelines/readService.test.ts` to include `Build`:

```ts
import type { BuildDefinitionReference, Build } from "../../../../src/ado/types.js";
```

Then append a new describe block at the bottom:

```ts
describe("PipelinesReadService.listRuns", () => {
  it("maps branch, status, result strings to enums on the way in and out", async () => {
    const fake = new FakeAdoClient();
    const runs: Build[] = [
      {
        id: 500,
        buildNumber: "20260420.1",
        definition: { id: 10, name: "Newton.n2-CI" },
        status: 2, // completed
        result: 2, // succeeded
        sourceBranch: "refs/heads/main",
        sourceVersion: "abcdef123",
        requestedBy: { displayName: "Bob" },
        requestedFor: { displayName: "Bob" },
        queueTime: new Date("2026-04-20T08:00:00Z"),
        startTime: new Date("2026-04-20T08:01:00Z"),
        finishTime: new Date("2026-04-20T08:10:00Z"),
      },
    ];
    fake.setPipelineRuns("MyProj", runs);
    const svc = new PipelinesReadService(fake);

    const result = await svc.listRuns({
      project: "MyProj",
      pipelineId: 10,
      branch: "refs/heads/main",
      status: "completed",
      result: "succeeded",
      top: 10,
    });

    expect(result).toEqual([
      {
        id: 500,
        buildNumber: "20260420.1",
        pipelineId: 10,
        pipelineName: "Newton.n2-CI",
        status: "completed",
        result: "succeeded",
        sourceBranch: "refs/heads/main",
        sourceVersion: "abcdef123",
        requestedBy: "Bob",
        requestedFor: "Bob",
        queueTime: "2026-04-20T08:00:00.000Z",
        startTime: "2026-04-20T08:01:00.000Z",
        finishTime: "2026-04-20T08:10:00.000Z",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/pipelines/readService.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `listRuns`**

Inside `class PipelinesReadService`, add after `list`:

```ts
  async listRuns(args: {
    project: string;
    pipelineId?: number;
    branch?: string;
    status?: string;
    result?: string;
    top?: number;
  }): Promise<PipelineRunSummary[]> {
    const runs = await this.client.listPipelineRuns({
      project: args.project,
      pipelineId: args.pipelineId,
      branch: args.branch,
      status: args.status ? BUILD_STATUS_TO_ENUM[args.status] : undefined,
      result: args.result ? BUILD_RESULT_TO_ENUM[args.result] : undefined,
      top: args.top,
    });
    return runs.map(shapeRun);
  }
```

Add the shaper at the bottom of the file:

```ts
function shapeRun(b: Build): PipelineRunSummary {
  return {
    id: b.id ?? 0,
    buildNumber: b.buildNumber,
    pipelineId: b.definition?.id,
    pipelineName: b.definition?.name,
    status: BUILD_STATUS_FROM_ENUM[b.status ?? 0] ?? "unknown",
    result: BUILD_RESULT_FROM_ENUM[b.result ?? 0] ?? "none",
    sourceBranch: b.sourceBranch,
    sourceVersion: b.sourceVersion,
    requestedBy: b.requestedBy?.displayName,
    requestedFor: b.requestedFor?.displayName,
    queueTime: b.queueTime?.toISOString(),
    startTime: b.startTime?.toISOString(),
    finishTime: b.finishTime?.toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/domains/pipelines/readService.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/pipelines/readService.ts test/unit/domains/pipelines/readService.test.ts
git commit -m "feat(phase-3): pipelines — list_pipeline_runs"
```

---

## Task 12: Pipelines — `get_pipeline_run` with stages timeline (TDD)

**Files:**
- Modify: `src/domains/pipelines/readService.ts`
- Modify: `test/unit/domains/pipelines/readService.test.ts`

- [ ] **Step 1: Write the failing test**

Extend the import block at the top of `test/unit/domains/pipelines/readService.test.ts` to include `Timeline`:

```ts
import type { BuildDefinitionReference, Build, Timeline } from "../../../../src/ado/types.js";
```

Then append a new describe block at the bottom:

```ts
describe("PipelinesReadService.get", () => {
  it("extracts stage records from the build timeline", async () => {
    const fake = new FakeAdoClient();
    const build: Build = {
      id: 500,
      buildNumber: "20260420.1",
      definition: { id: 10, name: "Newton.n2-CI" },
      status: 2,
      result: 2,
      sourceBranch: "refs/heads/main",
      sourceVersion: "abcdef123",
      queueTime: new Date("2026-04-20T08:00:00Z"),
      startTime: new Date("2026-04-20T08:01:00Z"),
      finishTime: new Date("2026-04-20T08:30:00Z"),
    };
    const timeline: Timeline = {
      records: [
        {
          name: "Build",
          type: "Stage",
          state: 2, // completed
          result: 0, // succeeded
          startTime: new Date("2026-04-20T08:01:00Z"),
          finishTime: new Date("2026-04-20T08:10:00Z"),
        },
        {
          name: "Deploy to Production",
          type: "Stage",
          state: 2,
          result: 0,
          startTime: new Date("2026-04-20T08:11:00Z"),
          finishTime: new Date("2026-04-20T08:30:00Z"),
        },
        {
          name: "Compile",
          type: "Job",
          state: 2,
          result: 0,
        },
      ],
    };
    fake.setPipelineRun("MyProj", 500, { build, timeline });
    const svc = new PipelinesReadService(fake);

    const result = await svc.get({ project: "MyProj", runId: 500 });

    expect(result.id).toBe(500);
    expect(result.pipelineName).toBe("Newton.n2-CI");
    expect(result.stages).toEqual([
      {
        name: "Build",
        status: "completed",
        result: "succeeded",
        startTime: "2026-04-20T08:01:00.000Z",
        finishTime: "2026-04-20T08:10:00.000Z",
      },
      {
        name: "Deploy to Production",
        status: "completed",
        result: "succeeded",
        startTime: "2026-04-20T08:11:00.000Z",
        finishTime: "2026-04-20T08:30:00.000Z",
      },
    ]);
  });

  it("returns empty stages when timeline is null (very old / pre-plan runs)", async () => {
    const fake = new FakeAdoClient();
    const build: Build = {
      id: 501,
      buildNumber: "20260101.1",
      definition: { id: 10, name: "Newton.n2-CI" },
      status: 2,
      result: 2,
      sourceBranch: "refs/heads/main",
    };
    fake.setPipelineRun("MyProj", 501, { build, timeline: null });
    const svc = new PipelinesReadService(fake);

    const result = await svc.get({ project: "MyProj", runId: 501 });

    expect(result.stages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/pipelines/readService.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `get` and stage shaper**

Inside `class PipelinesReadService`, add after `listRuns`:

```ts
  async get(args: { project: string; runId: number }): Promise<PipelineRunDetail> {
    const { build, timeline } = await this.client.getPipelineRun({
      project: args.project,
      runId: args.runId,
    });
    const stages = (timeline?.records ?? [])
      .filter((r) => r.type === "Stage")
      .map(shapeTimelineStage);
    return {
      ...shapeRun(build),
      stages,
    };
  }
```

Add the stage shaper at the bottom. Note: the `TimelineRecord` uses `state` (TimelineRecordState enum: 0=pending, 1=inProgress, 2=completed) and `result` (TaskResult enum: 0=succeeded, 1=succeededWithIssues, 2=failed, 3=canceled, 4=skipped, 5=abandoned):

```ts
const TIMELINE_STATE_FROM_ENUM: Record<number, string> = {
  0: "pending",
  1: "inProgress",
  2: "completed",
};

const TIMELINE_RESULT_FROM_ENUM: Record<number, string> = {
  0: "succeeded",
  1: "succeededWithIssues",
  2: "failed",
  3: "canceled",
  4: "skipped",
  5: "abandoned",
};

function shapeTimelineStage(r: TimelineRecord): PipelineRunDetail["stages"][number] {
  return {
    name: r.name ?? "",
    status: TIMELINE_STATE_FROM_ENUM[r.state ?? 0] ?? "unknown",
    result: TIMELINE_RESULT_FROM_ENUM[r.result ?? 0] ?? "unknown",
    startTime: r.startTime?.toISOString(),
    finishTime: r.finishTime?.toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/domains/pipelines/readService.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/pipelines/readService.ts test/unit/domains/pipelines/readService.test.ts
git commit -m "feat(phase-3): pipelines — get_pipeline_run with stages timeline"
```

---

## Task 13: Pipelines — `readTools.ts` and register in MCP

**Files:**
- Create: `src/domains/pipelines/readTools.ts`
- Modify: `src/mcp/registerTools.ts`

- [ ] **Step 1: Create the tools file**

Write `src/domains/pipelines/readTools.ts`:

```ts
import type { PipelinesReadService } from "./readService.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  ListPipelinesInput,
  ListPipelineRunsInput,
  PipelineRunId,
} from "./schemas.js";

export function buildPipelinesReadTools(svc: PipelinesReadService): ToolDefinition[] {
  return [
    {
      name: "list_pipelines",
      config: {
        title: "List build/pipeline definitions",
        description:
          "Lists build/pipeline definitions in a project. Covers both classic-build (type: " +
          "'classic') and YAML (type: 'yaml') pipelines. Optionally filter by repository id.",
        inputSchema: ListPipelinesInput,
      },
      handler: async (args) => svc.list(args as Parameters<typeof svc.list>[0]),
    },
    {
      name: "list_pipeline_runs",
      config: {
        title: "List pipeline runs (builds)",
        description:
          "Lists runs (builds) for pipelines in a project. Filter by pipelineId, branch " +
          "(e.g. 'refs/heads/main'), status, or result.",
        inputSchema: ListPipelineRunsInput,
      },
      handler: async (args) => svc.listRuns(args as Parameters<typeof svc.listRuns>[0]),
    },
    {
      name: "get_pipeline_run",
      config: {
        title: "Get a pipeline run with stages",
        description:
          "Returns run detail including the stages timeline. For YAML multi-stage pipelines, " +
          "the `stages` array is how you see 'did the Production stage succeed'.",
        inputSchema: PipelineRunId,
      },
      handler: async (args) => svc.get(args as Parameters<typeof svc.get>[0]),
    },
  ];
}
```

- [ ] **Step 2: Wire into `registerTools.ts`**

Edit `src/mcp/registerTools.ts`. Add imports with the others:

```ts
import { PipelinesReadService } from "../domains/pipelines/readService.js";
import { buildPipelinesReadTools } from "../domains/pipelines/readTools.js";
```

Extend `readTools`:

```ts
  const readTools = [
    ...buildIdentityTools(new IdentityService(client)),
    ...buildProjectsTools(new ProjectsService(client)),
    ...buildRepositoriesTools(new RepositoriesService(client)),
    ...buildPullRequestReadTools(new PullRequestsReadService(client)),
    ...buildReleasesReadTools(new ReleasesReadService(client)),
    ...buildPipelinesReadTools(new PipelinesReadService(client)),
  ];
```

- [ ] **Step 3: Build + test**

```bash
npm run typecheck
npm test
npm run build
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/domains/pipelines/readTools.ts src/mcp/registerTools.ts
git commit -m "feat(phase-3): register 3 pipeline read tools in MCP server"
```

---

## Task 14: Commits — schemas + `list_branches` with cwd auto-detect (TDD)

**Files:**
- Create: `src/domains/commits/schemas.ts`
- Create: `src/domains/commits/readService.ts`
- Create: `test/unit/domains/commits/readService.test.ts`

The commits domain is repo-scoped (not project-scoped), so it uses the cwd auto-detect pattern from the PR tools.

- [ ] **Step 1: Create the schemas file**

Write `src/domains/commits/schemas.ts`:

```ts
import { z } from "zod";

const repoCoords = {
  project: z.string().min(1).optional().describe(
    "ADO project name. If omitted, auto-detected from the current working directory's git remote.",
  ),
  repository: z.string().min(1).optional().describe(
    "ADO repository name. If omitted, auto-detected from the current working directory's git remote.",
  ),
};

export const ListBranchesInput = { ...repoCoords };

export const ListCommitsInput = {
  ...repoCoords,
  branch: z
    .string()
    .optional()
    .describe("Branch name (e.g. 'main'). Omit to get commits across all branches."),
  fromDate: z
    .string()
    .optional()
    .describe("ISO-8601 date/datetime lower bound for commit time (inclusive)."),
  toDate: z
    .string()
    .optional()
    .describe("ISO-8601 date/datetime upper bound for commit time (inclusive)."),
  author: z
    .string()
    .optional()
    .describe("Filter to commits by this author (name or email as appearing in git metadata)."),
  top: z.number().int().positive().max(200).optional().describe("Max results (default 25)."),
};
```

- [ ] **Step 2: Write the failing test**

Create `test/unit/domains/commits/readService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CommitsReadService } from "../../../../src/domains/commits/readService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type { GitBranchStats } from "../../../../src/ado/types.js";

const REPO = { project: "MyProject", repo: "MyRepo" };

describe("CommitsReadService.listBranches", () => {
  it("resolves repo from cwd when no args and shapes branches", async () => {
    const fake = new FakeAdoClient();
    const branches: GitBranchStats[] = [
      {
        name: "main",
        commit: { commitId: "abc123" },
        aheadCount: 0,
        behindCount: 0,
        isBaseVersion: true,
      },
      {
        name: "feature/x",
        commit: { commitId: "def456" },
        aheadCount: 3,
        behindCount: 1,
        isBaseVersion: false,
      },
    ];
    fake.setBranches(REPO.project, REPO.repo, branches);
    const svc = new CommitsReadService(fake, async () => REPO);

    const result = await svc.listBranches({});

    expect(result).toEqual([
      { name: "main", lastCommitId: "abc123", aheadCount: 0, behindCount: 0, isBaseVersion: true },
      { name: "feature/x", lastCommitId: "def456", aheadCount: 3, behindCount: 1, isBaseVersion: false },
    ]);
  });

  it("honors explicit project + repository args", async () => {
    const fake = new FakeAdoClient();
    fake.setBranches("OtherProj", "OtherRepo", [{ name: "main", commit: { commitId: "z" } }]);
    // Resolver deliberately wrong to prove explicit args win.
    const svc = new CommitsReadService(fake, async () => REPO);

    const result = await svc.listBranches({ project: "OtherProj", repository: "OtherRepo" });

    expect(result).toEqual([
      { name: "main", lastCommitId: "z", aheadCount: undefined, behindCount: undefined, isBaseVersion: undefined },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- test/unit/domains/commits/readService.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Write the service**

Create `src/domains/commits/readService.ts`:

```ts
import type { AdoClient } from "../../ado/client.js";
import type { GitBranchStats, GitCommitRef } from "../../ado/types.js";
import { detectRepo } from "../../git/detectRepo.js";
import {
  resolveRepo,
  type RepoResolver,
} from "../pullRequests/repoResolution.js";

export { RepoContextError } from "../pullRequests/repoResolution.js";

export interface BranchSummary {
  name: string;
  lastCommitId?: string;
  aheadCount?: number;
  behindCount?: number;
  isBaseVersion?: boolean;
}

export interface CommitSummary {
  commitId: string;
  comment?: string;
  author?: { name?: string; email?: string; date?: string };
  committer?: { name?: string; email?: string; date?: string };
  changeCounts?: { Add?: number; Edit?: number; Delete?: number };
  url?: string;
}

export class CommitsReadService {
  constructor(
    private readonly client: AdoClient,
    private readonly resolver: RepoResolver = detectRepo,
  ) {}

  async listBranches(args: {
    project?: string;
    repository?: string;
  }): Promise<BranchSummary[]> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const branches = await this.client.listBranches({ project, repository });
    return branches.map(shapeBranch);
  }
}

function shapeBranch(b: GitBranchStats): BranchSummary {
  return {
    name: b.name ?? "",
    lastCommitId: b.commit?.commitId,
    aheadCount: b.aheadCount,
    behindCount: b.behindCount,
    isBaseVersion: b.isBaseVersion,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- test/unit/domains/commits/readService.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domains/commits/schemas.ts src/domains/commits/readService.ts test/unit/domains/commits/readService.test.ts
git commit -m "feat(phase-3): commits — list_branches with cwd auto-detect"
```

---

## Task 15: Commits — `list_commits` with date/author filters (TDD)

**Files:**
- Modify: `src/domains/commits/readService.ts`
- Modify: `test/unit/domains/commits/readService.test.ts`

- [ ] **Step 1: Write the failing test**

Extend the import block at the top of `test/unit/domains/commits/readService.test.ts` to include `GitCommitRef`:

```ts
import type { GitBranchStats, GitCommitRef } from "../../../../src/ado/types.js";
```

Then append a new describe block at the bottom:

```ts
describe("CommitsReadService.listCommits", () => {
  it("forwards branch/date/author filters and shapes commits", async () => {
    const fake = new FakeAdoClient();
    const commits: GitCommitRef[] = [
      {
        commitId: "abc123",
        comment: "fix(foo): tweak",
        author: {
          name: "Alice",
          email: "alice@example.com",
          date: new Date("2026-04-21T10:00:00Z"),
        },
        committer: {
          name: "Alice",
          email: "alice@example.com",
          date: new Date("2026-04-21T10:00:00Z"),
        },
        changeCounts: { Add: 2, Edit: 3, Delete: 0 },
        url: "https://example.com/_apis/git/commits/abc123",
      },
    ];
    fake.setCommits(REPO.project, REPO.repo, commits);
    const svc = new CommitsReadService(fake, async () => REPO);

    const result = await svc.listCommits({
      branch: "main",
      fromDate: "2026-04-20T00:00:00Z",
      toDate: "2026-04-22T00:00:00Z",
      author: "alice",
      top: 10,
    });

    expect(result).toEqual([
      {
        commitId: "abc123",
        comment: "fix(foo): tweak",
        author: {
          name: "Alice",
          email: "alice@example.com",
          date: "2026-04-21T10:00:00.000Z",
        },
        committer: {
          name: "Alice",
          email: "alice@example.com",
          date: "2026-04-21T10:00:00.000Z",
        },
        changeCounts: { Add: 2, Edit: 3, Delete: 0 },
        url: "https://example.com/_apis/git/commits/abc123",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/commits/readService.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `listCommits`**

Inside `class CommitsReadService`, add after `listBranches`:

```ts
  async listCommits(args: {
    project?: string;
    repository?: string;
    branch?: string;
    fromDate?: string;
    toDate?: string;
    author?: string;
    top?: number;
  }): Promise<CommitSummary[]> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const commits = await this.client.listCommits({
      project,
      repository,
      branch: args.branch,
      fromDate: args.fromDate,
      toDate: args.toDate,
      author: args.author,
      top: args.top,
    });
    return commits.map(shapeCommit);
  }
```

Add the shaper at the bottom of the file:

```ts
function shapeCommit(c: GitCommitRef): CommitSummary {
  return {
    commitId: c.commitId ?? "",
    comment: c.comment,
    author: c.author
      ? {
          name: c.author.name,
          email: c.author.email,
          date: c.author.date?.toISOString(),
        }
      : undefined,
    committer: c.committer
      ? {
          name: c.committer.name,
          email: c.committer.email,
          date: c.committer.date?.toISOString(),
        }
      : undefined,
    changeCounts: c.changeCounts,
    url: c.url,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/domains/commits/readService.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/commits/readService.ts test/unit/domains/commits/readService.test.ts
git commit -m "feat(phase-3): commits — list_commits with date/author filters"
```

---

## Task 16: Commits — `readTools.ts` and register in MCP

**Files:**
- Create: `src/domains/commits/readTools.ts`
- Modify: `src/mcp/registerTools.ts`

- [ ] **Step 1: Create the tools file**

Write `src/domains/commits/readTools.ts`:

```ts
import type { CommitsReadService } from "./readService.js";
import type { ToolDefinition } from "../identity/tools.js";
import { ListBranchesInput, ListCommitsInput } from "./schemas.js";

export function buildCommitsReadTools(svc: CommitsReadService): ToolDefinition[] {
  return [
    {
      name: "list_branches",
      config: {
        title: "List branches in a repository",
        description:
          "Lists branches in an Azure DevOps git repository, each with the last commit id and " +
          "ahead/behind counts vs the base version. If `project` and `repository` are omitted, " +
          "they are auto-detected from the current working directory's git remote.",
        inputSchema: ListBranchesInput,
      },
      handler: async (args) =>
        svc.listBranches(args as Parameters<typeof svc.listBranches>[0]),
    },
    {
      name: "list_commits",
      config: {
        title: "List commits in a branch",
        description:
          "Lists commits with optional filters: branch (name, e.g. 'main'), fromDate/toDate " +
          "(ISO-8601), author (name or email substring). Use this to answer 'what changed on " +
          "X since last Monday?'. Project and repository auto-detect from cwd if omitted.",
        inputSchema: ListCommitsInput,
      },
      handler: async (args) =>
        svc.listCommits(args as Parameters<typeof svc.listCommits>[0]),
    },
  ];
}
```

- [ ] **Step 2: Wire into `registerTools.ts`**

Edit `src/mcp/registerTools.ts`. Add imports:

```ts
import { CommitsReadService } from "../domains/commits/readService.js";
import { buildCommitsReadTools } from "../domains/commits/readTools.js";
```

Extend `readTools`:

```ts
  const readTools = [
    ...buildIdentityTools(new IdentityService(client)),
    ...buildProjectsTools(new ProjectsService(client)),
    ...buildRepositoriesTools(new RepositoriesService(client)),
    ...buildPullRequestReadTools(new PullRequestsReadService(client)),
    ...buildReleasesReadTools(new ReleasesReadService(client)),
    ...buildPipelinesReadTools(new PipelinesReadService(client)),
    ...buildCommitsReadTools(new CommitsReadService(client)),
  ];
```

- [ ] **Step 3: Build + test**

```bash
npm run typecheck
npm test
npm run build
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/domains/commits/readTools.ts src/mcp/registerTools.ts
git commit -m "feat(phase-3): register 2 commits read tools in MCP server"
```

---

## Task 17: README + ROADMAP + version bump + final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Modify: `package.json`

- [ ] **Step 1: Update README — tool catalog**

In `README.md`, under the "### Read tools (always available)" section, append the following rows to the existing table (keep existing rows intact):

```markdown
| `list_release_definitions` | Lists classic Release pipeline definitions in a project. |
| `list_releases` | Lists release runs. Filter by definitionId or status (active/abandoned/draft). |
| `get_release` | Full release: stages (name, status, who deployed, when) and artifacts (source build + branch). |
| `list_deployments` | Per-stage flattened view — best for "who last deployed X to production?". |
| `list_pipelines` | Lists build/pipeline definitions. Covers classic-build and YAML; `type` field distinguishes. |
| `list_pipeline_runs` | Lists runs (builds). Filter by pipelineId, branch, status, result. |
| `get_pipeline_run` | Run detail with stages timeline — how you see if a YAML multi-stage stage succeeded. |
| `list_branches` | Branches in a repo with last commit id + ahead/behind. Auto-detects repo from cwd. |
| `list_commits` | Commits on a branch. Filter by fromDate, toDate, author, top. Auto-detects repo from cwd. |
```

- [ ] **Step 2: Update README — PAT scopes**

In `README.md`, find the "## Required PAT scopes" table and replace the two data rows with:

```markdown
| Read-only (read tools only) | **Code (read)**, **Identity (read)**, **Build (read)**, **Release (read)** |
| Full (default — read + write tools) | **Code (read & write)**, **Pull Request (read & write)**, **Identity (read)**, **Build (read)**, **Release (read)** |
```

- [ ] **Step 3: Update README — opening paragraph**

In `README.md`, update the opening description paragraph. Replace the existing opening paragraph (starting with "Azure DevOps MCP server for Claude Code...") with:

```markdown
Azure DevOps MCP server for Claude Code and other MCP hosts. Supports both **Azure DevOps Server** (on-prem) and **Azure DevOps Services** (cloud). Ships read tools for PRs, releases, pipelines, and commit history; plus the full PR review write workflow — comment, reply, resolve threads, vote, edit PR metadata, manage reviewers. Read-only mode is available for users who want a restricted surface.
```

- [ ] **Step 4: Update ROADMAP**

Edit `docs/ROADMAP.md`. The current Roadmap has Phase 3 (Pipelines) and Phase 4 (Releases) both marked as 💡 ideas — this plan ships them both, plus commits. Replace the two entries (from `## 💡 Phase 3 — Pipelines` through the end of `## 💡 Phase 4 — Releases` block, stopping before `## 💡 Phase 5 — Work items`) with a single consolidated entry:

```markdown
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
```

- [ ] **Step 5: Bump version**

Edit `package.json` — change the `"version"` field from `"0.2.0"` to `"0.3.0"`.

- [ ] **Step 6: Full test suite + build**

```bash
npm run typecheck
npm test
npm run build
```
Expected: all pass. The tool count in `npm test` output should now be 17 read tools + 8 write tools (Phase 2) = 25 tool surfaces registerable, though tests assert services not tools.

- [ ] **Step 7: Manual smoke test registration**

```bash
node -e "import('./dist/mcp/registerTools.js').then(m => console.log('loaded:', Object.keys(m)))"
```
Expected: prints `loaded: [ 'registerAllTools' ]` with no import error.

- [ ] **Step 8: Commit**

```bash
git add README.md docs/ROADMAP.md package.json
git commit -m "docs(phase-3): update README + ROADMAP; bump to 0.3.0"
```

- [ ] **Step 9: Verify branch state**

```bash
git log --oneline -20
git status
```
Expected: clean working tree; ~17 new commits atop the Phase 2 baseline.
