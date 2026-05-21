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

  it("builds a tag WIQL query and shapes results", async () => {
    const { svc, fake } = makeSvc();
    fake.setWiqlIds([12]);
    fake.setWorkItemsSummary("Proj", [
      wi(12, { "System.WorkItemType": "Bug", "System.Title": "Tagged", "System.State": "Active" }),
    ]);
    const out = await svc.list({ project: "Proj", filter: "tag", tag: "sprint-5" });
    expect(fake.getWiqlCalls()[0]?.wiql).toContain("CONTAINS 'sprint-5'");
    expect(out[0]?.id).toBe(12);
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
    expect(fake.getWorkItemsSummaryCalls()).toHaveLength(0);
  });

  it("throws when tag filter is missing the tag value", async () => {
    const { svc } = makeSvc();
    await expect(svc.list({ project: "Proj", filter: "tag" })).rejects.toThrow(/tag/);
  });

  it("shapes a plain-string assignedTo value", async () => {
    const { svc, fake } = makeSvc();
    fake.setWiqlIds([11]);
    fake.setWorkItemsSummary("Proj", [
      wi(11, {
        "System.WorkItemType": "Task",
        "System.Title": "T",
        "System.State": "New",
        "System.AssignedTo": "vasek@example.com",
      }),
    ]);
    const out = await svc.list({ project: "Proj", filter: "myActive" });
    expect(out[0]?.assignedTo).toBe("vasek@example.com");
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
