import { describe, it, expect } from "vitest";
import { PipelinesReadService } from "../../../../src/domains/pipelines/readService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type {
  BuildDefinition,
  Build,
  Timeline,
} from "../../../../src/ado/types.js";

describe("PipelinesReadService.list", () => {
  it("shapes pipeline definitions distinguishing classic vs yaml", async () => {
    const fake = new FakeAdoClient();
    const defs: BuildDefinition[] = [
      {
        id: 10,
        name: "Newton.n2-CI",
        path: "\\Newton",
        type: 2,
        process: { type: 2 /* yaml */ } as unknown as BuildDefinition["process"],
        repository: { id: "repo-guid-1", defaultBranch: "refs/heads/main" },
      },
      {
        id: 11,
        name: "Newton.n2-Classic",
        type: 2,
        process: { type: 1 /* designer - classic */ } as unknown as BuildDefinition["process"],
        repository: { id: "repo-guid-1", defaultBranch: "refs/heads/main" },
      },
    ];
    fake.setPipelines("MyProj", defs);
    const svc = new PipelinesReadService(fake);

    const result = await svc.list({ project: "MyProj" });

    expect(result).toEqual([
      {
        id: 10,
        name: "Newton.n2-CI",
        path: "\\Newton",
        type: "yaml",
        repositoryId: "repo-guid-1",
        defaultBranch: "refs/heads/main",
      },
      {
        id: 11,
        name: "Newton.n2-Classic",
        path: undefined,
        type: "classic",
        repositoryId: "repo-guid-1",
        defaultBranch: "refs/heads/main",
      },
    ]);
  });
});

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

  it("returns empty stages when timeline is null", async () => {
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

  it("passes triggerInfo and templateParameters through", async () => {
    const fake = new FakeAdoClient();
    const build: Build = {
      id: 502,
      buildNumber: "20260420.2",
      definition: { id: 10, name: "Newton.n2-CI" },
      status: 2,
      result: 2,
      triggerInfo: { "ci.sourceSha": "abc", "ci.message": "fix(x)" },
      templateParameters: { environment: "prod" },
    };
    fake.setPipelineRun("MyProj", 502, { build, timeline: null });
    const svc = new PipelinesReadService(fake);

    const result = await svc.get({ project: "MyProj", runId: 502 });

    expect(result.triggerInfo).toEqual({ "ci.sourceSha": "abc", "ci.message": "fix(x)" });
    expect(result.templateParameters).toEqual({ environment: "prod" });
  });
});
