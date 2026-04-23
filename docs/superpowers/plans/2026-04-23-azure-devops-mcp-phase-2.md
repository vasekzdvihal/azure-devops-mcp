# Azure DevOps MCP — Phase 2 (PR Review Write Surface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 8 write tools needed for the LLM to act AS a reviewer or to respond AS the PR author — comment, reply, resolve threads, vote, edit PR title/description, toggle draft, add/remove reviewers. Make the read-only mode env var (plumbed through Phase 1 as a no-op) actually load-bearing — when set, write tools are not registered at all.

**Architecture:** Extend the `AdoClient` seam with 7 new write method signatures. Add a new `AdoConflictError` for HTTP 409 (PR already abandoned, thread closed, concurrent edit). Split the `pullRequests/` domain folder's existing `service.ts` and `tools.ts` into read+write halves; extract the shared repo-resolution logic to its own pure module so both halves can use it without inheritance. Update `mcp/registerTools.ts` to build separate read/write tool arrays and skip the write array entirely when `options.readOnly` is true.

**Tech Stack:** Same as Phase 1 — no new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-04-21-azure-devops-mcp-design.md` — §12 covers Phase 2 in detail (tool list in §12.1, locked decisions in §12.2, architecture in §12.3, setup wizard adjustment in §12.4, README updates in §12.5, testing strategy in §12.6, deferred lifecycle work in §12.7).

**Out of Phase 2 (deferred to a future Phase 2.x):** PR lifecycle — `create_pull_request`, `complete_pull_request`, `abandon_pull_request`, `set_auto_complete`, `delete_pull_request_comment`, `update_pull_request_comment`. These have higher blast radius and warrant their own brainstorming pass.

---

## File map for Phase 2

New, modified, and renamed files relative to Phase 1's merged baseline.

```
azure-mcp/
├── package.json                                 # MODIFY: bump version to 0.2.0
├── README.md                                    # MODIFY: full Phase 2 tool catalog, scope table, security clarification
│
├── src/
│   ├── ado/
│   │   ├── client.ts                            # MODIFY: extend interface with 7 write method signatures
│   │   ├── sdkClient.ts                         # MODIFY: implement 7 write methods via SDK
│   │   ├── errors.ts                            # MODIFY: add AdoConflictError + 409 mapping; extend AdoAuthError message
│   │   └── types.ts                             # MODIFY: re-export Comment, CommentThreadStatus, IdentityRefWithVote
│   │
│   ├── domains/pullRequests/
│   │   ├── repoResolution.ts                    # NEW: extracted resolveRepo() helper used by both services
│   │   ├── readService.ts                       # RENAMED from service.ts (read methods only; resolve via new helper)
│   │   ├── writeService.ts                      # NEW: 8 write methods (add comment, reply, vote, …)
│   │   ├── readTools.ts                         # RENAMED from tools.ts (read tools only)
│   │   ├── writeTools.ts                        # NEW: builds 8 write tool definitions
│   │   ├── schemas.ts                           # MODIFY: extend with write-tool input schemas
│   │   └── diffShaper.ts                        # unchanged
│   │
│   ├── mcp/
│   │   └── registerTools.ts                     # MODIFY: actually use readOnly flag (split read/write arrays)
│   │
│   ├── setup.ts                                 # MODIFY: print one-line message about scopes before PAT prompt
│   └── index.ts                                 # unchanged (already threads readOnly through)
│
└── test/
    ├── fakes/
    │   └── FakeAdoClient.ts                     # MODIFY: extend with 7 new write method stubs + setters
    │
    └── unit/
        ├── ado/
        │   └── errors.test.ts                   # MODIFY: add AdoConflictError tests
        │
        └── domains/pullRequests/
            ├── repoResolution.test.ts           # NEW: TDD coverage of the extracted helper (pulled from service.test.ts)
            ├── service.test.ts                  # RENAMED to readService.test.ts (matching service rename)
            ├── readService.test.ts              # RENAMED from service.test.ts (with repo-resolution tests removed since they live in repoResolution.test.ts)
            └── writeService.test.ts             # NEW: TDD for 8 write methods (~15 tests)
```

**Unchanged:** `config/`, `git/`, `domains/identity/`, `domains/projects/`, `domains/repositories/`, `mcp/errorBoundary.ts`, `domains/pullRequests/diffShaper.ts`, `tsconfig.json`, `vitest.config.ts`.

---

## Conventions (carry-over from Phase 0/1)

- **Commit after every task.** One task = one commit.
- **TDD where it has logic.** Tasks with real branching/error handling are TDD. Mechanical scaffolding (re-exports, interface signatures, tool definitions) is implemented and verified via typecheck/build.
- **All code is ESM.** Relative imports use `.js` extension on `.ts` source files.
- **No `any`.** Strict TS, `noUncheckedIndexedAccess` is on — narrow with `??` fallbacks.
- **Run from `/Users/vasekzdvihal/source/GitHub/azure-mcp/.worktrees/phase-2-pr-review-writes`** for all `npm`, `git`, `node` commands.
- **AdoError pattern in SdkAdoClient catches:** every catch should `if (err instanceof AdoError) throw err;` BEFORE calling `mapSdkError(err)`. This preserves our typed errors when the try block synthesizes them itself (e.g. `throw new AdoNotFoundError(...)`).

---

## Task 1: Add `AdoConflictError` and 409 mapping — TDD

**Files:**
- Modify: `test/unit/ado/errors.test.ts`
- Modify: `src/ado/errors.ts`

The mapper currently doesn't handle 409. Phase 2 writes hit it when the PR was abandoned/completed since fetch, the thread was closed, or a concurrent reviewer modified things.

- [ ] **Step 1: Add the failing tests**

Append to `test/unit/ado/errors.test.ts`, inside the existing `describe("mapSdkError", ...)` block (just before the closing `});`):

```ts
  it("maps statusCode 409 to AdoConflictError", () => {
    const err = Object.assign(new Error("Conflict"), { statusCode: 409 });
    expect(mapSdkError(err)).toBeInstanceOf(AdoConflictError);
  });

  it("AdoConflictError carries a message about the conflict", () => {
    const mapped = mapSdkError(Object.assign(new Error("Thread is closed"), { statusCode: 409 }));
    expect(mapped.message).toMatch(/conflict/i);
    expect(mapped.message).toMatch(/Thread is closed/);
  });
