import { describe, it, expect } from "vitest";
import { PullRequestsWriteService } from "../../../../src/domains/pullRequests/writeService.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";

const REPO = { project: "MyProject", repo: "MyRepo" };

function makeSvc(): { svc: PullRequestsWriteService; fake: FakeAdoClient } {
  const fake = new FakeAdoClient();
  const svc = new PullRequestsWriteService(fake, async () => REPO);
  return { svc, fake };
}

describe("PullRequestsWriteService.addComment — general PR comment", () => {
  it("creates a thread without threadContext when filePath omitted", async () => {
    const { svc, fake } = makeSvc();
    await svc.addComment({ pullRequestId: 1, content: "Hello" });
    const created = fake.getCreatedThreads();
    expect(created).toHaveLength(1);
    expect(created[0]?.thread.threadContext).toBeUndefined();
    expect(created[0]?.thread.comments?.[0]?.content).toBe("Hello");
  });

  it("creates a thread with line-anchored threadContext when filePath + line provided", async () => {
    const { svc, fake } = makeSvc();
    await svc.addComment({ pullRequestId: 1, content: "Note", filePath: "src/foo.ts", line: 10 });
    const ctx = fake.getCreatedThreads()[0]?.thread.threadContext;
    expect(ctx?.filePath).toBe("src/foo.ts");
    expect(ctx?.rightFileStart?.line).toBe(10);
  });

  it("returns shaped response with threadId + status", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextCreatedThread({ id: 42, status: 1, comments: [{ id: 1, content: "Hi" }] });
    const result = await svc.addComment({ pullRequestId: 1, content: "Hi" });
    expect(result.threadId).toBe(42);
    expect(result.status).toBe("active");
  });
});

describe("PullRequestsWriteService.replyToThread", () => {
  it("appends a comment to the named thread and returns commentId", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextCreatedComment({ id: 42, content: "Sounds good", commentType: 1 });
    const result = await svc.replyToThread({ pullRequestId: 1, threadId: 7, content: "Sounds good" });
    const created = fake.getCreatedComments();
    expect(created[0]?.threadId).toBe(7);
    expect(created[0]?.comment.content).toBe("Sounds good");
    expect(result.commentId).toBe(42);
  });
});

describe("PullRequestsWriteService.addComment — validation", () => {
  it("throws when filePath is provided without line", async () => {
    const { svc } = makeSvc();
    await expect(
      svc.addComment({ pullRequestId: 1, content: "x", filePath: "src/foo.ts" }),
    ).rejects.toThrow(/filePath and line must be provided together/);
  });

  it("throws when line is provided without filePath", async () => {
    const { svc } = makeSvc();
    await expect(svc.addComment({ pullRequestId: 1, content: "x", line: 10 })).rejects.toThrow(
      /filePath and line must be provided together/,
    );
  });
});

describe("PullRequestsWriteService.updateThreadStatus", () => {
  it("maps status string to enum and sends to client", async () => {
    const { svc, fake } = makeSvc();
    await svc.updateThreadStatus({ pullRequestId: 1, threadId: 3, status: "fixed" });
    const updates = fake.getThreadStatusUpdates();
    expect(updates[0]?.status).toBe(2 /* CommentThreadStatus.Fixed */);
  });

  it("returns shaped response with threadId + new status string", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextUpdatedThread({ id: 3, status: 2 });
    const result = await svc.updateThreadStatus({ pullRequestId: 1, threadId: 3, status: "fixed" });
    expect(result).toEqual({ threadId: 3, status: "fixed" });
  });
});

describe("PullRequestsWriteService.vote", () => {
  it.each([
    ["approve", 10],
    ["approveWithSuggestions", 5],
    ["wait", -5],
    ["reject", -10],
    ["reset", 0],
  ] as const)("maps vote string '%s' to numeric value %d", async (voteStr, expected) => {
    const { svc, fake } = makeSvc();
    fake.setWhoamiResult({ id: "me-id" });
    await svc.vote({ pullRequestId: 1, vote: voteStr });
    expect(fake.getVoteUpdates()[0]?.vote).toBe(expected);
  });

  it("uses authenticated identity (whoami) as the reviewerId", async () => {
    const { svc, fake } = makeSvc();
    fake.setWhoamiResult({ id: "me-id" });
    await svc.vote({ pullRequestId: 1, vote: "approve" });
    expect(fake.getVoteUpdates()[0]?.reviewerId).toBe("me-id");
  });

  it("returns shaped response with vote string and identity", async () => {
    const { svc, fake } = makeSvc();
    fake.setWhoamiResult({ id: "me-id", providerDisplayName: "Me" });
    fake.setNextVoteResult({ id: "me-id", displayName: "Me", vote: 10 });
    const result = await svc.vote({ pullRequestId: 1, vote: "approve" });
    expect(result.vote).toBe("approve");
    expect(result.reviewer).toBe("Me");
  });
});

describe("PullRequestsWriteService.updatePullRequest", () => {
  it("sends only the provided fields", async () => {
    const { svc, fake } = makeSvc();
    await svc.updatePullRequest({ pullRequestId: 1, title: "New title" });
    const updates = fake.getPrUpdates();
    expect(updates[0]?.update).toEqual({ title: "New title" });
    expect(updates[0]?.update.description).toBeUndefined();
  });

  it("can update both title and description", async () => {
    const { svc, fake } = makeSvc();
    await svc.updatePullRequest({ pullRequestId: 1, title: "T", description: "D" });
    expect(fake.getPrUpdates()[0]?.update).toEqual({ title: "T", description: "D" });
  });
});

