import { describe, it, expect } from "vitest";
import { ReleasesReadService } from "../../../../src/domains/releases/readService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type {
  ReleaseDefinition,
  Release,
  Deployment,
} from "../../../../src/ado/types.js";

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
        deploymentStatus: undefined,
        deployedBy: "Bob",
        completedOn: "2026-04-20T09:15:00.000Z",
      },
      {
        environmentName: "Production",
        status: "succeeded",
        deploymentStatus: undefined,
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

describe("ReleasesReadService.get — pending stage", () => {
  it("maps EnvironmentStatus 1 to 'notStarted'", async () => {
    const fake = new FakeAdoClient();
    const release: Release = {
      id: 9999,
      name: "Pending-Release",
      status: 2,
      releaseDefinition: { id: 9 },
      environments: [{ name: "Dev", status: 1 }],
      artifacts: [],
    };
    fake.setRelease("MyProj", 9999, release);
    const svc = new ReleasesReadService(fake);

    const result = await svc.get({ project: "MyProj", releaseId: 9999 });

    expect(result.stages[0]?.status).toBe("notStarted");
  });
});

describe("ReleasesReadService.listDeployments", () => {
  it("flattens deployment entries and passes status filter through", async () => {
    const fake = new FakeAdoClient();
    const deployments: Deployment[] = [
      {
        id: 5001,
        deploymentStatus: 4, // succeeded
        release: {
          id: 1001,
          name: "Release-42",
          artifacts: [
            {
              definitionReference: {
                version: { id: "12345", name: "20260420.1" },
                branch: { id: "refs/heads/main", name: "main" },
              },
            },
          ],
        },
        releaseDefinition: { id: 9, name: "Newton.n2-Deploy" },
        releaseEnvironment: { id: 2, name: "Production" },
        requestedBy: { displayName: "Carol", id: "c1" },
        requestedFor: { displayName: "Carol", id: "c1" },
        queuedOn: new Date("2026-04-20T09:55:00Z"),
        startedOn: new Date("2026-04-20T09:56:00Z"),
        completedOn: new Date("2026-04-20T10:00:00Z"),
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

  it("filters by environmentName case-insensitively client-side", async () => {
    const fake = new FakeAdoClient();
    const deployments: Deployment[] = [
      {
        id: 1,
        deploymentStatus: 4,
        release: { id: 100, name: "R1" },
        releaseEnvironment: { name: "Dev" },
      },
      {
        id: 2,
        deploymentStatus: 4,
        release: { id: 100, name: "R1" },
        releaseEnvironment: { name: "Production" },
      },
      {
        id: 3,
        deploymentStatus: 4,
        release: { id: 101, name: "R2" },
        releaseEnvironment: { name: "production" }, // lowercase variant
      },
    ];
    fake.setDeployments("MyProj", deployments);
    const svc = new ReleasesReadService(fake);

    const result = await svc.listDeployments({
      project: "MyProj",
      environmentName: "PRODUCTION",
    });

    expect(result.map((d) => d.deploymentId)).toEqual([2, 3]);
  });
});