```

Add `AdoConflictError` to the import line at the top:

```ts
import {
  AdoAuthError,
  AdoNotFoundError,
  AdoNetworkError,
  AdoTlsError,
  AdoUnknownError,
  AdoConflictError,
  mapSdkError,
} from "../../../src/ado/errors.js";
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/ado/errors.test.ts
```

Expected: FAIL — `AdoConflictError` is not exported.

- [ ] **Step 3: Implement**

Add to `src/ado/errors.ts`, after the `AdoTlsError` class and before `AdoUnknownError`:

```ts
export class AdoConflictError extends AdoError {
  readonly kind = "conflict";
  constructor(detail?: string) {
    super(
      "Conflict from Azure DevOps. The resource state changed between your read and write " +
        "(PR may have been abandoned/completed, comment thread closed, or a concurrent edit " +
        "raced you). Re-fetch the resource and try again." +
        (detail ? ` Details: ${detail}` : ""),
    );
    this.name = "AdoConflictError";
  }
}
```

Then in `mapSdkError`, add a 409 branch right after the 404 branch:

```ts
  if (shape.statusCode === 404) {
    return new AdoNotFoundError(detail);
  }
  if (shape.statusCode === 409) {
    return new AdoConflictError(detail);
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/ado/errors.test.ts
```

Expected: PASS, 14 tests (12 pre-existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/ado/errors.ts test/unit/ado/errors.test.ts
git commit -m "feat(ado): add AdoConflictError for 409 responses"
```

---

## Task 2: Extend `AdoAuthError` message to mention write scopes

The current message only mentions read scopes. Phase 2 users may hit 401/403 because they're missing write scopes — the error should tell them what to add.

**Files:**
- Modify: `src/ado/errors.ts`
- Modify: `test/unit/ado/errors.test.ts`

- [ ] **Step 1: Update the existing assertion in the test**

Find the test `it("AdoAuthError carries a helpful message about scopes", ...)` and replace it with:

```ts
  it("AdoAuthError mentions both read and write scopes", () => {
    const mapped = mapSdkError(Object.assign(new Error("x"), { statusCode: 401 }));
    expect(mapped.message).toMatch(/PAT/i);
    expect(mapped.message).toMatch(/Code \(read\)/);
    expect(mapped.message).toMatch(/Code \(write\)/);
    expect(mapped.message).toMatch(/Pull Request \(write\)/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/ado/errors.test.ts
```

Expected: FAIL — current message doesn't mention write scopes.

- [ ] **Step 3: Update the `AdoAuthError` constructor message**

Replace the `super(...)` call in `AdoAuthError`:

```ts
    super(
      "Authentication failed against Azure DevOps. " +
        "The PAT may be expired, revoked, or missing required scopes. " +
        "For read access (PRs, comments): Code (read), Identity (read). " +
        "For write access (post comment, vote, update PR): also add Code (write) and Pull Request (write). " +
        "Re-run setup with a new PAT." +
        (detail ? ` Details: ${detail}` : ""),
    );
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: 14/14 pass in errors.test.ts; full suite 66/66 pass.

- [ ] **Step 5: Commit**

```bash
git add src/ado/errors.ts test/unit/ado/errors.test.ts
git commit -m "feat(ado): extend AdoAuthError message with write scopes"
```

---

## Task 3: Extend `ado/types.ts` re-exports

Add the SDK types Phase 2 will expose at the seam.

**Files:**
- Modify: `src/ado/types.ts` (full overwrite)

- [ ] **Step 1: Implement (full overwrite)**

```ts
// src/ado/types.ts
// Re-exports of azure-devops-node-api types we expose at the AdoClient seam.
// Keeping a single import surface here means downstream files don't import from
// "azure-devops-node-api/interfaces/...".
export type { Identity } from "azure-devops-node-api/interfaces/IdentitiesInterfaces.js";
export type { ConnectionData } from "azure-devops-node-api/interfaces/LocationsInterfaces.js";
export type { TeamProjectReference } from "azure-devops-node-api/interfaces/CoreInterfaces.js";
export type { IdentityRef } from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";
export type {
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitItem,
  GitPullRequestChange,
  PullRequestStatus,
  Comment,
  CommentThreadStatus,
  IdentityRefWithVote,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/ado/types.ts
git commit -m "feat(ado): re-export SDK types needed for write operations"
```

---

## Task 4: Extend `AdoClient` interface with 7 write method signatures

Like Phase 1's Task 6 — this intentionally leaves the project not typecheck-clean until Task 5 implements them.

**Files:**
- Modify: `src/ado/client.ts` (append to existing file)

- [ ] **Step 1: Add the new method signatures**

Open `src/ado/client.ts`. Replace the `import type { ... }` block at the top with:

```ts
import type {
  Identity,
  TeamProjectReference,
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitPullRequestChange,
  PullRequestStatus,
  Comment,
  CommentThreadStatus,
  IdentityRefWithVote,
} from "./types.js";
```

Then add these methods inside the `AdoClient` interface, after `listPullRequestIterations` and before the closing `}`:

```ts
  // pull request writes — comments
  createPullRequestThread(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    content: string;
    filePath?: string;
    line?: number;
  }): Promise<GitPullRequestCommentThread>;

  addPullRequestComment(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    threadId: number;
    content: string;
  }): Promise<Comment>;

  updatePullRequestThreadStatus(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    threadId: number;
    status: CommentThreadStatus;
  }): Promise<GitPullRequestCommentThread>;

  // pull request writes — vote
  setPullRequestVote(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerId: string;
    vote: number; // 10 / 5 / 0 / -5 / -10 — see writeService for mapping
  }): Promise<IdentityRefWithVote>;

  // pull request writes — metadata
  updatePullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    title?: string;
    description?: string;
    isDraft?: boolean;
  }): Promise<GitPullRequest>;

  // pull request writes — reviewers
  addPullRequestReviewers(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerIds: string[];
  }): Promise<IdentityRefWithVote[]>;

  removePullRequestReviewer(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerId: string;
  }): Promise<void>;