describe("PullRequestsWriteService.setDraftState", () => {
  it("sends isDraft=true and returns shaped state", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextUpdatedPr({ pullRequestId: 1, isDraft: true });
    const result = await svc.setDraftState({ pullRequestId: 1, isDraft: true });
    expect(fake.getPrUpdates()[0]?.update).toEqual({ isDraft: true });
    expect(result.isDraft).toBe(true);
  });
});

describe("PullRequestsWriteService.addReviewers", () => {
  it("forwards reviewer ids to client", async () => {
    const { svc, fake } = makeSvc();
    await svc.addReviewers({ pullRequestId: 1, reviewerIds: ["a", "b"] });
    expect(fake.getReviewerAdds()[0]?.reviewerIds).toEqual(["a", "b"]);
  });
});

describe("PullRequestsWriteService.removeReviewer", () => {
  it("forwards a single reviewer id to client", async () => {
    const { svc, fake } = makeSvc();
    await svc.removeReviewer({ pullRequestId: 1, reviewerId: "a" });
    expect(fake.getReviewerRemoves()[0]?.reviewerId).toBe("a");
  });
});

describe("PullRequestsWriteService.createPr", () => {
  it("normalizes short branch names to refs/heads/", async () => {
    const { svc, fake } = makeSvc();
    fake.setNextCreatedPr({
      pullRequestId: 123,
      title: "Add feature",
      sourceRefName: "refs/heads/feature/x",
      targetRefName: "refs/heads/main",
      isDraft: false,
    });
    const result = await svc.createPr({
      sourceBranch: "feature/x",
      targetBranch: "main",
      title: "Add feature",
    });
    expect(fake.getCreatedPrs()[0]?.pr.sourceRefName).toBe("refs/heads/feature/x");
    expect(fake.getCreatedPrs()[0]?.pr.targetRefName).toBe("refs/heads/main");
    expect(result).toMatchObject({
      pullRequestId: 123,
      sourceBranch: "feature/x",
      targetBranch: "main",
    });
  });

  it("passes already-prefixed refs through unchanged", async () => {
    const { svc, fake } = makeSvc();
    await svc.createPr({
      sourceBranch: "refs/heads/feature/x",
      targetBranch: "refs/heads/main",
      title: "T",
    });
    expect(fake.getCreatedPrs()[0]?.pr.sourceRefName).toBe("refs/heads/feature/x");
    expect(fake.getCreatedPrs()[0]?.pr.targetRefName).toBe("refs/heads/main");
  });

  it("forwards optional reviewerIds", async () => {
    const { svc, fake } = makeSvc();
    await svc.createPr({
      sourceBranch: "feature/x",
      targetBranch: "main",
      title: "T",
      reviewerIds: ["alice", "bob"],
    });
    expect(fake.getCreatedPrs()[0]?.pr.reviewers).toEqual([
      { id: "alice", vote: 0 },
      { id: "bob", vote: 0 },
    ]);
  });
});

describe("PullRequestsWriteService.completePr", () => {
  it("maps merge strategy strings to enum and records the call", async () => {
    const { svc, fake } = makeSvc();
    await svc.completePr({
      pullRequestId: 7,
      mergeStrategy: "squash",
      deleteSourceBranch: true,
    });
    expect(fake.getCompletedPrs()[0]?.mergeStrategy).toBe(2);
  });

  it("rejects unknown merge strategies", async () => {
    const { svc } = makeSvc();
    await expect(
      svc.completePr({
        pullRequestId: 7,
        mergeStrategy: "fastForwardOnly" as unknown as string,
      }),
    ).rejects.toThrow(/Unknown merge strategy/);
  });
});

describe("PullRequestsWriteService.abandonPr", () => {
  it("records the abandon call and returns abandoned status", async () => {
    const { svc, fake } = makeSvc();
    const result = await svc.abandonPr({ pullRequestId: 7 });
    expect(fake.getAbandonedPrs()).toHaveLength(1);
    expect(result.status).toBe("abandoned");
  });
});

describe("PullRequestsWriteService.setAutoComplete", () => {
  it("uses whoami identity as the auto-complete owner", async () => {
    const { svc, fake } = makeSvc();
    fake.setWhoamiResult({ id: "me-id-123", providerDisplayName: "Me" });
    await svc.setAutoComplete({
      pullRequestId: 7,
      mergeStrategy: "noFastForward",
      deleteSourceBranch: true,
    });
    const set = fake.getAutoCompleteSets()[0];
    expect(set?.setById).toBe("me-id-123");
    expect(set?.options.mergeStrategy).toBe(1);
    expect(set?.options.deleteSourceBranch).toBe(true);
  });

  it("rejects unknown merge strategies before hitting whoami", async () => {
    const { svc } = makeSvc();
    await expect(
      svc.setAutoComplete({
        pullRequestId: 7,
        mergeStrategy: "fastForwardOnly" as unknown as string,
      }),
    ).rejects.toThrow(/Unknown merge strategy/);
  });
});
