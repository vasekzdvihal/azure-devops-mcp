import { describe, it, expect } from "vitest";
import { ProjectsService } from "../../../../src/domains/projects/service.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type { TeamProjectReference } from "../../../../src/ado/types.js";

describe("ProjectsService.list", () => {
  it("returns shaped project list from the client", async () => {
    const fake = new FakeAdoClient();
    const projects: TeamProjectReference[] = [
      { id: "p1", name: "ProjectOne", url: "https://example.com/p1" },
      { id: "p2", name: "ProjectTwo", url: "https://example.com/p2" },
    ];
    fake.setProjects(projects);

    const svc = new ProjectsService(fake);
    const result = await svc.list();
    expect(result).toEqual([
      { id: "p1", name: "ProjectOne", url: "https://example.com/p1" },
      { id: "p2", name: "ProjectTwo", url: "https://example.com/p2" },
    ]);
  });

  it("returns empty array when no projects", async () => {
    const fake = new FakeAdoClient();
    fake.setProjects([]);
    const svc = new ProjectsService(fake);
    expect(await svc.list()).toEqual([]);
  });

  it("propagates errors from the AdoClient", async () => {
    const fake = new FakeAdoClient();
    const err = new Error("boom");
    fake.injectError("listProjects", err);
    const svc = new ProjectsService(fake);
    await expect(svc.list()).rejects.toBe(err);
  });
});
