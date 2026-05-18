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
    const result = await svc.updateTags({
      project: "p",
      runId: 1,
      addTags: ["a"],
      removeTags: ["old"],
    });
    expect(fake.getAddedTags()).toHaveLength(1);
    expect(fake.getRemovedTags()).toHaveLength(1);
    expect(result.tags).toEqual(["a"]);
  });
});