```

- [ ] **Step 2: Verify (will fail, expected)**

```bash
npm run typecheck 2>&1 | grep -E "client\.ts|sdkClient\.ts|FakeAdoClient" | head -10
```

Expected: errors are limited to `sdkClient.ts` and `FakeAdoClient.ts` complaining the new methods aren't implemented. No errors in `client.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/ado/client.ts
git commit -m "feat(ado): extend AdoClient interface with PR write method signatures"
```

(Repo will not typecheck cleanly until Tasks 5 and 6 land. We're in the middle of a multi-step refactor.)

---

## Task 5: Implement 7 write methods in `SdkAdoClient`

Brings `SdkAdoClient` back into compliance with the extended interface.

**Files:**
- Modify: `src/ado/sdkClient.ts` (append to existing class)

- [ ] **Step 1: Update the import block**

Replace the `import type { ... }` block with:

```ts
import type {
  Identity,
  TeamProjectReference,
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitPullRequestChange,
  PullRequestStatus,
  Comment,
  CommentThreadStatus,
  IdentityRefWithVote,
} from "./types.js";
```

- [ ] **Step 2: Implement the 7 new methods**

Append inside the `SdkAdoClient` class, after `listPullRequestIterations`:

```ts
  async createPullRequestThread(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    content: string;
    filePath?: string;
    line?: number;
  }): Promise<GitPullRequestCommentThread> {
    try {
      const git = await this.api.getGitApi();
      const thread: GitPullRequestCommentThread = {
        comments: [{ content: args.content, commentType: 1 /* text */, parentCommentId: 0 }],
        status: 1 /* active */,
        ...(args.filePath && args.line
          ? {
              threadContext: {
                filePath: args.filePath,
                rightFileStart: { line: args.line, offset: 1 },
                rightFileEnd: { line: args.line, offset: 1 },
              },
            }
          : {}),
      };
      const created = await git.createThread(thread, args.repository, args.pullRequestId, args.project);
      return created;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async addPullRequestComment(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    threadId: number;
    content: string;
  }): Promise<Comment> {
    try {
      const git = await this.api.getGitApi();
      const comment: Comment = { content: args.content, commentType: 1 /* text */, parentCommentId: 0 };
      const created = await git.createComment(
        comment,
        args.repository,
        args.pullRequestId,
        args.threadId,
        args.project,
      );
      return created;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async updatePullRequestThreadStatus(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    threadId: number;
    status: CommentThreadStatus;
  }): Promise<GitPullRequestCommentThread> {
    try {
      const git = await this.api.getGitApi();
      const update: GitPullRequestCommentThread = { status: args.status };
      const updated = await git.updateThread(
        update,
        args.repository,
        args.pullRequestId,
        args.threadId,
        args.project,
      );
      return updated;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async setPullRequestVote(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerId: string;
    vote: number;
  }): Promise<IdentityRefWithVote> {
    try {
      const git = await this.api.getGitApi();
      const reviewer: IdentityRefWithVote = { vote: args.vote };
      const updated = await git.createPullRequestReviewer(
        reviewer,
        args.repository,
        args.pullRequestId,
        args.reviewerId,
        args.project,
      );
      return updated;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async updatePullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    title?: string;
    description?: string;
    isDraft?: boolean;
  }): Promise<GitPullRequest> {
    try {
      const git = await this.api.getGitApi();
      const update: GitPullRequest = {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.isDraft !== undefined ? { isDraft: args.isDraft } : {}),
      };
      const updated = await git.updatePullRequest(
        update,
        args.repository,
        args.pullRequestId,
        args.project,
      );
      return updated;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async addPullRequestReviewers(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerIds: string[];
  }): Promise<IdentityRefWithVote[]> {
    try {
      const git = await this.api.getGitApi();
      const reviewers = args.reviewerIds.map((id) => ({ id }));
      const added = await git.createPullRequestReviewers(
        reviewers,
        args.repository,
        args.pullRequestId,
        args.project,
      );
      return added;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async removePullRequestReviewer(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerId: string;
  }): Promise<void> {
    try {
      const git = await this.api.getGitApi();
      await git.deletePullRequestReviewer(
        args.repository,
        args.pullRequestId,
        args.reviewerId,
        args.project,
      );
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck && npm test 2>&1 | tail -5
```

Expected: typecheck is still failing (FakeAdoClient also needs to satisfy the interface — Task 6); existing 66 tests still pass via vitest. The remaining typecheck errors should be limited to FakeAdoClient.

- [ ] **Step 4: Commit**

```bash
git add src/ado/sdkClient.ts
git commit -m "feat(ado): implement PR write methods on SdkAdoClient"
```

---

## Task 6: Extend `FakeAdoClient` with 7 write method stubs

Brings the test fake into compliance with the extended interface.

**Files:**
- Modify: `test/fakes/FakeAdoClient.ts`

- [ ] **Step 1: Extend the imports + class**

Replace the `import type { ... }` block at the top with:

```ts
import type {
  Identity,
  TeamProjectReference,
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitPullRequestChange,
  PullRequestStatus,
  Comment,
  CommentThreadStatus,
  IdentityRefWithVote,
} from "../../src/ado/types.js";
```

Add inside the class, after the existing private state declarations:

```ts
  // ---- write-side state (Phase 2) ----
  // History of writes per PR — tests can inspect to verify what was sent.
  private createdThreads: Array<{ key: string; thread: GitPullRequestCommentThread }> = [];
  private createdComments: Array<{ key: string; threadId: number; comment: Comment }> = [];
  private threadStatusUpdates: Array<{ key: string; threadId: number; status: CommentThreadStatus }> = [];
  private voteUpdates: Array<{ key: string; reviewerId: string; vote: number }> = [];
  private prUpdates: Array<{ key: string; update: Partial<GitPullRequest> }> = [];
  private reviewerAdds: Array<{ key: string; reviewerIds: string[] }> = [];
  private reviewerRemoves: Array<{ key: string; reviewerId: string }> = [];

  // Configurable return values for the writes.
  private nextCreatedThread?: GitPullRequestCommentThread;
  private nextCreatedComment?: Comment;
  private nextUpdatedThread?: GitPullRequestCommentThread;
  private nextVoteResult?: IdentityRefWithVote;
  private nextUpdatedPr?: GitPullRequest;
  private nextAddedReviewers?: IdentityRefWithVote[];
```

Add these setup helpers (test-only) inside the class, after the existing setup helpers:

```ts
  // ---- write-side setup helpers ----
  setNextCreatedThread(thread: GitPullRequestCommentThread): void {
    this.nextCreatedThread = thread;
  }
  setNextCreatedComment(comment: Comment): void {
    this.nextCreatedComment = comment;
  }
  setNextUpdatedThread(thread: GitPullRequestCommentThread): void {
    this.nextUpdatedThread = thread;
  }
  setNextVoteResult(vote: IdentityRefWithVote): void {
    this.nextVoteResult = vote;
  }
  setNextUpdatedPr(pr: GitPullRequest): void {
    this.nextUpdatedPr = pr;
  }
  setNextAddedReviewers(reviewers: IdentityRefWithVote[]): void {
    this.nextAddedReviewers = reviewers;
  }

  // ---- write-side history accessors (for assertions) ----
  getCreatedThreads(): ReadonlyArray<{ key: string; thread: GitPullRequestCommentThread }> {
    return this.createdThreads;
  }
  getCreatedComments(): ReadonlyArray<{ key: string; threadId: number; comment: Comment }> {
    return this.createdComments;
  }
  getThreadStatusUpdates(): ReadonlyArray<{ key: string; threadId: number; status: CommentThreadStatus }> {
    return this.threadStatusUpdates;
  }
  getVoteUpdates(): ReadonlyArray<{ key: string; reviewerId: string; vote: number }> {
    return this.voteUpdates;
  }
  getPrUpdates(): ReadonlyArray<{ key: string; update: Partial<GitPullRequest> }> {
    return this.prUpdates;
  }
  getReviewerAdds(): ReadonlyArray<{ key: string; reviewerIds: string[] }> {
    return this.reviewerAdds;
  }
  getReviewerRemoves(): ReadonlyArray<{ key: string; reviewerId: string }> {
    return this.reviewerRemoves;
  }
```

Add these method implementations inside the class, after `listPullRequestIterations`:

```ts
  async createPullRequestThread(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    content: string;
    filePath?: string;
    line?: number;
  }): Promise<GitPullRequestCommentThread> {
    this.throwIfInjected("createPullRequestThread");
    const thread: GitPullRequestCommentThread = {
      id: 999,
      comments: [{ content: args.content, commentType: 1 }],
      status: 1,
      ...(args.filePath && args.line
        ? {
            threadContext: {
              filePath: args.filePath,
              rightFileStart: { line: args.line, offset: 1 },
              rightFileEnd: { line: args.line, offset: 1 },
            },
          }
        : {}),
    };
    this.createdThreads.push({ key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }), thread });
    return this.nextCreatedThread ?? thread;
  }

  async addPullRequestComment(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    threadId: number;
    content: string;
  }): Promise<Comment> {
    this.throwIfInjected("addPullRequestComment");
    const comment: Comment = { id: 999, content: args.content, commentType: 1 };
    this.createdComments.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      threadId: args.threadId,
      comment,
    });
    return this.nextCreatedComment ?? comment;
  }

  async updatePullRequestThreadStatus(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    threadId: number;
    status: CommentThreadStatus;
  }): Promise<GitPullRequestCommentThread> {
    this.throwIfInjected("updatePullRequestThreadStatus");
    this.threadStatusUpdates.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      threadId: args.threadId,
      status: args.status,
    });
    return this.nextUpdatedThread ?? { id: args.threadId, status: args.status };
  }

  async setPullRequestVote(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerId: string;
    vote: number;
  }): Promise<IdentityRefWithVote> {
    this.throwIfInjected("setPullRequestVote");
    this.voteUpdates.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      reviewerId: args.reviewerId,
      vote: args.vote,
    });
    return this.nextVoteResult ?? { id: args.reviewerId, vote: args.vote };
  }

  async updatePullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    title?: string;
    description?: string;
    isDraft?: boolean;
  }): Promise<GitPullRequest> {
    this.throwIfInjected("updatePullRequest");
    const update: Partial<GitPullRequest> = {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.isDraft !== undefined ? { isDraft: args.isDraft } : {}),
    };
    this.prUpdates.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      update,
    });
    return this.nextUpdatedPr ?? { pullRequestId: args.pullRequestId, ...update };
  }

  async addPullRequestReviewers(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerIds: string[];
  }): Promise<IdentityRefWithVote[]> {
    this.throwIfInjected("addPullRequestReviewers");
    this.reviewerAdds.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      reviewerIds: args.reviewerIds,
    });
    return this.nextAddedReviewers ?? args.reviewerIds.map((id) => ({ id, vote: 0 }));
  }

  async removePullRequestReviewer(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerId: string;
  }): Promise<void> {
    this.throwIfInjected("removePullRequestReviewer");
    this.reviewerRemoves.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      reviewerId: args.reviewerId,
    });
  }
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck && npm test 2>&1 | tail -5
```

Expected: typecheck exit 0 (repo is back to green); existing 66 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add test/fakes/FakeAdoClient.ts
git commit -m "test: extend FakeAdoClient with PR write method stubs and history accessors"
```

