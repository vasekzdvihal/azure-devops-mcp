import { describe, it, expect } from "vitest";
import { PipelinesWriteService } from "../../../../src/domains/pipelines/writeService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type { Run, Build, BuildDefinition } from "../../../../src/ado/types.js";
import { AdoConflictError } from "../../../../src/ado/errors.js";

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

  it("throws when both tag arrays are empty/missing", async () => {
    const { svc } = makeSvc();
    await expect(svc.updateTags({ project: "p", runId: 1 })).rejects.toThrow(
      /at least one tag/,
    );
    await expect(
      svc.updateTags({ project: "p", runId: 1, addTags: [], removeTags: [] }),
    ).rejects.toThrow(/at least one tag/);
  });
});

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
