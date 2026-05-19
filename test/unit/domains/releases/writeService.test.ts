import { describe, it, expect } from "vitest";
import { ReleasesWriteService } from "../../../../src/domains/releases/writeService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type { Release, ReleaseApproval, Build, ReleaseDefinition } from "../../../../src/ado/types.js";

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

  it("maps environment status numbers to readable strings", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextCreatedRelease({
      id: 7,
      environments: [
        { id: 1, name: "Dev", status: 1 },     // NotStarted
        { id: 2, name: "Prod", status: 2 },    // InProgress (unrealistic at create time but exercises the map)
      ],
    } as unknown as Release);
    const result = await svc.createRelease({ project: "p", definitionId: 1 });
    expect(result.environments[0]?.status).toBe("notStarted");
    expect(result.environments[1]?.status).toBe("inProgress");
  });
});

describe("ReleasesWriteService.deployStage", () => {
  it("resolves environmentName to environmentId via getRelease and sends status=inProgress", async () => {
    const { svc, fake } = makeSvc();
    // EnvironmentStatus.InProgress = 2 (verified from SDK ReleaseInterfaces.d.ts)
    fake.setRelease("p", 5, {
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
    fake.setRelease("p", 5, {
      id: 5,
      environments: [{ id: 10, name: "Dev" }],
    } as unknown as Release);
    await expect(
      svc.deployStage({ project: "p", releaseId: 5, environmentName: "Production" }),
    ).rejects.toThrow(/Production/);
  });
});

describe("ReleasesWriteService.approveGate", () => {
  it("maps 'approved' → ApprovalStatus enum and back", async () => {
    const { svc, fake } = makeSvc();
    // ApprovalStatus.Approved = 2 (verified from SDK ReleaseInterfaces.d.ts)
    fake.setNextUpdatedApproval({ id: 42, status: 2 } as ReleaseApproval);
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

  it("maps 'rejected' → ApprovalStatus enum and back", async () => {
    const { svc, fake } = makeSvc();
    // ApprovalStatus.Rejected = 4 (verified from SDK ReleaseInterfaces.d.ts)
    fake.setNextUpdatedApproval({ id: 1, status: 4 } as ReleaseApproval);
    const result = await svc.approveGate({ project: "p", approvalId: 1, status: "rejected" });
    expect(result.status).toBe("rejected");
  });
});

describe("ReleasesWriteService.cancelRelease", () => {
  it("calls client with project + releaseId + comment and returns shaped result", async () => {
    const { svc, fake } = makeSvc();
    // ReleaseStatus.Abandoned = 4 (verified from SDK ReleaseInterfaces.d.ts)
    fake.setNextCancelledRelease({ id: 9, status: 4, name: "R9" } as unknown as Release);
    const result = await svc.cancelRelease({ project: "p", releaseId: 9, comment: "ship later" });
    expect(fake.getCancelledReleases()).toEqual([{ project: "p", releaseId: 9, comment: "ship later" }]);
    expect(result.releaseId).toBe(9);
    expect(result.status).toBe("abandoned");
  });
});

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