---

## Task 7: Extract `repoResolution.ts` from `pullRequests/service.ts` — TDD

Pull the private `resolve()` logic out of the existing service so both read and write services can use it (without inheritance) once we split.

**Files:**
- Create: `test/unit/domains/pullRequests/repoResolution.test.ts`
- Create: `src/domains/pullRequests/repoResolution.ts`
- Modify: `src/domains/pullRequests/service.ts` (remove the private `resolve()` method, import from new module)
- Modify: `test/unit/domains/pullRequests/service.test.ts` (remove the 4 repo-resolution tests — they migrate to the new file)

- [ ] **Step 1: Write the failing test**

Create `test/unit/domains/pullRequests/repoResolution.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/pullRequests/repoResolution.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `repoResolution.ts`**

```ts
// src/domains/pullRequests/repoResolution.ts
import { detectRepo } from "../../git/detectRepo.js";
import type { ParsedRemote } from "../../git/parseRemoteUrl.js";

export class RepoContextError extends Error {
  constructor() {
    super(
      "Could not resolve project + repository. Either pass them explicitly " +
        "or run from inside an Azure DevOps git checkout (with `origin` set).",
    );
    this.name = "RepoContextError";
  }
}

export type RepoResolver = (cwd?: string) => Promise<ParsedRemote | null>;

/**
 * Resolves project + repository from explicit args, falling back to the
 * cwd-based git remote detector. Used by both the read and write PR services.
 *
 * Pure function. Does not throw on its own — only RepoContextError when both
 * sides come up empty.
 */
export async function resolveRepo(
  args: { project?: string; repository?: string },
  resolver: RepoResolver = detectRepo,
): Promise<{ project: string; repository: string }> {
  if (args.project && args.repository) {
    return { project: args.project, repository: args.repository };
  }
  const detected = await resolver();
  const project = args.project ?? detected?.project;
  const repository = args.repository ?? detected?.repo;
  if (!project || !repository) throw new RepoContextError();
  return { project, repository };
}
```

- [ ] **Step 4: Update `service.ts` to use the new helper**

Open `src/domains/pullRequests/service.ts`. At the top, replace:

```ts
import { detectRepo } from "../../git/detectRepo.js";
import type { ParsedRemote } from "../../git/parseRemoteUrl.js";
```

with:

```ts
import { resolveRepo, RepoContextError, type RepoResolver } from "./repoResolution.js";
```

Remove the existing `RepoContextError` class definition and the `RepoResolver` type alias (both now come from `repoResolution.ts`). Keep the `export { RepoContextError }` wrapper by re-exporting:

```ts
export { RepoContextError } from "./repoResolution.js";
export type { RepoResolver } from "./repoResolution.js";
```

(This preserves the existing public API of `service.ts` so `service.test.ts` still imports work.)

Keep the `detectRepo` import (we still need it for the constructor default):

```ts
import { detectRepo } from "../../git/detectRepo.js";
```

Update the constructor to store a `resolver` (defaulting to `detectRepo`):

```ts
  constructor(
    private readonly client: AdoClient,
    private readonly resolver: RepoResolver = detectRepo,
  ) {}
```

Delete the existing private `resolve()` method (the whole block) and replace every `await this.resolve(args)` call site with:

```ts
await resolveRepo(args, this.resolver)
```

- [ ] **Step 5: Remove migrated tests from `service.test.ts`**

Open `test/unit/domains/pullRequests/service.test.ts`. Delete the entire `describe("PullRequestsService — repo resolution", ...)` block (the 4 tests) — they live in `repoResolution.test.ts` now.

- [ ] **Step 6: Run all tests**

```bash
npm test 2>&1 | tail -8
```

Expected: 68 tests pass. Breakdown:
- 66 pre-existing − 4 (removed repo-resolution tests in service.test.ts) = 62 carried forward
- + 6 new tests in `repoResolution.test.ts`
- = 68 total

(If you got 66 still, the 4 tests didn't get removed properly. If you got fewer than 68, an extracted test failed — debug.)

- [ ] **Step 7: Commit**

```bash
git add src/domains/pullRequests/repoResolution.ts \
        src/domains/pullRequests/service.ts \
        test/unit/domains/pullRequests/repoResolution.test.ts \
        test/unit/domains/pullRequests/service.test.ts
