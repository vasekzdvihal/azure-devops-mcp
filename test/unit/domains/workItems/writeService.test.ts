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
    expect(call.patch[0]?.value).toMatchObject({
      rel: "ArtifactLink",
      attributes: { name: "Pull Request" },
    });
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
