import { describe, it, expect } from "vitest";
import { CommitsReadService } from "../../../../src/domains/commits/readService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type { GitBranchStats, GitCommitRef } from "../../../../src/ado/types.js";

const REPO = { project: "MyProject", repo: "MyRepo" };

describe("CommitsReadService.listBranches", () => {
  it("resolves repo from cwd when no args and shapes branches", async () => {
    const fake = new FakeAdoClient();
    const branches: GitBranchStats[] = [
      {
        name: "main",
        commit: { commitId: "abc123" },
        aheadCount: 0,
        behindCount: 0,
        isBaseVersion: true,
      },
      {
        name: "feature/x",
        commit: { commitId: "def456" },
        aheadCount: 3,
        behindCount: 1,
        isBaseVersion: false,
      },
    ];
    fake.setBranches(REPO.project, REPO.repo, branches);
    const svc = new CommitsReadService(fake, async () => REPO);

    const result = await svc.listBranches({});

    expect(result).toEqual([
      {
        name: "main",
        lastCommitId: "abc123",
        aheadCount: 0,
        behindCount: 0,
        isBaseVersion: true,
      },
      {
        name: "feature/x",
        lastCommitId: "def456",
        aheadCount: 3,
        behindCount: 1,
        isBaseVersion: false,
      },
    ]);
  });

  it("honors explicit project + repository args over cwd detection", async () => {
    const fake = new FakeAdoClient();
    fake.setBranches("OtherProj", "OtherRepo", [
      { name: "main", commit: { commitId: "z" } },
    ]);
    const svc = new CommitsReadService(fake, async () => REPO);

    const result = await svc.listBranches({
      project: "OtherProj",
      repository: "OtherRepo",
    });

    expect(result).toEqual([
      {
        name: "main",
        lastCommitId: "z",
        aheadCount: undefined,
        behindCount: undefined,
        isBaseVersion: undefined,
      },
    ]);
  });
});

describe("CommitsReadService.listCommits", () => {
  it("forwards branch/date/author filters and shapes commits", async () => {
    const fake = new FakeAdoClient();
    const commits: GitCommitRef[] = [
      {
        commitId: "abc123",
        comment: "fix(foo): tweak",
        author: {
          name: "Alice",
          email: "alice@example.com",
          date: new Date("2026-04-21T10:00:00Z"),
        },
        committer: {
          name: "Alice",
          email: "alice@example.com",
          date: new Date("2026-04-21T10:00:00Z"),
        },
        changeCounts: { Add: 2, Edit: 3, Delete: 0 },
        url: "https://example.com/_apis/git/commits/abc123",
      },
    ];
    fake.setCommits(REPO.project, REPO.repo, commits);
    const svc = new CommitsReadService(fake, async () => REPO);

    const result = await svc.listCommits({
      branch: "main",
      fromDate: "2026-04-20T00:00:00Z",
      toDate: "2026-04-22T00:00:00Z",
      author: "alice",
      top: 10,
    });

    expect(result).toEqual([
      {
        commitId: "abc123",
        comment: "fix(foo): tweak",
        author: {
          name: "Alice",
          email: "alice@example.com",
          date: "2026-04-21T10:00:00.000Z",
        },
        committer: {
          name: "Alice",
          email: "alice@example.com",
          date: "2026-04-21T10:00:00.000Z",
        },
        changeCounts: { Add: 2, Edit: 3, Delete: 0 },
        url: "https://example.com/_apis/git/commits/abc123",
      },
    ]);
  });
});