git commit -m "refactor(pullRequests): extract repoResolution to a shared pure helper"
```

---

## Task 8: Rename `service.ts` → `readService.ts` and `tools.ts` → `readTools.ts`

Mechanical rename so the read/write split is clear. Updates all imports.

**Files:**
- Rename: `src/domains/pullRequests/service.ts` → `readService.ts`
- Rename: `src/domains/pullRequests/tools.ts` → `readTools.ts`
- Rename: `test/unit/domains/pullRequests/service.test.ts` → `readService.test.ts`
- Modify: `src/mcp/registerTools.ts` (one import line)

- [ ] **Step 1: Rename the source files**

```bash
git mv src/domains/pullRequests/service.ts src/domains/pullRequests/readService.ts
git mv src/domains/pullRequests/tools.ts src/domains/pullRequests/readTools.ts
git mv test/unit/domains/pullRequests/service.test.ts test/unit/domains/pullRequests/readService.test.ts
```

- [ ] **Step 2: Rename the class inside `readService.ts`**

Open `src/domains/pullRequests/readService.ts`. Rename the exported class:

```ts
export class PullRequestsReadService {
```

(was `export class PullRequestsService`).

- [ ] **Step 3: Rename the function inside `readTools.ts`**

Open `src/domains/pullRequests/readTools.ts`. Rename the exported function:

```ts
import type { PullRequestsReadService } from "./readService.js";

export function buildPullRequestReadTools(svc: PullRequestsReadService): ToolDefinition[] {
```

(was `buildPullRequestTools` taking `PullRequestsService`).

- [ ] **Step 4: Update the test imports**

Open `test/unit/domains/pullRequests/readService.test.ts`. Update:

```ts
import {
  PullRequestsReadService,
  RepoContextError,
} from "../../../../src/domains/pullRequests/readService.js";
```

(was `PullRequestsService` from `service.js`)

Then find every `new PullRequestsService(...)` in the file and replace with `new PullRequestsReadService(...)`.

- [ ] **Step 5: Update `mcp/registerTools.ts`**

Open `src/mcp/registerTools.ts`. Update the imports from `pullRequests`:

```ts
import { PullRequestsReadService } from "../domains/pullRequests/readService.js";
import { buildPullRequestReadTools } from "../domains/pullRequests/readTools.js";
```

(were `PullRequestsService` from `service.js` and `buildPullRequestTools` from `tools.js`).

In the function body, update the call sites:

```ts
    ...buildPullRequestReadTools(new PullRequestsReadService(client)),
```

(was `buildPullRequestTools(new PullRequestsService(client))`).

- [ ] **Step 6: Verify**

```bash
npm run typecheck && npm test 2>&1 | tail -5
```

Expected: typecheck exit 0; 68/68 tests pass (no count change — only rename).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(pullRequests): rename service/tools → readService/readTools for read+write split"
```

---

## Task 9: Extend `pullRequests/schemas.ts` with write tool input schemas

**Files:**
- Modify: `src/domains/pullRequests/schemas.ts`

- [ ] **Step 1: Append the new schemas**

Open `src/domains/pullRequests/schemas.ts`. After the existing `GetPullRequestDiffInput` block, append:

```ts
export const AddPullRequestCommentInput = {
  ...PullRequestId,
  content: z.string().min(1).describe(
    "Markdown comment body. ADO renders markdown — feel free to use code blocks, lists, links.",
  ),
  filePath: z
    .string()
    .optional()
    .describe(
      "Repo-relative path of the file to anchor the comment to. " +
        "If omitted, the comment is a general PR-level comment (not on a specific file).",
    ),
  line: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based line number to anchor the comment to. Required if `filePath` is set."),
};

export const ReplyToPullRequestThreadInput = {
  ...PullRequestId,
  threadId: z.number().int().positive().describe("The thread id to reply in."),
  content: z.string().min(1).describe("Markdown reply body."),
};

export const UpdatePullRequestThreadStatusInput = {
  ...PullRequestId,
  threadId: z.number().int().positive().describe("The thread id to update."),
  status: z
    .enum(["active", "fixed", "wontFix", "closed", "byDesign", "pending"])
    .describe("New thread status. 'fixed' is the most common — marks the thread as resolved."),
};

export const VoteOnPullRequestInput = {
  ...PullRequestId,
  vote: z
    .enum(["approve", "approveWithSuggestions", "wait", "reject", "reset"])
    .describe(
      "Your vote on this PR. 'reset' clears your existing vote (e.g. you voted earlier but want to abstain).",
    ),
};

export const UpdatePullRequestInput = {
  ...PullRequestId,
  title: z.string().min(1).optional().describe("New PR title."),
  description: z.string().optional().describe("New PR description (markdown). Pass empty string to clear."),
};

export const SetPullRequestDraftStateInput = {
  ...PullRequestId,
  isDraft: z.boolean().describe("true to mark as draft, false to publish."),
};

export const AddPullRequestReviewersInput = {
  ...PullRequestId,
  reviewerIds: z
    .array(z.string().min(1))
    .min(1)
    .describe("Array of identity ids to add as reviewers. Use whoami / list_pull_requests to find ids."),
};

export const RemovePullRequestReviewerInput = {
  ...PullRequestId,
  reviewerId: z.string().min(1).describe("The identity id to remove from reviewers."),
};
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/domains/pullRequests/schemas.ts
git commit -m "feat(pullRequests): add zod input schemas for write tools"
```

---

## Task 10: Implement `pullRequests/writeService.ts` — TDD (largest task)

8 service methods. Each: resolve repo, call client, return shaped response.

**Files:**
- Create: `test/unit/domains/pullRequests/writeService.test.ts`
- Create: `src/domains/pullRequests/writeService.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/domains/pullRequests/writeService.test.ts`:

```ts
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
  it("appends a comment to the named thread", async () => {
    const { svc, fake } = makeSvc();
    await svc.replyToThread({ pullRequestId: 1, threadId: 7, content: "Sounds good" });
    const created = fake.getCreatedComments();
    expect(created[0]?.threadId).toBe(7);
    expect(created[0]?.comment.content).toBe("Sounds good");
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/pullRequests/writeService.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/domains/pullRequests/writeService.ts`:

```ts
// src/domains/pullRequests/writeService.ts
import type { AdoClient } from "../../ado/client.js";
import type {
  Comment,
  CommentThreadStatus,
  GitPullRequest,
  GitPullRequestCommentThread,
  IdentityRefWithVote,
} from "../../ado/types.js";
import { detectRepo } from "../../git/detectRepo.js";
import { resolveRepo, type RepoResolver } from "./repoResolution.js";

// --- enum mappings (mirrors readService's reverse maps) ---

const THREAD_STATUS_TO_ENUM: Record<string, CommentThreadStatus> = {
  active: 1,
  fixed: 2,
  wontFix: 3,
  closed: 4,
  byDesign: 5,
  pending: 6,
};

const THREAD_STATUS_FROM_ENUM: Record<number, string> = {
  0: "unknown",
  1: "active",
  2: "fixed",
  3: "wontFix",
  4: "closed",
  5: "byDesign",
  6: "pending",
};

// ADO vote values (numeric, no enum in the SDK's PullRequestVote interface).
// 10 = approve, 5 = approve with suggestions, 0 = no vote / reset, -5 = wait, -10 = reject.
const VOTE_TO_NUMBER: Record<string, number> = {
  approve: 10,
  approveWithSuggestions: 5,
  wait: -5,
  reject: -10,
  reset: 0,
};

const VOTE_FROM_NUMBER: Record<number, string> = {
  10: "approve",
  5: "approveWithSuggestions",
  0: "reset",
  [-5]: "wait",
  [-10]: "reject",
};

// --- response shapes ---

export interface AddCommentResult {
  threadId: number;
  status: string;
}

export interface UpdateThreadStatusResult {
  threadId: number;
  status: string;
}

export interface VoteResult {
  vote: string;
  reviewer?: string;
  reviewerId?: string;
}

export interface UpdatePrResult {
  pullRequestId: number;
  title?: string;
  description?: string;
  isDraft?: boolean;
}

export interface AddReviewersResult {
  added: Array<{ id?: string; name?: string; vote: number }>;
}

// --- service ---

export class PullRequestsWriteService {
  constructor(
    private readonly client: AdoClient,
    private readonly resolver: RepoResolver = detectRepo,
  ) {}

  async addComment(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    content: string;
    filePath?: string;
    line?: number;
  }): Promise<AddCommentResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const thread = await this.client.createPullRequestThread({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      content: args.content,
      ...(args.filePath ? { filePath: args.filePath } : {}),
      ...(args.line ? { line: args.line } : {}),
    });
    return shapeThreadResult(thread);
  }

  async replyToThread(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    threadId: number;
    content: string;
  }): Promise<{ commentId?: number }> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const comment = await this.client.addPullRequestComment({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      threadId: args.threadId,
      content: args.content,
    });
    return { commentId: comment.id };
  }

  async updateThreadStatus(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    threadId: number;
    status: string;
  }): Promise<UpdateThreadStatusResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const enumValue = THREAD_STATUS_TO_ENUM[args.status];
    if (enumValue === undefined) {
      throw new Error(`Unknown thread status: ${args.status}`);
    }
    const updated = await this.client.updatePullRequestThreadStatus({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      threadId: args.threadId,
      status: enumValue,
    });
    return shapeThreadResult(updated);
  }

  async vote(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    vote: string;
  }): Promise<VoteResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const voteNumber = VOTE_TO_NUMBER[args.vote];
    if (voteNumber === undefined) {
      throw new Error(`Unknown vote value: ${args.vote}`);
    }
    const me = await this.client.whoami();
    if (!me.id) throw new Error("whoami() returned identity without id");
    const updated = await this.client.setPullRequestVote({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      reviewerId: me.id,
      vote: voteNumber,
    });
    return shapeVoteResult(updated, args.vote);
  }

  async updatePullRequest(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    title?: string;
    description?: string;
  }): Promise<UpdatePrResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    if (args.title === undefined && args.description === undefined) {
      throw new Error("updatePullRequest requires at least one of title or description");
    }
    const updated = await this.client.updatePullRequest({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
    });
    return shapePrResult(updated);
  }

  async setDraftState(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    isDraft: boolean;
  }): Promise<UpdatePrResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const updated = await this.client.updatePullRequest({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      isDraft: args.isDraft,
    });
    return shapePrResult(updated);
  }

  async addReviewers(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    reviewerIds: string[];
  }): Promise<AddReviewersResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const added = await this.client.addPullRequestReviewers({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      reviewerIds: args.reviewerIds,
    });
    return {
      added: added.map((r) => ({
        id: r.id,
        name: r.displayName,
        vote: r.vote ?? 0,
      })),
    };
  }

  async removeReviewer(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    reviewerId: string;
  }): Promise<{ removed: string }> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    await this.client.removePullRequestReviewer({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      reviewerId: args.reviewerId,
    });
    return { removed: args.reviewerId };
  }
}

// --- shapers (pure) ---

function shapeThreadResult(t: GitPullRequestCommentThread): AddCommentResult {
  return {
    threadId: t.id ?? 0,
    status: THREAD_STATUS_FROM_ENUM[t.status ?? 0] ?? "unknown",
  };
}

function shapeVoteResult(r: IdentityRefWithVote, requestedVote: string): VoteResult {
  return {
    vote: VOTE_FROM_NUMBER[r.vote ?? 0] ?? requestedVote,
    reviewer: r.displayName,
    reviewerId: r.id,
  };
}

function shapePrResult(pr: GitPullRequest): UpdatePrResult {
  return {
    pullRequestId: pr.pullRequestId ?? 0,
    title: pr.title,
    description: pr.description,
    isDraft: pr.isDraft,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/domains/pullRequests/writeService.test.ts
```

Expected: PASS, ~16 tests (5 vote-mapping cases + 11 others).

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: 84 total (68 from pre-Phase-2 + 16 new write service).

- [ ] **Step 6: Commit**

```bash
git add src/domains/pullRequests/writeService.ts test/unit/domains/pullRequests/writeService.test.ts
git commit -m "feat(pullRequests): add PullRequestsWriteService with 8 write methods"
```

---

## Task 11: Implement `pullRequests/writeTools.ts` — 8 MCP tool definitions

**Files:**
- Create: `src/domains/pullRequests/writeTools.ts`

- [ ] **Step 1: Implement**

```ts
// src/domains/pullRequests/writeTools.ts
import type { PullRequestsWriteService } from "./writeService.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  AddPullRequestCommentInput,
  ReplyToPullRequestThreadInput,
  UpdatePullRequestThreadStatusInput,
  VoteOnPullRequestInput,
  UpdatePullRequestInput,
  SetPullRequestDraftStateInput,
  AddPullRequestReviewersInput,
  RemovePullRequestReviewerInput,
} from "./schemas.js";

export function buildPullRequestWriteTools(svc: PullRequestsWriteService): ToolDefinition[] {
  return [
    {
      name: "add_pull_request_comment",
      config: {
        title: "Add a comment to a pull request",
        description:
          "Posts a new comment thread on a pull request. Body is markdown (ADO renders it). " +
          "Optional `filePath` + `line` together create a line-anchored review note on a specific " +
          "line of a specific file. Without those, the comment is a general PR-level comment.",
        inputSchema: AddPullRequestCommentInput,
      },
      handler: async (args) =>
        svc.addComment(args as Parameters<typeof svc.addComment>[0]),
    },
    {
      name: "reply_to_pull_request_thread",
      config: {
        title: "Reply to a pull request comment thread",
        description:
          "Appends a comment to an existing thread (by `threadId`). Use this to respond to a " +
          "reviewer's question or to continue a conversation. Body is markdown.",
        inputSchema: ReplyToPullRequestThreadInput,
      },
      handler: async (args) =>
        svc.replyToThread(args as Parameters<typeof svc.replyToThread>[0]),
    },
    {
      name: "update_pull_request_thread_status",
      config: {
        title: "Resolve / change status of a pull request comment thread",
        description:
          "Sets a thread's status. The most common transition is `active` → `fixed` to mark the " +
          "feedback as addressed. Other values: `wontFix`, `closed`, `byDesign`, `pending`.",
        inputSchema: UpdatePullRequestThreadStatusInput,
      },
      handler: async (args) =>
        svc.updateThreadStatus(args as Parameters<typeof svc.updateThreadStatus>[0]),
    },
    {
      name: "vote_on_pull_request",
      config: {
        title: "Cast or update your vote on a pull request",
        description:
          "Records your vote: `approve`, `approveWithSuggestions`, `wait`, `reject`, or `reset` " +
          "(clears your vote). Always confirms with the user before calling — vote is visible to " +
          "all reviewers and is your name on the action.",
        inputSchema: VoteOnPullRequestInput,
      },
      handler: async (args) => svc.vote(args as Parameters<typeof svc.vote>[0]),
    },
    {
      name: "update_pull_request",
      config: {
        title: "Edit pull request title and/or description",
        description:
          "Updates the PR title, description, or both. Description is markdown. To set the draft " +
          "state, use `set_pull_request_draft_state` instead.",
        inputSchema: UpdatePullRequestInput,
      },
      handler: async (args) =>
        svc.updatePullRequest(args as Parameters<typeof svc.updatePullRequest>[0]),
    },
    {
      name: "set_pull_request_draft_state",
      config: {
        title: "Mark a pull request as draft or publish it",
        description:
          "Toggles the draft state. Drafts can't receive votes from reviewers. Set `isDraft: false` " +
          "when the PR is ready for review.",
        inputSchema: SetPullRequestDraftStateInput,
      },
      handler: async (args) =>
        svc.setDraftState(args as Parameters<typeof svc.setDraftState>[0]),
    },
    {
      name: "add_pull_request_reviewers",
      config: {
        title: "Add reviewers to a pull request",
        description:
          "Adds one or more identities as reviewers. Identity ids come from `whoami`, " +
          "`get_pull_request` (existing reviewers), or `list_projects` (team identities).",
        inputSchema: AddPullRequestReviewersInput,
      },
      handler: async (args) =>
        svc.addReviewers(args as Parameters<typeof svc.addReviewers>[0]),
    },
    {
      name: "remove_pull_request_reviewer",
      config: {
        title: "Remove a reviewer from a pull request",
        description: "Removes one identity from the PR's reviewer list (by id).",
        inputSchema: RemovePullRequestReviewerInput,
      },
      handler: async (args) =>
        svc.removeReviewer(args as Parameters<typeof svc.removeReviewer>[0]),
    },
  ];
}
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/domains/pullRequests/writeTools.ts
git commit -m "feat(pullRequests): add 8 MCP write tool definitions"
```

---

## Task 12: Update `mcp/registerTools.ts` — split read/write arrays, gate writes by `readOnly`

This is the moment the env var becomes load-bearing.

**Files:**
- Modify: `src/mcp/registerTools.ts` (full overwrite)

- [ ] **Step 1: Implement (full overwrite)**

```ts
// src/mcp/registerTools.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IdentityService } from "../domains/identity/service.js";
import { buildIdentityTools } from "../domains/identity/tools.js";
import { ProjectsService } from "../domains/projects/service.js";
import { buildProjectsTools } from "../domains/projects/tools.js";
import { RepositoriesService } from "../domains/repositories/service.js";
import { buildRepositoriesTools } from "../domains/repositories/tools.js";
import { PullRequestsReadService } from "../domains/pullRequests/readService.js";
import { buildPullRequestReadTools } from "../domains/pullRequests/readTools.js";
import { PullRequestsWriteService } from "../domains/pullRequests/writeService.js";
import { buildPullRequestWriteTools } from "../domains/pullRequests/writeTools.js";
import { toToolResult } from "./errorBoundary.js";
import type { AdoClient } from "../ado/client.js";

export interface RegisterAllToolsOptions {
  /**
   * When true, write tools (Phase 2: comment / reply / vote / update / draft / reviewers)
   * are NOT registered. The LLM's tool list contains only the read tools — write attempts
   * are impossible because the tools don't exist on the surface.
   *
   * Set via the AZURE_DEVOPS_READ_ONLY env var, read by index.ts at startup.
   */
  readOnly?: boolean;
}

/**
 * Wires domain services to AdoClient and registers all tools on the McpServer.
 * Phase 1 read tools always register. Phase 2 write tools are gated by `options.readOnly`.
 */
export function registerAllTools(
  server: McpServer,
  client: AdoClient,
  options: RegisterAllToolsOptions = {},
): void {
  const readTools = [
    ...buildIdentityTools(new IdentityService(client)),
    ...buildProjectsTools(new ProjectsService(client)),
    ...buildRepositoriesTools(new RepositoriesService(client)),
    ...buildPullRequestReadTools(new PullRequestsReadService(client)),
  ];

  const writeTools = options.readOnly
    ? []
    : buildPullRequestWriteTools(new PullRequestsWriteService(client));

  for (const tool of [...readTools, ...writeTools]) {
    server.registerTool(tool.name, tool.config, toToolResult(tool.handler));
  }
}
```

- [ ] **Step 2: Verify it compiles, builds, and tests pass**

```bash
npm run typecheck && npm run build && npm test 2>&1 | tail -5
```

Expected: all green; 84/84 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/registerTools.ts
git commit -m "feat(mcp): make readOnly flag load-bearing — gate write tools registration"
```

---

## Task 13: Setup wizard mentions write scopes

**Files:**
- Modify: `src/setup.ts`

- [ ] **Step 1: Add the message**

Open `src/setup.ts`. Find the line at the top of `runSetup`:

```ts
  process.stdout.write("\nAzure DevOps MCP — setup\n\n");
```

Replace with:

```ts
  process.stdout.write("\nAzure DevOps MCP — setup\n\n");
  process.stdout.write(
    "Required PAT scopes:\n" +
      "  Read access:  Code (read), Identity (read)\n" +
      "  Write access: also add Code (write), Pull Request (write)\n" +
      "If you only want read tools, use a read-only PAT or set AZURE_DEVOPS_READ_ONLY=true.\n\n",
  );
```

- [ ] **Step 2: Verify it builds**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/setup.ts
git commit -m "feat(setup): document required PAT scopes for read vs write"
```

---

## Task 14: Update `README.md` for Phase 2

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the README** (full overwrite)

```markdown
# Azure DevOps MCP

Azure DevOps MCP server for Claude Code and other MCP hosts. Supports both **Azure DevOps Server** (on-prem) and **Azure DevOps Services** (cloud). v2 ships the full PR review workflow — read PRs, post comments, reply to threads, resolve threads, vote, edit PR metadata, manage reviewers. Read-only mode is available for users who want a restricted surface.

## Setup

```bash
npx -y @vasekzdvihal/azure-devops-mcp setup
```

You'll be prompted for:

- **ADO base URL** — e.g. `https://dev.azure.com/myorg` (cloud) or `https://tfs.company.com/tfs/DefaultCollection` (on-prem).
- **Personal Access Token** — input is masked. See [Required PAT scopes](#required-pat-scopes) below.
- **CA bundle path** (optional) — path to a PEM file. Set this if your on-prem ADO uses an internal CA that isn't in your OS trust store. Leave blank otherwise.

The wizard tests the connection before writing anything. Config goes to `~/.config/azure-devops-mcp/config.json` (mode `0600`); PAT goes to your OS keyring.

## Required PAT scopes

| Mode | Required scopes |
| --- | --- |
| Read-only (read tools only) | **Code (read)**, **Identity (read)** |
| Full (default — read + write tools) | **Code (read & write)**, **Pull Request (read & write)**, **Identity (read)** |

A read-only PAT is the actual security guarantee — ADO enforces scope at the API regardless of what the MCP server exposes. The read-only mode env var (below) is an additional layer for users who can't or don't want to scope down their PAT.

## Use with Claude Code

Add to your `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["-y", "@vasekzdvihal/azure-devops-mcp"]
    }
  }
}
```

### Read-only mode

Set `AZURE_DEVOPS_READ_ONLY=true` in the `env` block to suppress write tools entirely:

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["-y", "@vasekzdvihal/azure-devops-mcp"],
      "env": { "AZURE_DEVOPS_READ_ONLY": "true" }
    }
  }
}
```

When set, the LLM's tool list contains only the read tools — `add_pull_request_comment`, `vote_on_pull_request`, etc. don't exist on the surface. Useful when you want Claude to summarize/analyze PRs but never post on your behalf, even though your PAT has write scope.

### Cwd auto-detect

The pull-request tools auto-detect the current `project` and `repository` from your shell's `cwd` `.git/config remote.origin.url` when those args aren't passed. So `list_pull_requests` and `add_pull_request_comment` "just work" when Claude is run from inside an ADO checkout. Pass them explicitly to override.

## Available tools

### Read tools (always available)

| Tool | Description |
| --- | --- |
| `whoami` | Returns the identity associated with the configured PAT. |
| `list_projects` | Lists ADO projects in the configured collection / org. |
| `list_repositories` | Lists git repositories in a given project. |
| `list_pull_requests` | Lists PRs in a repo (default: active). Filters: status, creator, reviewer, target branch. |
| `get_pull_request` | Full PR metadata: title, description, status, reviewers, branches, draft state, merge status. |
| `list_pull_request_changes` | Lists files changed in a PR with change types. Cheap; no diff content. |
| `get_pull_request_diff` | Returns unified diff text for a single file in a PR (truncatable). |
| `list_pull_request_comments` | Returns comment threads on a PR (with line anchors). |
| `get_pull_request_iterations` | Returns iteration history of a PR (each push = one iteration). |

### Write tools (suppressed in read-only mode)

| Tool | Description |
| --- | --- |
| `add_pull_request_comment` | Post a new comment thread. Optional `filePath` + `line` for line-anchored review notes. Body is markdown. |
| `reply_to_pull_request_thread` | Append a comment to an existing thread. |
| `update_pull_request_thread_status` | Resolve a thread (`fixed`) or change its status (`wontFix` / `closed` / `byDesign` / `pending`). |
| `vote_on_pull_request` | Cast or update your vote: `approve` / `approveWithSuggestions` / `wait` / `reject` / `reset`. |
| `update_pull_request` | Edit PR title and/or description (markdown). |
| `set_pull_request_draft_state` | Mark draft or publish (`isDraft: true/false`). |
| `add_pull_request_reviewers` | Add one or more identities as reviewers. |
| `remove_pull_request_reviewer` | Remove one identity from the reviewer list. |

## Troubleshooting

- **"Azure DevOps MCP config not found"** — run setup.
- **"No PAT found in OS keyring"** — same fix; setup writes both.
- **"Authentication failed against Azure DevOps. The PAT may be expired..."** — regenerate the PAT and re-run setup. See [Required PAT scopes](#required-pat-scopes).
- **"TLS verification failed"** — your ADO Server uses a cert your machine doesn't trust. Re-run setup and provide the path to your organization's CA bundle (PEM file).
- **"Could not reach Azure DevOps"** — base URL or network issue.
- **"Could not resolve project + repository"** — you called a PR tool from outside an ADO checkout without passing `project`/`repository`. Either `cd` into the repo or pass the names.
- **"Conflict from Azure DevOps"** — the PR or thread state changed (already abandoned/completed/closed) since your read. Re-fetch with `get_pull_request` and try again.

## Development

```bash
npm install
npm test            # unit tests
npm run typecheck   # TypeScript check
npm run build       # compile to dist/
npm run dev         # run server from source via tsx
npm run setup       # run setup wizard from source
```

Architecture and design decisions live in `docs/superpowers/specs/2026-04-21-azure-devops-mcp-design.md`. Per-phase implementation plans in `docs/superpowers/plans/`. Roadmap in `docs/ROADMAP.md`.

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with Phase 2 tool catalog and PAT scope guidance"
```

