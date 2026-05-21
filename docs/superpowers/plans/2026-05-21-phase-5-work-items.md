# Phase 5 — Work Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `workItems` domain with five tools — `list_work_items`, `get_work_item`, `link_work_item_to_pr`, `update_work_item_state`, `add_work_item_comment` — backed by the Azure DevOps `WorkItemTrackingApi` (plus one `GitApi` call for PR linkage).

**Architecture:** New domain folder `src/domains/workItems/` mirrors the pipelines/releases read/write split. Domain services depend only on the `AdoClient` seam (`src/ado/client.ts`); the production implementation lives in `SdkAdoClient` and the test double in `FakeAdoClient`. Services shape raw SDK types into trimmed payloads. Read tools register unconditionally; write tools register only when not read-only, via the existing bucket in `registerTools.ts`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `azure-devops-node-api`, Zod raw-shape input schemas, Vitest, MCP SDK.

---

## Spec deviation (record before starting)

The spec proposed `list_work_items`' `linkedToPr` filter via templated WIQL. WIQL filtering by artifact link is awkward; the SDK exposes `GitApi.getPullRequestWorkItemRefs(repositoryId, pullRequestId, project)` returning the linked work-item ids directly. **Decision:** `linkedToPr` uses `getPullRequestWorkItemRefs` + `getWorkItems`; the other three filters (`myActive`, `currentIteration`, `tag`) use `queryByWiql`. All other spec decisions stand.

`link_work_item_to_pr` builds the PR artifact URI `vstfs:///Git/PullRequestId/{projectId}%2F{repoId}%2F{prId}` from GUIDs resolved via the existing `AdoClient.getPullRequest`. **Assumption:** the work item and the PR live in the same `project` (single `project` input). Note this in the tool description.

---

## File structure

- Create: `src/domains/workItems/schemas.ts` — Zod input shapes
- Create: `src/domains/workItems/readService.ts` — `WorkItemsReadService` (list + get) + shaping
- Create: `src/domains/workItems/readTools.ts` — 2 read `ToolDefinition`s
- Create: `src/domains/workItems/writeService.ts` — `WorkItemsWriteService` (link + state + comment)
- Create: `src/domains/workItems/writeTools.ts` — 3 write `ToolDefinition`s
- Modify: `src/ado/types.ts` — re-export WorkItemTracking types + `Operation`/`WorkItemExpand` enum values
- Modify: `src/ado/client.ts` — add 8 method signatures to `AdoClient`
- Modify: `src/ado/sdkClient.ts` — implement the 8 methods
- Modify: `test/fakes/FakeAdoClient.ts` — implement the 8 methods + setters/recorders
- Modify: `src/mcp/registerTools.ts` — wire the new services/tools
- Create: `test/unit/domains/workItems/readService.test.ts`
- Create: `test/unit/domains/workItems/writeService.test.ts`
- Modify: `docs/ROADMAP.md` — flip Phase 5 → Done
- Modify: `package.json` — version bump

Test command throughout: `npx vitest run <path>` for one file, `npm test` for all. Type/build check: `npm run build` (tsc).

---

## Task 1: Re-export WorkItemTracking types

**Files:**
- Modify: `src/ado/types.ts`

- [ ] **Step 1: Add the re-export block**

Append to `src/ado/types.ts` (after the existing Build block):

```ts
// Work items (WorkItemTrackingApi)
export type {
  WorkItem,
  WorkItemReference,
  WorkItemRelation,
  WorkItemQueryResult,
  WorkItemStateColor,
  WorkItemType,
  Comment as WorkItemComment,
  CommentList,
} from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";
// WorkItemExpand is used as a *value* (expand: WorkItemExpand.All), so it's a
// runtime export, not a type-only one.
export { WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";

// JSON Patch (used to mutate work items) + the generic resource ref returned by
// getPullRequestWorkItemRefs.
export type {
  JsonPatchOperation,
  ResourceRef,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";
export { Operation } from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: PASS (no new errors). The re-exports resolve against the installed SDK `.d.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/ado/types.ts
git commit -m "feat(phase-5): re-export WorkItemTracking + JsonPatch types"
```

---

## Task 2: Extend the AdoClient interface

**Files:**
- Modify: `src/ado/client.ts`

- [ ] **Step 1: Add the type imports**

In `src/ado/client.ts`, add to the existing import-from-`./types.js` block:

```ts
  WorkItem,
  WorkItemStateColor,
  ResourceRef,
  WorkItemComment,
  JsonPatchOperation,
