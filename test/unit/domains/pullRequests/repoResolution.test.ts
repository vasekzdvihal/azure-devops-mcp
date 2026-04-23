import { describe, it, expect } from "vitest";
import { resolveRepo, RepoContextError } from "../../../../src/domains/pullRequests/repoResolution.js";

const REPO = { project: "MyProject", repo: "MyRepo" };

describe("resolveRepo", () => {
  it("uses explicit project + repository when both provided", async () => {
    const result = await resolveRepo({ project: "Explicit", repository: "Repo" }, async () => REPO);
    expect(result).toEqual({ project: "Explicit", repository: "Repo" });
  });

  it("falls back to detector when both args omitted", async () => {
    const result = await resolveRepo({}, async () => REPO);
    expect(result).toEqual({ project: REPO.project, repository: REPO.repo });
  });

  it("throws RepoContextError when args omitted and detector returns null", async () => {
    await expect(resolveRepo({}, async () => null)).rejects.toBeInstanceOf(RepoContextError);
  });

  it("uses partial args + detector fill (project provided, repo from detector)", async () => {
    const result = await resolveRepo({ project: "Override" }, async () => REPO);
    expect(result).toEqual({ project: "Override", repository: REPO.repo });
  });

  it("uses partial args + detector fill (repository provided, project from detector)", async () => {
    const result = await resolveRepo({ repository: "Override" }, async () => REPO);
    expect(result).toEqual({ project: REPO.project, repository: "Override" });
  });

  it("throws RepoContextError when one arg provided + detector returns null + the other arg also missing", async () => {
    await expect(resolveRepo({ project: "X" }, async () => null)).rejects.toBeInstanceOf(RepoContextError);
  });
});