---

## Task 15: Bump version to `0.2.0`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Edit the version field**

Open `package.json`. Change:

```json
  "version": "0.0.1",
```

to:

```json
  "version": "0.2.0",
```

(We're skipping `0.1.0` because Phase 1 was never published; the version-on-publish convention starts at the first publishable surface, which is Phase 2 with its full review workflow.)

- [ ] **Step 2: Verify**

```bash
npm install --silent && npm run build
```

Expected: install + build clean.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 0.2.0 for Phase 2 release"
```

---

## Task 16: Manual end-to-end verification

User-driven. Cannot be automated.

**Files:** none changed.

- [ ] **Step 1: Run the full unit test suite**

```bash
npm test
```

Expected: ~85 tests pass. Breakdown:
- 66 from before P2 baseline
- − 4 (extracted in Task 7) + 6 (new repoResolution.test.ts) = +2
- + 2 from Task 1 (AdoConflictError tests)
- + 16 from Task 10 (writeService.test.ts; the `it.each` 5-vote-mapping case counts as 5 tests)
- = ~84-86 expected; the exact count may vary by ±2 depending on `it.each` counting

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 3: Update local Claude Code MCP config to point at this worktree's dist**

Edit `~/.claude.json`, find the `azure-devops` entry under `mcpServers`, change the path to:

`/Users/vasekzdvihal/source/GitHub/azure-mcp/.worktrees/phase-2-pr-review-writes/dist/index.js`

Reload Claude Code (or `/mcp` reconnect).

- [ ] **Step 4: Exercise the read tools (regression check)**

From a Claude session inside an ADO checkout, ask "use azure-devops to whoami" and "list pull requests". Both should still work — write tools didn't break reads.

- [ ] **Step 5: Exercise each new write tool against a test PR**

Pick a non-critical PR you control (a personal one, or create a throwaway). For each tool, ask Claude something like:

- `add_pull_request_comment`: "post a general comment 'testing MCP' on PR <id>"
- `add_pull_request_comment` (line-anchored): "post 'nit: missing semicolon' on PR <id>, file <path>, line <n>"
- `reply_to_pull_request_thread`: "reply to thread <id> with 'agreed, fixed in next iteration'"
- `update_pull_request_thread_status`: "mark thread <id> as fixed"
- `vote_on_pull_request`: "vote 'wait' on PR <id>" (then later "reset my vote on PR <id>")
- `update_pull_request`: "update PR <id> description to ..."
- `set_pull_request_draft_state`: "mark PR <id> as draft" (then "publish PR <id>")
- `add_pull_request_reviewers`: "add reviewer <identity-id> to PR <id>"
- `remove_pull_request_reviewer`: "remove reviewer <identity-id> from PR <id>"

For each: confirm the action took effect in the ADO web UI. Note anything that felt off (response shape, error messages, tool descriptions misleading the LLM).

- [ ] **Step 6: Verify read-only mode hides write tools**

Edit `~/.claude.json` to add `"env": { "AZURE_DEVOPS_READ_ONLY": "true" }` to the `azure-devops` entry. Reload. Ask Claude to "list available azure-devops tools". The 8 write tools should NOT appear. Read tools still do. Remove the env entry to flip back.

- [ ] **Step 7: Verify the friendly PAT-scope error path** (optional)

Regenerate your PAT in ADO with read-only scopes. Re-run `npm run setup`. Ask Claude to "post a comment on PR <id>". The error returned to Claude should include the `AdoAuthError` message naming the missing write scopes. Restore your full-scope PAT when done.

- [ ] **Step 8: Capture checkpoint feedback**

Anything that felt off in the manual exercise — tool naming, response shape, error messages, confirmation flow with Claude, missing fields, awkward args — capture it. Fold into the spec before publishing v0.2.0 to npm or before Phase 2.x (PR lifecycle).

- [ ] **Step 9: Decide path forward**

When you're satisfied:

- `superpowers:finishing-a-development-branch` to merge Phase 2 into main (same flow as P0 / P1).
- Optionally bump roadmap: P2 ✅ Done, deferred lifecycle items remain 🟡 Planned.
- Decide whether to start Phase 1.6 (publish-readiness + npm publish) next so colleagues can install via npx.