```

- [ ] **Step 2: Add the 8 method signatures**

Append inside the `AdoClient` interface (before the closing brace):

```ts
  // work items
  /** Run a WIQL query and return matching work-item ids (already extracted). */
  queryWorkItemIds(args: {
    project: string;
    wiql: string;
    /** Team name — required by the @CurrentIteration macro; ignored otherwise. */
    team?: string;
  }): Promise<number[]>;

  /** Batch-fetch lightweight work items (default fields) for a list of ids. */
  getWorkItemsSummary(args: { project: string; ids: number[] }): Promise<WorkItem[]>;

  /** Full work item: all fields + relations (expand: All). Comments fetched separately. */
  getWorkItem(args: { project: string; id: number }): Promise<WorkItem>;

  /** Recent comments for a work item (newer comments API). */
  getWorkItemComments(args: {
    project: string;
    id: number;
    top?: number;
  }): Promise<WorkItemComment[]>;

  /** Work-item ids linked to a PR, via the Git artifact-ref endpoint. */
  getPullRequestWorkItemRefs(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<number[]>;

  /** Allowed state names for a work-item type (used to pre-validate transitions). */
  getWorkItemTypeStates(args: { project: string; type: string }): Promise<string[]>;

  /** Apply a JSON Patch document to a work item. */
  updateWorkItem(args: {
    project: string;
    id: number;
    patch: JsonPatchOperation[];
  }): Promise<WorkItem>;

  /** Append a discussion comment. */
  addWorkItemComment(args: {
    project: string;
    id: number;
    text: string;
  }): Promise<WorkItemComment>;
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: FAIL — `SdkAdoClient` and `FakeAdoClient` no longer satisfy `AdoClient` (missing methods). This is expected; Tasks 3 and 6 add the implementations. Confirm the only errors are "missing properties" on those two classes.

- [ ] **Step 4: Commit**

```bash
git add src/ado/client.ts
git commit -m "feat(phase-5): add work-item methods to AdoClient interface"
```

---

## Task 3: Implement the methods on FakeAdoClient

**Files:**
- Modify: `test/fakes/FakeAdoClient.ts`

The fake records write calls and returns injected canned data, matching the existing `setNext*` / `get*` recorder pattern.

- [ ] **Step 1: Add the type imports**

Add to the import-from-`../../src/ado/types.js` block in `test/fakes/FakeAdoClient.ts`:

```ts
  WorkItem,
  WorkItemStateColor,
  WorkItemComment,
  JsonPatchOperation,
```

- [ ] **Step 2: Add fields, setters, recorders, and method implementations**

Add these fields near the other private fields in the class:

```ts
  // work items
  private wiqlIds: number[] = [];
  private wiqlCalls: Array<{ project: string; wiql: string; team?: string }> = [];
  private workItemsSummary = new Map<string, WorkItem[]>(); // project → items (matched by id)
  private workItemById = new Map<string, WorkItem>(); // `${project} ${id}` → item
  private workItemComments = new Map<string, WorkItemComment[]>(); // `${project} ${id}`
  private prWorkItemRefs = new Map<string, number[]>(); // `${project} ${repo} ${prId}`
  private typeStates = new Map<string, string[]>(); // `${project} ${type}`
  private updatedWorkItems: Array<{ project: string; id: number; patch: JsonPatchOperation[] }> = [];
  private nextUpdatedWorkItem?: WorkItem;
  private addedWorkItemComments: Array<{ project: string; id: number; text: string }> = [];
  private nextAddedComment?: WorkItemComment;
```

Add these setters/getters near the other `set*`/`get*` methods:

```ts
  setWiqlIds(ids: number[]): void {
    this.wiqlIds = ids;
  }
  getWiqlCalls() {
    return this.wiqlCalls;
  }
  setWorkItemsSummary(project: string, items: WorkItem[]): void {
    this.workItemsSummary.set(project, items);
  }
  setWorkItem(project: string, id: number, item: WorkItem): void {
    this.workItemById.set(`${project} ${id}`, item);
  }
  setWorkItemComments(project: string, id: number, comments: WorkItemComment[]): void {
    this.workItemComments.set(`${project} ${id}`, comments);
  }
  setPrWorkItemRefs(project: string, repository: string, prId: number, ids: number[]): void {
    this.prWorkItemRefs.set(`${project} ${repository} ${prId}`, ids);
  }
  setTypeStates(project: string, type: string, states: string[]): void {
    this.typeStates.set(`${project} ${type}`, states);
  }
  setNextUpdatedWorkItem(item: WorkItem): void {
    this.nextUpdatedWorkItem = item;
  }
  getUpdatedWorkItems() {
    return this.updatedWorkItems;
  }
  setNextAddedComment(comment: WorkItemComment): void {
    this.nextAddedComment = comment;
  }
  getAddedWorkItemComments() {
    return this.addedWorkItemComments;
  }
```

Add these method implementations near the other `async` methods:

```ts
  async queryWorkItemIds(args: { project: string; wiql: string; team?: string }): Promise<number[]> {
    this.throwIfInjected("queryWorkItemIds");
    this.wiqlCalls.push({ project: args.project, wiql: args.wiql, team: args.team });
    return this.wiqlIds;
  }

  async getWorkItemsSummary(args: { project: string; ids: number[] }): Promise<WorkItem[]> {
    this.throwIfInjected("getWorkItemsSummary");
    const all = this.workItemsSummary.get(args.project) ?? [];
    return all.filter((w) => args.ids.includes((w as { id?: number }).id ?? -1));
  }

  async getWorkItem(args: { project: string; id: number }): Promise<WorkItem> {
    this.throwIfInjected("getWorkItem");
    const item = this.workItemById.get(`${args.project} ${args.id}`);
    if (!item) throw new Error(`FakeAdoClient.getWorkItem: none configured for ${args.project} ${args.id}`);
    return item;
  }

  async getWorkItemComments(args: { project: string; id: number; top?: number }): Promise<WorkItemComment[]> {
    this.throwIfInjected("getWorkItemComments");
    return this.workItemComments.get(`${args.project} ${args.id}`) ?? [];
  }

  async getPullRequestWorkItemRefs(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<number[]> {
    this.throwIfInjected("getPullRequestWorkItemRefs");
    return this.prWorkItemRefs.get(`${args.project} ${args.repository} ${args.pullRequestId}`) ?? [];
  }

  async getWorkItemTypeStates(args: { project: string; type: string }): Promise<string[]> {
    this.throwIfInjected("getWorkItemTypeStates");
    return this.typeStates.get(`${args.project} ${args.type}`) ?? [];
  }

  async updateWorkItem(args: {
    project: string;
    id: number;
    patch: JsonPatchOperation[];
  }): Promise<WorkItem> {
    this.throwIfInjected("updateWorkItem");
    this.updatedWorkItems.push(args);
    return this.nextUpdatedWorkItem ?? ({ id: args.id } as WorkItem);
  }

  async addWorkItemComment(args: {
    project: string;
    id: number;
    text: string;
  }): Promise<WorkItemComment> {
    this.throwIfInjected("addWorkItemComment");
    this.addedWorkItemComments.push(args);
    return this.nextAddedComment ?? ({ text: args.text } as WorkItemComment);
  }
```

> Note: `throwIfInjected(name)` is the existing fake helper that throws a pre-set error for a named method — used by tests that exercise error mapping. Confirm its exact name by grep before writing; match whatever the fake already uses.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: FAIL — only `SdkAdoClient` still missing the 8 methods. `FakeAdoClient` errors should be gone.

- [ ] **Step 4: Commit**

```bash
git add test/fakes/FakeAdoClient.ts
git commit -m "test(phase-5): implement work-item methods on FakeAdoClient"
```

---

## Task 4: Input schemas

**Files:**
- Create: `src/domains/workItems/schemas.ts`

- [ ] **Step 1: Write the schemas**

```ts
import { z } from "zod";

export const ListWorkItemsInput = {
  project: z.string().min(1).describe("ADO project name."),
  filter: z
    .enum(["myActive", "linkedToPr", "currentIteration", "tag"])
    .describe(
      "Which canned query to run. 'myActive' = open items assigned to the PAT's user; " +
        "'linkedToPr' = items linked to a PR (needs repository + pullRequestId); " +
        "'currentIteration' = open items in the team's current sprint (needs team); " +
        "'tag' = items carrying a tag (needs tag).",
    ),
  repository: z.string().min(1).optional().describe("Repository name. Required when filter='linkedToPr'."),
  pullRequestId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("PR id. Required when filter='linkedToPr'."),
  team: z.string().min(1).optional().describe("Team name. Required when filter='currentIteration'."),
  tag: z.string().min(1).optional().describe("Tag value. Required when filter='tag'."),
};

export const GetWorkItemInput = {
  project: z.string().min(1).describe("ADO project name."),
  workItemId: z.number().int().positive().describe("Work item id (integer)."),
};

export const LinkWorkItemToPrInput = {
  project: z.string().min(1).describe("ADO project name (work item and PR assumed in the same project)."),
  workItemId: z.number().int().positive().describe("Work item id to link."),
  repository: z.string().min(1).describe("Repository name containing the PR."),
  pullRequestId: z.number().int().positive().describe("Pull request id to link to the work item."),
};

export const UpdateWorkItemStateInput = {
  project: z.string().min(1).describe("ADO project name."),
  workItemId: z.number().int().positive().describe("Work item id."),
  state: z
    .string()
    .min(1)
    .describe(
      "Target state name (e.g. 'Active', 'Resolved', 'Closed'). Validated against the work-item " +
        "type's allowed states before submitting; an invalid state returns the list of valid ones.",
    ),
};

export const AddWorkItemCommentInput = {
  project: z.string().min(1).describe("ADO project name."),
  workItemId: z.number().int().positive().describe("Work item id."),
  text: z.string().min(1).describe("Comment body (markdown supported by ADO)."),
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: FAIL only on missing `SdkAdoClient` methods (schemas themselves compile clean).

- [ ] **Step 3: Commit**

```bash
git add src/domains/workItems/schemas.ts
git commit -m "feat(phase-5): work-item tool input schemas"
```

---

## Task 5: Read service — list + get (with tests)

**Files:**
- Create: `src/domains/workItems/readService.ts`
- Test: `test/unit/domains/workItems/readService.test.ts`

- [ ] **Step 1: Write the read service**

```ts
import type { AdoClient } from "../../ado/client.js";
import type { WorkItem, WorkItemComment } from "../../ado/types.js";

export interface WorkItemSummary {
  id: number;
  workItemType: string;
  title: string;
  state: string;
  assignedTo?: string;
}

export interface WorkItemRelationInfo {
  rel: string;
  url: string;
  name?: string;
}

export interface WorkItemCommentInfo {
  id?: number;
  text?: string;
  createdBy?: string;
  createdDate?: string;
}

export interface WorkItemDetail {
  id: number;
  /** Raw field map keyed by reference name (e.g. "System.Title"). Schema varies by template. */
  fields: Record<string, unknown>;
  relations: WorkItemRelationInfo[];
  comments: WorkItemCommentInfo[];
}

// Build the WIQL string for the non-PR filters. Single quotes in `tag` are
// escaped per WIQL rules (double them).
export function buildWiql(args: {
  filter: "myActive" | "currentIteration" | "tag";
  tag?: string;
}): string {
  const base = "SELECT [System.Id] FROM WorkItems WHERE ";
  const open = "[System.State] NOT IN ('Closed','Removed','Done')";
  switch (args.filter) {
    case "myActive":
      return `${base}[System.AssignedTo] = @me AND ${open}`;
    case "currentIteration":
      return `${base}[System.IterationPath] = @CurrentIteration AND ${open}`;
    case "tag": {
      const safe = (args.tag ?? "").replace(/'/g, "''");
      return `${base}[System.Tags] CONTAINS '${safe}'`;
    }
  }
}

function fieldString(item: WorkItem, ref: string): string {
  const v = (item.fields ?? {})[ref];
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function shapeSummary(item: WorkItem): WorkItemSummary {
  const assigned = (item.fields ?? {})["System.AssignedTo"] as
    | { displayName?: string }
    | string
    | undefined;
  return {
    id: (item as { id?: number }).id ?? 0,
    workItemType: fieldString(item, "System.WorkItemType"),
    title: fieldString(item, "System.Title"),
    state: fieldString(item, "System.State"),
    assignedTo:
      typeof assigned === "object" ? assigned?.displayName : (assigned as string | undefined),
  };
}

function shapeComment(c: WorkItemComment): WorkItemCommentInfo {
  const createdBy = (c as { createdBy?: { displayName?: string } }).createdBy?.displayName;
  const createdDate = (c as { createdDate?: Date }).createdDate;
  return {
    id: (c as { id?: number }).id,
    text: (c as { text?: string }).text,
    createdBy,
    createdDate: createdDate instanceof Date ? createdDate.toISOString() : undefined,
  };
}

export class WorkItemsReadService {
  constructor(private readonly client: AdoClient) {}

  async list(args: {
    project: string;
    filter: "myActive" | "linkedToPr" | "currentIteration" | "tag";
    repository?: string;
    pullRequestId?: number;
    team?: string;
    tag?: string;
  }): Promise<WorkItemSummary[]> {
    let ids: number[];
    if (args.filter === "linkedToPr") {
      if (!args.repository || !args.pullRequestId) {
        throw new Error("list_work_items: filter 'linkedToPr' requires repository and pullRequestId");
      }
      ids = await this.client.getPullRequestWorkItemRefs({
        project: args.project,
        repository: args.repository,
        pullRequestId: args.pullRequestId,
      });
    } else {
      if (args.filter === "currentIteration" && !args.team) {
        throw new Error("list_work_items: filter 'currentIteration' requires team");
      }
      if (args.filter === "tag" && !args.tag) {
        throw new Error("list_work_items: filter 'tag' requires tag");
      }
      const wiql = buildWiql({ filter: args.filter, tag: args.tag });
      ids = await this.client.queryWorkItemIds({ project: args.project, wiql, team: args.team });
    }
    if (ids.length === 0) return [];
    const items = await this.client.getWorkItemsSummary({ project: args.project, ids });
    return items.map(shapeSummary);
  }

  async get(args: { project: string; workItemId: number }): Promise<WorkItemDetail> {
    const item = await this.client.getWorkItem({ project: args.project, id: args.workItemId });
    const comments = await this.client.getWorkItemComments({
      project: args.project,
      id: args.workItemId,
    });
    const relations: WorkItemRelationInfo[] = ((item as { relations?: unknown[] }).relations ?? []).map(
      (r) => {
        const rel = r as { rel?: string; url?: string; attributes?: { name?: string } };
        return { rel: rel.rel ?? "", url: rel.url ?? "", name: rel.attributes?.name };
      },
    );
    return {
      id: (item as { id?: number }).id ?? args.workItemId,
      fields: (item.fields ?? {}) as Record<string, unknown>,
      relations,
      comments: comments.map(shapeComment),
    };
  }
}
```

- [ ] **Step 2: Write the failing tests**

`test/unit/domains/workItems/readService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { WorkItemsReadService, buildWiql } from "../../../../src/domains/workItems/readService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type { WorkItem, WorkItemComment } from "../../../../src/ado/types.js";

function makeSvc() {
  const fake = new FakeAdoClient();
  const svc = new WorkItemsReadService(fake);
  return { svc, fake };
}

function wi(id: number, fields: Record<string, unknown>): WorkItem {
  return { id, fields } as unknown as WorkItem;
}

describe("buildWiql", () => {
  it("myActive filters by @me and open states", () => {
    const q = buildWiql({ filter: "myActive" });
    expect(q).toContain("[System.AssignedTo] = @me");
    expect(q).toContain("NOT IN ('Closed','Removed','Done')");
  });
  it("currentIteration uses the @CurrentIteration macro", () => {
    expect(buildWiql({ filter: "currentIteration" })).toContain("@CurrentIteration");
  });
  it("tag uses CONTAINS and escapes single quotes", () => {
    expect(buildWiql({ filter: "tag", tag: "o'brien" })).toContain("CONTAINS 'o''brien'");
  });
});

describe("WorkItemsReadService.list", () => {
  it("runs WIQL for myActive and shapes summaries", async () => {
    const { svc, fake } = makeSvc();
    fake.setWiqlIds([10]);
    fake.setWorkItemsSummary("Proj", [
      wi(10, {
        "System.WorkItemType": "Bug",
        "System.Title": "Crash",
        "System.State": "Active",
        "System.AssignedTo": { displayName: "Vasek" },
      }),
    ]);
    const out = await svc.list({ project: "Proj", filter: "myActive" });
    expect(fake.getWiqlCalls()[0]?.wiql).toContain("@me");
    expect(out).toEqual([
      { id: 10, workItemType: "Bug", title: "Crash", state: "Active", assignedTo: "Vasek" },
    ]);
  });

  it("passes team through for currentIteration", async () => {
    const { svc, fake } = makeSvc();
    fake.setWiqlIds([]);
    await svc.list({ project: "Proj", filter: "currentIteration", team: "Squad" });
    expect(fake.getWiqlCalls()[0]?.team).toBe("Squad");
  });

  it("throws when currentIteration is missing team", async () => {
    const { svc } = makeSvc();
    await expect(svc.list({ project: "Proj", filter: "currentIteration" })).rejects.toThrow(/team/);
  });

  it("uses PR work-item refs for linkedToPr (no WIQL)", async () => {
    const { svc, fake } = makeSvc();
    fake.setPrWorkItemRefs("Proj", "repo", 5, [10]);
    fake.setWorkItemsSummary("Proj", [
      wi(10, { "System.WorkItemType": "Task", "System.Title": "T", "System.State": "New" }),
    ]);
    const out = await svc.list({
      project: "Proj",
      filter: "linkedToPr",
      repository: "repo",
      pullRequestId: 5,
    });
    expect(fake.getWiqlCalls()).toHaveLength(0);
    expect(out[0]?.id).toBe(10);
  });

  it("throws when linkedToPr is missing repository/pullRequestId", async () => {
    const { svc } = makeSvc();
    await expect(svc.list({ project: "Proj", filter: "linkedToPr" })).rejects.toThrow(/repository/);
  });

  it("returns [] without fetching when no ids match", async () => {
    const { svc, fake } = makeSvc();
    fake.setWiqlIds([]);
    expect(await svc.list({ project: "Proj", filter: "myActive" })).toEqual([]);
  });
});

describe("WorkItemsReadService.get", () => {
  it("returns raw fields keyed by ref name plus relations and comments", async () => {
    const { svc, fake } = makeSvc();
    fake.setWorkItem("Proj", 10, {
      id: 10,
      fields: { "System.Title": "Crash", "Custom.Foo": 42 },
      relations: [
        { rel: "ArtifactLink", url: "vstfs:///x", attributes: { name: "Pull Request" } },
      ],
    } as unknown as WorkItem);
    fake.setWorkItemComments("Proj", 10, [
      { id: 1, text: "hi", createdBy: { displayName: "Vasek" }, createdDate: new Date("2026-05-21T00:00:00Z") } as unknown as WorkItemComment,
    ]);
    const out = await svc.get({ project: "Proj", workItemId: 10 });
    expect(out.fields["System.Title"]).toBe("Crash");
    expect(out.fields["Custom.Foo"]).toBe(42);
    expect(out.relations[0]).toEqual({ rel: "ArtifactLink", url: "vstfs:///x", name: "Pull Request" });
    expect(out.comments[0]).toEqual({
      id: 1,
      text: "hi",
      createdBy: "Vasek",
      createdDate: "2026-05-21T00:00:00.000Z",
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/unit/domains/workItems/readService.test.ts`
Expected: PASS (service written in Step 1). If you are doing strict red-first, comment out `readService.ts` body to see the import fail, then restore. Otherwise confirm green.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: FAIL only on `SdkAdoClient` missing methods.

- [ ] **Step 5: Commit**

```bash
git add src/domains/workItems/readService.ts test/unit/domains/workItems/readService.test.ts
git commit -m "feat(phase-5): work-items read service (list + get) with tests"
```

---

## Task 6: Read tools

**Files:**
- Create: `src/domains/workItems/readTools.ts`

- [ ] **Step 1: Write the read tools**

```ts
import type { WorkItemsReadService } from "./readService.js";
import type { ToolDefinition } from "../identity/tools.js";
import { ListWorkItemsInput, GetWorkItemInput } from "./schemas.js";

export function buildWorkItemsReadTools(svc: WorkItemsReadService): ToolDefinition[] {
  return [
    {
      name: "list_work_items",
      config: {
        title: "List work items by a canned filter",
        description:
          "Finds work items via one of four canned queries (no raw WIQL): 'myActive' (open items " +
          "assigned to you), 'linkedToPr' (items linked to a PR — pass repository + pullRequestId), " +
          "'currentIteration' (open items in a team's current sprint — pass team), or 'tag' (pass tag). " +
          "Returns trimmed rows; use `get_work_item` for full detail.",
        inputSchema: ListWorkItemsInput,
      },
      handler: async (args) => svc.list(args as Parameters<typeof svc.list>[0]),
    },
    {
      name: "get_work_item",
      config: {
        title: "Get a work item's full detail",
        description:
          "Returns one work item: all fields keyed by reference name (e.g. 'System.Title' — the set " +
          "varies by process template), relations (parent/child/related/PR artifact links), and recent " +
          "comments.",
        inputSchema: GetWorkItemInput,
      },
      handler: async (args) => svc.get(args as Parameters<typeof svc.get>[0]),
    },
  ];
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: FAIL only on `SdkAdoClient` missing methods.

- [ ] **Step 3: Commit**

```bash
git add src/domains/workItems/readTools.ts
git commit -m "feat(phase-5): work-items read tool definitions"
```

---

## Task 7: Write service — link + state + comment (with tests)

**Files:**
- Create: `src/domains/workItems/writeService.ts`
- Test: `test/unit/domains/workItems/writeService.test.ts`

- [ ] **Step 1: Write the write service**

```ts
import type { AdoClient } from "../../ado/client.js";
import { Operation } from "../../ado/types.js";
import type { JsonPatchOperation } from "../../ado/types.js";

export interface LinkResult {
  workItemId: number;
  pullRequestId: number;
  linked: true;
}

export interface UpdateStateResult {
  workItemId: number;
  state: string;
}

export interface AddCommentResult {
  workItemId: number;
  commentId?: number;
}

// vstfs artifact URI for a PR. Project + repo are GUIDs; the three segments are
// joined by URL-encoded slashes (%2F), per the ADO artifact-link format.
export function buildPrArtifactUri(projectId: string, repoId: string, prId: number): string {
  return `vstfs:///Git/PullRequestId/${projectId}%2F${repoId}%2F${prId}`;
}

export class WorkItemsWriteService {
  constructor(private readonly client: AdoClient) {}

  async linkToPr(args: {
    project: string;
    workItemId: number;
    repository: string;
    pullRequestId: number;
  }): Promise<LinkResult> {
    // Resolve PR + repo GUIDs from the existing PR read path.
    const pr = await this.client.getPullRequest({
      project: args.project,
      repository: args.repository,
      pullRequestId: args.pullRequestId,
    });
    const repoId = pr.repository?.id;
    const projectId = pr.repository?.project?.id;
    if (!repoId || !projectId) {
      throw new Error(
        `linkToPr: could not resolve repository/project id for PR ${args.pullRequestId}`,
      );
    }
    const url = buildPrArtifactUri(projectId, repoId, args.pullRequestId);
    const patch: JsonPatchOperation[] = [
      {
        op: Operation.Add,
        path: "/relations/-",
        value: { rel: "ArtifactLink", url, attributes: { name: "Pull Request" } },
      },
    ];
    await this.client.updateWorkItem({ project: args.project, id: args.workItemId, patch });
    return { workItemId: args.workItemId, pullRequestId: args.pullRequestId, linked: true };
  }

  async updateState(args: {
    project: string;
    workItemId: number;
    state: string;
  }): Promise<UpdateStateResult> {
    // Resolve the work item's type so we can validate the target state.
    const item = await this.client.getWorkItem({ project: args.project, id: args.workItemId });
    const type = ((item.fields ?? {})["System.WorkItemType"] as string | undefined) ?? "";
    const allowed = await this.client.getWorkItemTypeStates({ project: args.project, type });
    if (!allowed.includes(args.state)) {
      throw new Error(
        `Invalid state '${args.state}' for work-item type '${type}'. Valid states: ${allowed.join(", ")}.`,
      );
    }
    const patch: JsonPatchOperation[] = [
      { op: Operation.Add, path: "/fields/System.State", value: args.state },
    ];
    await this.client.updateWorkItem({ project: args.project, id: args.workItemId, patch });
    return { workItemId: args.workItemId, state: args.state };
  }

  async addComment(args: {
    project: string;
    workItemId: number;
    text: string;
  }): Promise<AddCommentResult> {
    const c = await this.client.addWorkItemComment({
      project: args.project,
      id: args.workItemId,
      text: args.text,
    });
    return { workItemId: args.workItemId, commentId: (c as { id?: number }).id };
  }
}
```

- [ ] **Step 2: Write the failing tests**

`test/unit/domains/workItems/writeService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  WorkItemsWriteService,
  buildPrArtifactUri,
} from "../../../../src/domains/workItems/writeService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import { Operation } from "../../../../src/ado/types.js";
import type { GitPullRequest, WorkItem } from "../../../../src/ado/types.js";

function makeSvc() {
  const fake = new FakeAdoClient();
  const svc = new WorkItemsWriteService(fake);
  return { svc, fake };
}

describe("buildPrArtifactUri", () => {
  it("joins guids with encoded slashes", () => {
    expect(buildPrArtifactUri("P", "R", 7)).toBe("vstfs:///Git/PullRequestId/P%2FR%2F7");
  });
});

describe("WorkItemsWriteService.linkToPr", () => {
  it("resolves guids from the PR and patches /relations with an ArtifactLink", async () => {
    const { svc, fake } = makeSvc();
    fake.setPullRequest({
      project: "Proj",
      repository: "repo",
      pullRequestId: 7,
      pr: { repository: { id: "repo-guid", project: { id: "proj-guid" } } } as unknown as GitPullRequest,
    });
    const result = await svc.linkToPr({
      project: "Proj",
      workItemId: 10,
      repository: "repo",
      pullRequestId: 7,
    });
    const call = fake.getUpdatedWorkItems()[0]!;
    expect(call.id).toBe(10);
    expect(call.patch[0]?.op).toBe(Operation.Add);
    expect(call.patch[0]?.path).toBe("/relations/-");
    expect((call.patch[0]?.value as { url: string }).url).toBe(
      "vstfs:///Git/PullRequestId/proj-guid%2Frepo-guid%2F7",
    );
    expect(result.linked).toBe(true);
  });
});

describe("WorkItemsWriteService.updateState", () => {
  it("patches System.State when the target is a valid state", async () => {
    const { svc, fake } = makeSvc();
    fake.setWorkItem("Proj", 10, { id: 10, fields: { "System.WorkItemType": "Bug" } } as unknown as WorkItem);
    fake.setTypeStates("Proj", "Bug", ["New", "Active", "Resolved", "Closed"]);
    const result = await svc.updateState({ project: "Proj", workItemId: 10, state: "Active" });
    const call = fake.getUpdatedWorkItems()[0]!;
    expect(call.patch[0]?.path).toBe("/fields/System.State");
    expect(call.patch[0]?.value).toBe("Active");
    expect(result.state).toBe("Active");
  });

  it("rejects an invalid state with the list of valid ones and never patches", async () => {
    const { svc, fake } = makeSvc();
    fake.setWorkItem("Proj", 10, { id: 10, fields: { "System.WorkItemType": "Bug" } } as unknown as WorkItem);
    fake.setTypeStates("Proj", "Bug", ["New", "Active", "Resolved", "Closed"]);
    await expect(
      svc.updateState({ project: "Proj", workItemId: 10, state: "Frozen" }),
    ).rejects.toThrow(/Valid states: New, Active, Resolved, Closed/);
    expect(fake.getUpdatedWorkItems()).toHaveLength(0);
  });
});

describe("WorkItemsWriteService.addComment", () => {
  it("forwards text and returns the new comment id", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextAddedComment({ id: 99, text: "hi" } as unknown as import("../../../../src/ado/types.js").WorkItemComment);
    const result = await svc.addComment({ project: "Proj", workItemId: 10, text: "hi" });
    expect(fake.getAddedWorkItemComments()[0]).toEqual({ project: "Proj", id: 10, text: "hi" });
    expect(result.commentId).toBe(99);
  });
});
```

> Note: `setPullRequest` is the existing fake setter (signature `{ project, repository, pullRequestId, pr }`). Confirm by grep; the snippet above matches the `setPullRequest(args: PrKey & { pr })` form seen in the fake.

- [ ] **Step 3: Run tests**

Run: `npx vitest run test/unit/domains/workItems/writeService.test.ts`
Expected: PASS.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: FAIL only on `SdkAdoClient` missing methods.

- [ ] **Step 5: Commit**

```bash
git add src/domains/workItems/writeService.ts test/unit/domains/workItems/writeService.test.ts
git commit -m "feat(phase-5): work-items write service (link + state + comment) with tests"
```

---

## Task 8: Write tools

**Files:**
- Create: `src/domains/workItems/writeTools.ts`

- [ ] **Step 1: Write the write tools**

```ts
import type { WorkItemsWriteService } from "./writeService.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  LinkWorkItemToPrInput,
  UpdateWorkItemStateInput,
  AddWorkItemCommentInput,
} from "./schemas.js";

export function buildWorkItemsWriteTools(svc: WorkItemsWriteService): ToolDefinition[] {
  return [
    {
      name: "link_work_item_to_pr",
      config: {
        title: "Link a work item to a pull request",
        description:
          "Adds a bidirectional artifact link between a work item and a PR (visible in both the WI " +
          "and the PR in the ADO UI). The work item and PR are assumed to be in the same project.",
        inputSchema: LinkWorkItemToPrInput,
      },
      handler: async (args) => svc.linkToPr(args as Parameters<typeof svc.linkToPr>[0]),
    },
    {
      name: "update_work_item_state",
      config: {
        title: "Move a work item to a new state",
        description:
          "Sets System.State. The target is validated against the work-item type's allowed states " +
          "first; an invalid state returns the list of valid ones without changing anything.",
        inputSchema: UpdateWorkItemStateInput,
      },
      handler: async (args) => svc.updateState(args as Parameters<typeof svc.updateState>[0]),
    },
    {
      name: "add_work_item_comment",
      config: {
        title: "Add a comment to a work item",
        description:
          "Appends a discussion comment to a work item (markdown supported). Uses the work-item " +
          "comments API, not the legacy History field.",
        inputSchema: AddWorkItemCommentInput,
      },
      handler: async (args) => svc.addComment(args as Parameters<typeof svc.addComment>[0]),
    },
  ];
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: FAIL only on `SdkAdoClient` missing methods.

- [ ] **Step 3: Commit**

```bash
git add src/domains/workItems/writeTools.ts
git commit -m "feat(phase-5): work-items write tool definitions"
```

---

## Task 9: Implement the methods on SdkAdoClient

**Files:**
- Modify: `src/ado/sdkClient.ts`

- [ ] **Step 1: Add type/value imports**

Add to the import-from-`./types.js` block in `src/ado/sdkClient.ts`:

```ts
  WorkItem,
  WorkItemComment,
  JsonPatchOperation,
```

And add a value import for the expand enum (it's used at runtime). Add near the top with the other value imports:

```ts
import { WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";
```

- [ ] **Step 2: Implement the 8 methods**

Add inside the `SdkAdoClient` class, following the existing `try/catch { mapSdkError }` pattern:

```ts
  // -------- work items (WorkItemTrackingApi + GitApi) --------

  async queryWorkItemIds(args: { project: string; wiql: string; team?: string }): Promise<number[]> {
    try {
      const wit = await this.api.getWorkItemTrackingApi();
      const teamContext = args.team
        ? { project: args.project, team: args.team }
        : { project: args.project };
      const result = await wit.queryByWiql({ query: args.wiql }, teamContext);
      return (result.workItems ?? [])
        .map((w) => w.id)
        .filter((id): id is number => typeof id === "number");
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async getWorkItemsSummary(args: { project: string; ids: number[] }): Promise<WorkItem[]> {
    try {
      if (args.ids.length === 0) return [];
      const wit = await this.api.getWorkItemTrackingApi();
      // Default fields are enough for the summary; pass the project for scoping.
      return await wit.getWorkItems(
        args.ids,
        ["System.Id", "System.WorkItemType", "System.Title", "System.State", "System.AssignedTo"],
        undefined,
        undefined,
        undefined,
        args.project,
      );
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async getWorkItem(args: { project: string; id: number }): Promise<WorkItem> {
    try {
      const wit = await this.api.getWorkItemTrackingApi();
      const item = await wit.getWorkItem(args.id, undefined, undefined, WorkItemExpand.All, args.project);
      if (!item) throw new AdoNotFoundError(`Work item ${args.id} not found`);
      return item;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async getWorkItemComments(args: {
    project: string;
    id: number;
    top?: number;
  }): Promise<WorkItemComment[]> {
    try {
      const wit = await this.api.getWorkItemTrackingApi();
      const list = await wit.getComments(args.project, args.id, args.top ?? 20);
      return list.comments ?? [];
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async getPullRequestWorkItemRefs(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<number[]> {
    try {
      const git = await this.api.getGitApi();
      const refs = await git.getPullRequestWorkItemRefs(
        args.repository,
        args.pullRequestId,
        args.project,
      );
      return (refs ?? [])
        .map((r) => (r.id ? Number(r.id) : NaN))
        .filter((id) => Number.isInteger(id));
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async getWorkItemTypeStates(args: { project: string; type: string }): Promise<string[]> {
    try {
      const wit = await this.api.getWorkItemTrackingApi();
      const states = await wit.getWorkItemTypeStates(args.project, args.type);
      return (states ?? [])
        .map((s) => s.name)
        .filter((n): n is string => typeof n === "string");
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async updateWorkItem(args: {
    project: string;
    id: number;
    patch: JsonPatchOperation[];
  }): Promise<WorkItem> {
    try {
      const wit = await this.api.getWorkItemTrackingApi();
      // First arg is customHeaders; null is the documented "none" value.
      return await wit.updateWorkItem(null, args.patch, args.id, args.project);
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async addWorkItemComment(args: {
    project: string;
    id: number;
    text: string;
  }): Promise<WorkItemComment> {
    try {
      const wit = await this.api.getWorkItemTrackingApi();
      return await wit.addComment({ text: args.text }, args.project, args.id);
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }
```

- [ ] **Step 3: Verify build (now fully green)**

Run: `npm run build`
Expected: PASS — all `AdoClient` members implemented on both classes.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing + new work-item tests green.

- [ ] **Step 5: Commit**

```bash
git add src/ado/sdkClient.ts
git commit -m "feat(phase-5): implement work-item methods on SdkAdoClient"
```

---

## Task 10: Register the tools

**Files:**
- Modify: `src/mcp/registerTools.ts`

- [ ] **Step 1: Add imports**

```ts
import { WorkItemsReadService } from "../domains/workItems/readService.js";
import { buildWorkItemsReadTools } from "../domains/workItems/readTools.js";
import { WorkItemsWriteService } from "../domains/workItems/writeService.js";
import { buildWorkItemsWriteTools } from "../domains/workItems/writeTools.js";
```

- [ ] **Step 2: Add to the read + write buckets**

In the `readTools` array, append:

```ts
    ...buildWorkItemsReadTools(new WorkItemsReadService(client)),
```

In the `writeTools` array (the non-readOnly branch), append:

```ts
        ...buildWorkItemsWriteTools(new WorkItemsWriteService(client)),
```

- [ ] **Step 3: Verify build + tests**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 4: Smoke-check the tool list (optional but recommended)**

If the repo has a tool-list test or a way to start the server, confirm `list_work_items` and `get_work_item` register in read-only mode and all five register otherwise. Otherwise rely on the build + unit tests.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/registerTools.ts
git commit -m "feat(phase-5): register work-item tools (reads always, writes gated)"
```

---

## Task 11: Roadmap + version + release notes

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `package.json`

- [ ] **Step 1: Flip Phase 5 to Done**

In `docs/ROADMAP.md`, change the Phase 5 heading from `## 💡 Phase 5 — Work items` to `## ✅ Phase 5 — Work items`, update its status line to reflect the shipped tool set (the 5 tools, the `linkedToPr`-via-Git-refs deviation, and the explicit out-of-scope list), and reference the spec at `docs/superpowers/specs/2026-05-21-azure-devops-mcp-phase-5-work-items-design.md`. Match the wording/structure of the already-Done phases above it.

- [ ] **Step 2: Bump the version**

Read the current version in `package.json` (it was `0.7.0` at plan time). Bump the minor version (new feature set): set it to the next minor (e.g. `0.8.0`). If `package.json`'s version drifted, bump from whatever is current.

- [ ] **Step 3: Verify build + full suite one more time**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/ROADMAP.md package.json
git commit -m "chore(phase-5): finalize release — ROADMAP Done + version bump"
```

---

## Done criteria

- `npm run build` and `npm test` both pass.
- Five tools exist in `src/domains/workItems/`; reads register unconditionally, writes only when not read-only.
- `list_work_items` covers all four filters; `linkedToPr` uses `getPullRequestWorkItemRefs`.
- `update_work_item_state` rejects invalid states with the valid-state list and never patches in that case.
- `get_work_item` returns fields keyed by reference name (no up-front field typing).
- ROADMAP Phase 5 marked Done; version bumped.
