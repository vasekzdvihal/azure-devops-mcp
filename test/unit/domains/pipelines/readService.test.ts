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

describe("PipelinesReadService.getDefinition", () => {
  it("shapes a YAML pipeline with yamlFilename, variables, variableGroups and triggers", async () => {
    const fake = new FakeAdoClient();
    const def: BuildDefinition = {
      id: 10,
      name: "Newton.n2-CI",
      path: "\\Newton",
      type: 2,
      description: "CI pipeline for Newton",
      process: {
        type: 2,
        yamlFilename: "azure-pipelines.yml",
      } as unknown as BuildDefinition["process"],
      repository: {
        id: "repo-guid-1",
        name: "Newton",
        type: "TfsGit",
        defaultBranch: "refs/heads/main",
      },
      queue: { id: 7, name: "Default-Linux" },
      variables: {
        environment: { value: "staging", allowOverride: true },
        apiKey: { isSecret: true, value: "REDACTED" },
      },
      variableGroups: [
        { id: 42, name: "shared-secrets" },
      ] as unknown as BuildDefinition["variableGroups"],
      triggers: [
        {
          triggerType: 2, // continuousIntegration
          branchFilters: ["+refs/heads/main"],
          pathFilters: ["-/docs"],
        },
        {
          triggerType: 64, // pullRequest
          branchFilters: ["+refs/heads/main"],
        },
        {
          triggerType: 8, // schedule
          schedules: [{ daysToBuild: 1, startHours: 4 }],
        },
      ] as unknown as BuildDefinition["triggers"],
    };
    fake.setPipelineDefinition("MyProj", 10, def);
    const svc = new PipelinesReadService(fake);

    const result = await svc.getDefinition({ project: "MyProj", definitionId: 10 });

    expect(result).toEqual({
      id: 10,
      name: "Newton.n2-CI",
      path: "\\Newton",
      type: "yaml",
      repositoryId: "repo-guid-1",
      defaultBranch: "refs/heads/main",
      description: "CI pipeline for Newton",
      yamlFilename: "azure-pipelines.yml",
      queue: { id: 7, name: "Default-Linux" },
      variables: [
        { name: "environment", isSecret: false, allowOverride: true, value: "staging" },
        // secret value must NOT appear on the wire shape
        { name: "apiKey", isSecret: true, allowOverride: false },
      ],
      variableGroupIds: [42],
      triggers: [
        {
          type: "continuousIntegration",
          branchFilters: ["+refs/heads/main"],
          pathFilters: ["-/docs"],
        },
        { type: "pullRequest", branchFilters: ["+refs/heads/main"] },
        { type: "schedule", scheduleCount: 1 },
      ],
      repositoryName: "Newton",
      repositoryType: "TfsGit",
    });
  });

  it("returns a classic pipeline with no yamlFilename", async () => {
    const fake = new FakeAdoClient();
    const def: BuildDefinition = {
      id: 11,
      name: "Newton.n2-Classic",
      type: 2,
      process: { type: 1 /* designer */ } as unknown as BuildDefinition["process"],
      repository: { id: "repo-guid-1", defaultBranch: "refs/heads/main" },
    };
    fake.setPipelineDefinition("MyProj", 11, def);
    const svc = new PipelinesReadService(fake);

    const result = await svc.getDefinition({ project: "MyProj", definitionId: 11 });

    expect(result.type).toBe("classic");
    expect(result.yamlFilename).toBeUndefined();
    expect(result.variables).toEqual([]);
    expect(result.variableGroupIds).toEqual([]);
    expect(result.triggers).toEqual([]);
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
