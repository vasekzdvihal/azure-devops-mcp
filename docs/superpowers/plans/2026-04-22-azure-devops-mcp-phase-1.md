# Azure DevOps MCP — Phase 1 (Read-Only PR MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Phase 0 walking skeleton into a usable read-only PR review server: enumerate projects/repos, list and inspect PRs, fetch per-file unified diffs on demand, read comment threads, and list iterations. Auto-detect the current repo from `.git/config` so tools work without explicit project/repo args. Add read-only-mode env var plumbing as a no-op so Phase 2 has a clean gate for write tools.

**Architecture:** Extend the `AdoClient` seam with project/repo/PR/iteration/diff methods. Add `git/` infra for parsing ADO remote URLs and resolving the current repo from cwd. Add three new domain folders (`projects`, `repositories`, `pullRequests`). The PR domain owns its own diff shaper (truncation/binary-file handling) and a small `pullRequests/schemas.ts` for zod tool inputs. `mcp/registerTools.ts` accepts a `readOnly` flag and threads it through (no-op in Phase 1; gates writes in Phase 2). All ADO API calls stay behind the `AdoClient` interface; domain services depend on the interface only and are unit-tested with `FakeAdoClient`.

**Tech Stack:** Same as Phase 0 plus `diff` (BSD-3, v9.x) for client-side unified diff generation.

**Spec reference:** `docs/superpowers/specs/2026-04-21-azure-devops-mcp-design.md` — Phase 1 section, plus the §4 read-only-mode and tool-naming decisions added at the Phase 0 checkpoint.

**Out of Phase 1 (deferred):** Contract tests against recorded HTTP fixtures (deferred to Phase 1.5 — adds half a day of recording infra without affecting the user-facing surface). Iteration-specific diffs (always uses the PR's current `lastMergeSource`/`lastMergeTarget` SHAs). Anything write-related (Phase 2).

---

## File map for Phase 1

New and modified files relative to the merged Phase 0 baseline. Each has one clear responsibility.

```
azure-mcp/
├── package.json                          # MODIFY: add "diff" + "@types/diff" deps
│
├── src/
│   ├── index.ts                          # MODIFY: read AZURE_DEVOPS_READ_ONLY, pass to registerAllTools
│   │
│   ├── config/
│   │   └── readOnly.ts                   # NEW: parses env var → boolean
│   │
│   ├── git/                              # NEW directory
│   │   ├── parseRemoteUrl.ts             # NEW: ADO Server vs Services URL parser (pure)
│   │   └── detectRepo.ts                 # NEW: read cwd .git/config remote.origin.url
│   │
│   ├── ado/
│   │   ├── client.ts                     # MODIFY: extend AdoClient with project/repo/PR methods
│   │   ├── sdkClient.ts                  # MODIFY: implement extended methods via SDK
│   │   └── types.ts                      # MODIFY: re-export TeamProjectReference, GitRepository,
│   │                                     #         GitPullRequest, GitPullRequestIteration,
│   │                                     #         GitPullRequestCommentThread, GitItem,
│   │                                     #         PullRequestStatus, PullRequestChange
│   │
│   ├── domains/
│   │   ├── projects/                     # NEW
│   │   │   ├── service.ts                # ProjectsService.list()
│   │   │   └── tools.ts                  # buildProjectsTools()
│   │   │
│   │   ├── repositories/                 # NEW
│   │   │   ├── service.ts                # RepositoriesService.list({ project })
│   │   │   └── tools.ts                  # buildRepositoriesTools()
│   │   │
│   │   └── pullRequests/                 # NEW (largest domain)
│   │       ├── schemas.ts                # zod input schemas for the 5 PR tools
│   │       ├── diffShaper.ts             # pure: build unified diff with truncation
│   │       ├── service.ts                # PullRequestsService (list, get, list_changes,
│   │       │                             #   diff, list_comments, get_iterations + repo resolution)
│   │       └── tools.ts                  # buildPullRequestTools()
│   │
│   └── mcp/
│       └── registerTools.ts              # MODIFY: accept readOnly, register all new domain tools
│
└── test/
    ├── fakes/
    │   └── FakeAdoClient.ts              # MODIFY: extend with new method stubs
    │
    └── unit/
        ├── git/                          # NEW
        │   └── parseRemoteUrl.test.ts    # exhaustive URL format coverage
        │
        └── domains/
            ├── projects/
            │   └── service.test.ts       # NEW
            ├── repositories/
            │   └── service.test.ts       # NEW
            └── pullRequests/
                ├── service.test.ts       # NEW (incl. repo-resolution branch coverage)
                └── diffShaper.test.ts    # NEW (truncation, binary, add/delete cases)
```

**Domain folders unchanged:** `domains/identity/` stays as-is.
**Infra unchanged:** `config/{paths,configFile,keyring,schema}.ts`, `ado/{tlsAgent,errors}.ts`, `mcp/errorBoundary.ts`.

---

## Conventions (carry-over from Phase 0)

- **Commit after every task.** One task = one commit.
- **TDD where it has logic.** Tasks with real logic (parseRemoteUrl, diffShaper, all domain services) are TDD. Pure pass-through code (re-exports, interface signatures, tool definitions) is implemented and verified via typecheck/build.
- **All code is ESM.** Relative imports use `.js` extension even for `.ts` source files.
- **No `any`.** Strict TS. Use `unknown` and narrow.
- **Run from `/Users/vasekzdvihal/source/GitHub/azure-mcp/.worktrees/phase-1-read-only-pr-mvp`** for all `npm`, `git`, `node` commands. Each task assumes you're in this directory.

---

## Task 1: Add `diff` dependency

The `diff` library (npm package `diff`, v8.x as of 2026) generates unified diffs from two strings. We use `createPatch(filename, oldStr, newStr, ...)` which produces `git diff`-style output.

**Files:**
- Modify: `package.json` (add deps)

- [ ] **Step 1: Install dependencies**

```bash
npm install diff@^9 && npm install --save-dev @types/diff@^9
```

- [ ] **Step 2: Verify install**

```bash
npm test
```

Expected: 26/26 still pass (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add diff library for unified diff generation"
```

---

## Task 2: `config/readOnly.ts` — env var parsing

Tiny module to centralize the env var lookup. No test — single ternary. Used by `index.ts` and threaded into `registerAllTools` (Phase 1: as a no-op since all tools are reads).

**Files:**
- Create: `src/config/readOnly.ts`

- [ ] **Step 1: Implement**

```ts
// src/config/readOnly.ts
/**
 * Returns true when the operator has restricted the server to read-only tools
 * (`AZURE_DEVOPS_READ_ONLY=true` in the MCP server config's env block).
 *
 * Phase 1 ships only read tools, so this is currently a no-op signal. It exists
 * so that Phase 2 (write tools) can gate registration without changing the
 * registerAllTools signature.
 *
 * Truthy values: "true", "1", "yes", "on" (case-insensitive).
 */
export function isReadOnly(): boolean {
  const v = (process.env["AZURE_DEVOPS_READ_ONLY"] ?? "").toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/config/readOnly.ts
git commit -m "feat(config): add AZURE_DEVOPS_READ_ONLY env var parsing"
```

---

## Task 3: `git/parseRemoteUrl.ts` — TDD (pure URL parser)

Parses the URL from `.git/config`'s `remote.origin.url` into `{ project, repo }`. Must handle all common ADO URL formats:

- ADO Services HTTPS: `https://dev.azure.com/{org}/{project}/_git/{repo}`
- ADO Services HTTPS w/ `_git` segment: `https://dev.azure.com/myorg/MyProject/_git/MyRepo`
- ADO Services legacy: `https://{org}.visualstudio.com/{project}/_git/{repo}`
- ADO Services SSH: `git@ssh.dev.azure.com:v3/{org}/{project}/{repo}`
- ADO Services SSH legacy: `{org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}`
- ADO Server HTTPS: `https://{host}/tfs/{collection}/{project}/_git/{repo}` or `https://{host}/{collection}/{project}/_git/{repo}`
- ADO Server SSH: `ssh://{host}:22/tfs/{collection}/{project}/_git/{repo}`

Anything that doesn't match returns `null` — `detectRepo.ts` will then know cwd isn't an ADO repo.

**Files:**
- Create: `test/unit/git/parseRemoteUrl.test.ts`
- Create: `src/git/parseRemoteUrl.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/git/parseRemoteUrl.test.ts
import { describe, it, expect } from "vitest";
import { parseRemoteUrl } from "../../../src/git/parseRemoteUrl.js";

describe("parseRemoteUrl", () => {
  // ADO Services HTTPS
  it("parses dev.azure.com HTTPS URL", () => {
    expect(parseRemoteUrl("https://dev.azure.com/myorg/MyProject/_git/MyRepo")).toEqual({
      project: "MyProject",
      repo: "MyRepo",
    });
  });

  it("URL-decodes project and repo names", () => {
    expect(parseRemoteUrl("https://dev.azure.com/myorg/My%20Project/_git/My%20Repo")).toEqual({
      project: "My Project",
      repo: "My Repo",
    });
  });

  it("strips trailing .git", () => {
    expect(parseRemoteUrl("https://dev.azure.com/myorg/MyProject/_git/MyRepo.git")).toEqual({
      project: "MyProject",
      repo: "MyRepo",
    });
  });

  // ADO Services legacy visualstudio.com
  it("parses *.visualstudio.com HTTPS URL", () => {
    expect(parseRemoteUrl("https://myorg.visualstudio.com/MyProject/_git/MyRepo")).toEqual({
      project: "MyProject",
      repo: "MyRepo",
    });
  });

  // ADO Services SSH
  it("parses ssh.dev.azure.com SSH URL", () => {
    expect(parseRemoteUrl("git@ssh.dev.azure.com:v3/myorg/MyProject/MyRepo")).toEqual({
      project: "MyProject",
      repo: "MyRepo",
    });
  });

  it("parses vs-ssh.visualstudio.com SSH URL", () => {
    expect(parseRemoteUrl("myorg@vs-ssh.visualstudio.com:v3/myorg/MyProject/MyRepo")).toEqual({
      project: "MyProject",
      repo: "MyRepo",
    });
  });

  // ADO Server HTTPS — with /tfs/ collection prefix
  it("parses on-prem HTTPS with /tfs/ collection", () => {
    expect(
      parseRemoteUrl("https://tfs.company.com/tfs/DefaultCollection/MyProject/_git/MyRepo"),
    ).toEqual({ project: "MyProject", repo: "MyRepo" });
  });

  // ADO Server HTTPS — without /tfs/ prefix
  it("parses on-prem HTTPS without /tfs/ prefix", () => {
    expect(
      parseRemoteUrl("https://ado.company.com/DefaultCollection/MyProject/_git/MyRepo"),
    ).toEqual({ project: "MyProject", repo: "MyRepo" });
  });

  // ADO Server SSH
  it("parses on-prem SSH URL", () => {
    expect(
      parseRemoteUrl("ssh://tfs.company.com:22/tfs/DefaultCollection/MyProject/_git/MyRepo"),
    ).toEqual({ project: "MyProject", repo: "MyRepo" });
  });

  // Non-ADO URLs return null
  it("returns null for github.com URL", () => {
    expect(parseRemoteUrl("https://github.com/owner/repo.git")).toBeNull();
  });

  it("returns null for gitlab URL", () => {
    expect(parseRemoteUrl("git@gitlab.com:owner/repo.git")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseRemoteUrl("")).toBeNull();
  });

  it("returns null for malformed URL", () => {
    expect(parseRemoteUrl("not-a-url")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/git/parseRemoteUrl.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/git/parseRemoteUrl.ts
export interface ParsedRemote {
  project: string;
  repo: string;
}

/**
 * Parses an Azure DevOps git remote URL into project and repo names.
 * Returns null if the URL doesn't match any known ADO format.
 *
 * Supports HTTPS and SSH variants for both ADO Services (cloud) and
 * ADO Server (on-prem with or without /tfs/ collection prefix).
 */
export function parseRemoteUrl(url: string): ParsedRemote | null {
  if (!url) return null;

  // Normalize: strip trailing .git
  const normalized = url.replace(/\.git$/, "");

  return (
    parseAdoServicesHttps(normalized) ||
    parseLegacyVisualStudioHttps(normalized) ||
    parseAdoSshDevAzure(normalized) ||
    parseLegacyVsSsh(normalized) ||
    parseAdoServerHttpsOrSsh(normalized)
  );
}

// https://dev.azure.com/{org}/{project}/_git/{repo}
function parseAdoServicesHttps(url: string): ParsedRemote | null {
  const m = url.match(/^https?:\/\/dev\.azure\.com\/[^/]+\/([^/]+)\/_git\/([^/]+)$/);
  return m ? { project: decode(m[1]!), repo: decode(m[2]!) } : null;
}

// https://{org}.visualstudio.com/{project}/_git/{repo}
function parseLegacyVisualStudioHttps(url: string): ParsedRemote | null {
  const m = url.match(/^https?:\/\/[^/]+\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)$/);
  return m ? { project: decode(m[1]!), repo: decode(m[2]!) } : null;
}

// git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
function parseAdoSshDevAzure(url: string): ParsedRemote | null {
  const m = url.match(/^git@ssh\.dev\.azure\.com:v3\/[^/]+\/([^/]+)\/([^/]+)$/);
  return m ? { project: decode(m[1]!), repo: decode(m[2]!) } : null;
}

// {org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}
function parseLegacyVsSsh(url: string): ParsedRemote | null {
  const m = url.match(/^[^@]+@vs-ssh\.visualstudio\.com:v3\/[^/]+\/([^/]+)\/([^/]+)$/);
  return m ? { project: decode(m[1]!), repo: decode(m[2]!) } : null;
}

// On-prem ADO Server: https or ssh, with or without /tfs/ collection prefix.
// The pattern is: <scheme>{host}[:port][/tfs]/{collection}/{project}/_git/{repo}
function parseAdoServerHttpsOrSsh(url: string): ParsedRemote | null {
  // Matches the trailing /{project}/_git/{repo} after at least one path segment for the collection.
  const m = url.match(/(?:https?:\/\/|ssh:\/\/)[^/]+\/[^/]+(?:\/[^/]+)*?\/([^/]+)\/_git\/([^/]+)$/);
  return m ? { project: decode(m[1]!), repo: decode(m[2]!) } : null;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/git/parseRemoteUrl.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/git/parseRemoteUrl.ts test/unit/git/parseRemoteUrl.test.ts
git commit -m "feat(git): add ADO remote URL parser (Server + Services, HTTPS + SSH)"
```

---

## Task 4: `git/detectRepo.ts` — read cwd `.git/config`

Wraps `git config --get remote.origin.url` and pipes its output through `parseRemoteUrl`. Returns `null` if cwd isn't a git repo, has no `origin` remote, or the remote isn't ADO. No test — small wrapper around child_process; tested implicitly by manual end-to-end at Task 20.

**Files:**
- Create: `src/git/detectRepo.ts`

- [ ] **Step 1: Implement**

```ts
// src/git/detectRepo.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseRemoteUrl, type ParsedRemote } from "./parseRemoteUrl.js";

const execFileAsync = promisify(execFile);

/**
 * Reads the current working directory's git remote.origin.url and parses
 * it as an ADO URL. Returns null when:
 *  - cwd is not inside a git repo
 *  - the repo has no `origin` remote
 *  - the origin URL is not an ADO URL (e.g. github.com)
 *  - git is not installed
 *
 * Used by the pull-request domain to auto-resolve `{project, repo}` so
 * tools "just work" when called from a checkout.
 */
export async function detectRepo(cwd: string = process.cwd()): Promise<ParsedRemote | null> {
  let url: string;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd, encoding: "utf8" },
    );
    url = stdout.trim();
  } catch {
    return null;
  }
  return parseRemoteUrl(url);
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/git/detectRepo.ts
git commit -m "feat(git): detect ADO repo from cwd .git/config"
```

---

## Task 5: Extend `ado/types.ts` re-exports

Add re-exports for the new SDK types we'll expose at the AdoClient seam.

**Files:**
- Modify: `src/ado/types.ts`

- [ ] **Step 1: Implement (full overwrite)**

```ts
// src/ado/types.ts
// Re-exports of azure-devops-node-api types we expose at the AdoClient seam.
// Keeping a single import surface here means downstream files don't import from
// "azure-devops-node-api/interfaces/...".
export type { Identity } from "azure-devops-node-api/interfaces/IdentitiesInterfaces.js";
export type { ConnectionData } from "azure-devops-node-api/interfaces/LocationsInterfaces.js";
export type { TeamProjectReference } from "azure-devops-node-api/interfaces/CoreInterfaces.js";
export type {
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitItem,
  GitPullRequestChange,
  PullRequestStatus,
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
git commit -m "feat(ado): re-export project/repo/PR SDK types"
```

---

## Task 6: Extend `AdoClient` interface

Add method signatures for everything Phase 1 needs. The interface is the seam — only signatures, no implementations.

**Files:**
- Modify: `src/ado/client.ts` (full overwrite)

- [ ] **Step 1: Implement**

```ts
// src/ado/client.ts
import type {
  Identity,
  TeamProjectReference,
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitPullRequestChange,
  GitItem,
  PullRequestStatus,
} from "./types.js";

/**
 * The AdoClient is the seam between our domain services and Azure DevOps.
 * Implementations live in `sdkClient.ts` (production) and `test/fakes/FakeAdoClient.ts` (tests).
 * New methods are added here when a domain needs them.
 */
export interface AdoClient {
  // identity
  whoami(): Promise<Identity>;

  // projects & repos
  listProjects(): Promise<TeamProjectReference[]>;
  listRepositories(args: { project: string }): Promise<GitRepository[]>;

  // pull requests — discovery
  listPullRequests(args: {
    project: string;
    repository: string;
    status?: PullRequestStatus;
    creatorId?: string;
    reviewerId?: string;
    targetRefName?: string;
    top?: number;
    skip?: number;
  }): Promise<GitPullRequest[]>;

  getPullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequest>;

  // pull requests — changes & diff
  listPullRequestChanges(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequestChange[]>;

  /**
   * Fetches a file's content (as UTF-8 string) at a given commit. Used by the
   * PR diff service to fetch base + target content for a single file before
   * synthesizing a unified diff client-side.
   *
   * Returns null when the path doesn't exist at that commit (e.g. file added
   * in this PR — the base side returns null).
   */
  getFileContent(args: {
    project: string;
    repository: string;
    path: string;
    commitSha: string;
  }): Promise<string | null>;

  // pull requests — comments & iterations
  listPullRequestThreads(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequestCommentThread[]>;

  listPullRequestIterations(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequestIteration[]>;
}
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
```

Expected: this WILL fail because `SdkAdoClient` no longer satisfies the interface (missing methods). That's expected — we'll fix it in Task 7. For this commit, just verify the interface file itself parses by checking the failure is only about missing implementations:

```bash
npm run typecheck 2>&1 | grep -E "client.ts|sdkClient.ts"
```

Expected: errors should be limited to `sdkClient.ts` complaining the new methods aren't implemented. If `client.ts` itself shows errors, fix them.

- [ ] **Step 3: Commit**

```bash
git add src/ado/client.ts
git commit -m "feat(ado): extend AdoClient interface for projects, repos, PRs"
```

(Repo will not typecheck cleanly until Task 7. We're in the middle of a multi-step refactor; the next tasks bring it back to green.)

---

## Task 7: Extend `SdkAdoClient` with new method implementations

Big task — implements seven new methods. No unit test (live integration covers it; manual smoke at Task 20). Follows the existing pattern: try the SDK call, catch and map errors via `mapSdkError`.

**Files:**
- Modify: `src/ado/sdkClient.ts` (add to existing file)

- [ ] **Step 1: Replace the file**

```ts
// src/ado/sdkClient.ts
import * as azdev from "azure-devops-node-api";
import https from "node:https";
import type { AdoClient } from "./client.js";
import type {
  Identity,
  TeamProjectReference,
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitPullRequestChange,
  PullRequestStatus,
} from "./types.js";
import { mapSdkError, AdoNotFoundError, AdoUnknownError } from "./errors.js";
import { buildHttpsAgent } from "./tlsAgent.js";

export interface SdkAdoClientOptions {
  baseUrl: string;
  pat: string;
  caBundlePath?: string;
}

export class SdkAdoClient implements AdoClient {
  private readonly api: azdev.WebApi;

  constructor(opts: SdkAdoClientOptions) {
    const handler = azdev.getPersonalAccessTokenHandler(opts.pat);

    // azure-devops-node-api uses Node's http(s) module under the hood. There is
    // no per-request hook to inject an extra CA, so when one is configured we
    // swap Node's global https agent. Both the setup wizard and the server only
    // talk to one ADO instance per process, so this is safe.
    const agent = buildHttpsAgent(opts.caBundlePath);
    if (agent) https.globalAgent = agent;

    // Default socket timeout in typed-rest-client is 3 minutes — way too long
    // for a CLI tool when a firewall silently drops packets. 15s is plenty for
    // any ADO API we call and surfaces a useful error fast.
    this.api = new azdev.WebApi(opts.baseUrl, handler, { socketTimeout: 15_000 });
  }

  async whoami(): Promise<Identity> {
    try {
      const conn = await this.api.connect();
      const user = conn.authenticatedUser;
      if (!user) throw new AdoUnknownError("connect() returned no authenticatedUser");
      return user;
    } catch (err) {
      if (err instanceof AdoUnknownError) throw err;
      throw mapSdkError(err);
    }
  }

  async listProjects(): Promise<TeamProjectReference[]> {
    try {
      const core = await this.api.getCoreApi();
      const projects = await core.getProjects();
      return projects;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async listRepositories(args: { project: string }): Promise<GitRepository[]> {
    try {
      const git = await this.api.getGitApi();
      const repos = await git.getRepositories(args.project);
      return repos;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async listPullRequests(args: {
    project: string;
    repository: string;
    status?: PullRequestStatus;
    creatorId?: string;
    reviewerId?: string;
    targetRefName?: string;
    top?: number;
    skip?: number;
  }): Promise<GitPullRequest[]> {
    try {
      const git = await this.api.getGitApi();
      const prs = await git.getPullRequests(
        args.repository,
        {
          status: args.status,
          creatorId: args.creatorId,
          reviewerId: args.reviewerId,
          targetRefName: args.targetRefName,
        },
        args.project,
        undefined, // maxCommentLength
        args.skip,
        args.top,
      );
      return prs;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async getPullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequest> {
    try {
      const git = await this.api.getGitApi();
      // getPullRequest (as opposed to getPullRequestById) takes the repo too,
      // which is useful for tenancy in on-prem.
      const pr = await git.getPullRequest(args.repository, args.pullRequestId, args.project);
      if (!pr) throw new AdoNotFoundError(`PR ${args.pullRequestId} not found`);
      return pr;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async listPullRequestChanges(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequestChange[]> {
    try {
      const git = await this.api.getGitApi();
      // The "changes" API is keyed by iteration. Use the latest iteration so the
      // result represents the PR's current state.
      const iterations = await git.getPullRequestIterations(
        args.repository,
        args.pullRequestId,
        args.project,
      );
      if (iterations.length === 0) {
        return [];
      }
      const latest = iterations.reduce((a, b) => ((a.id ?? 0) > (b.id ?? 0) ? a : b));
      const changes = await git.getPullRequestIterationChanges(
        args.repository,
        args.pullRequestId,
        latest.id ?? 1,
        args.project,
      );
      return changes.changeEntries ?? [];
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async getFileContent(args: {
    project: string;
    repository: string;
    path: string;
    commitSha: string;
  }): Promise<string | null> {
    try {
      const git = await this.api.getGitApi();
      const item = await git.getItem(
        args.repository,
        args.path,
        args.project,
        undefined, // scopePath
        undefined, // recursionLevel
        undefined, // includeContentMetadata
        undefined, // latestProcessedChange
        undefined, // download
        { version: args.commitSha, versionType: 2 /* commit */ },
        true, // includeContent
      );
      return item.content ?? null;
    } catch (err) {
      const mapped = mapSdkError(err);
      // 404 is a normal "file did not exist at this commit" signal (e.g. for the
      // base side of an added file). Translate to null so the diff service can
      // produce an "added" diff rather than throwing.
      if (mapped instanceof AdoNotFoundError) return null;
      throw mapped;
    }
  }

  async listPullRequestThreads(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequestCommentThread[]> {
    try {
      const git = await this.api.getGitApi();
      const threads = await git.getThreads(args.repository, args.pullRequestId, args.project);
      return threads;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async listPullRequestIterations(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequestIteration[]> {
    try {
      const git = await this.api.getGitApi();
      const iterations = await git.getPullRequestIterations(
        args.repository,
        args.pullRequestId,
        args.project,
      );
      return iterations;
    } catch (err) {
      throw mapSdkError(err);
    }
  }
}
```

- [ ] **Step 2: Verify it compiles and builds**

```bash
npm run typecheck && npm run build
```

Expected: both exit 0. The repo is now back to "everything compiles" after the multi-step refactor across Tasks 5-7.

- [ ] **Step 3: Run existing tests to confirm no regressions**

```bash
npm test
```

Expected: 26/26 pass.

- [ ] **Step 4: Commit**

```bash
git add src/ado/sdkClient.ts
git commit -m "feat(ado): implement project/repo/PR/diff methods on SdkAdoClient"
```

---

## Task 8: Extend `FakeAdoClient` with new method stubs

Tests in subsequent tasks need the fake to implement the full `AdoClient` interface. Each method is a simple "return what the test configured, or throw if nothing configured".

**Files:**
- Modify: `test/fakes/FakeAdoClient.ts` (full overwrite)

- [ ] **Step 1: Implement**

```ts
// test/fakes/FakeAdoClient.ts
import type { AdoClient } from "../../src/ado/client.js";
import type {
  Identity,
  TeamProjectReference,
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitPullRequestChange,
  PullRequestStatus,
} from "../../src/ado/types.js";

interface PrKey {
  project: string;
  repository: string;
  pullRequestId: number;
}

function prKey(k: PrKey): string {
  return `${k.project}${k.repository}${k.pullRequestId}`;
}

export class FakeAdoClient implements AdoClient {
  // identity
  private whoamiResult?: Identity;
  private whoamiError?: Error;
  // projects/repos
  private projects?: TeamProjectReference[];
  private repos = new Map<string, GitRepository[]>(); // project → repos
  // PRs
  private prLists = new Map<string, GitPullRequest[]>(); // project|repo → PRs
  private prDetails = new Map<string, GitPullRequest>();
  private prChanges = new Map<string, GitPullRequestChange[]>();
  private prThreads = new Map<string, GitPullRequestCommentThread[]>();
  private prIterations = new Map<string, GitPullRequestIteration[]>();
  // file content: project|repo|path|sha → content
  private fileContents = new Map<string, string | null>();
  // generic error injection
  private errors = new Map<string, Error>();

  // ---- setup helpers (test-only, not part of AdoClient) ----
  setWhoamiResult(identity: Identity): void {
    this.whoamiResult = identity;
    this.whoamiError = undefined;
  }
  setWhoamiError(err: Error): void {
    this.whoamiError = err;
    this.whoamiResult = undefined;
  }
  setProjects(projects: TeamProjectReference[]): void {
    this.projects = projects;
  }
  setRepositories(project: string, repos: GitRepository[]): void {
    this.repos.set(project, repos);
  }
  setPullRequests(project: string, repository: string, prs: GitPullRequest[]): void {
    this.prLists.set(`${project}${repository}`, prs);
  }
  setPullRequest(args: PrKey & { pr: GitPullRequest }): void {
    this.prDetails.set(prKey(args), args.pr);
  }
  setPullRequestChanges(args: PrKey & { changes: GitPullRequestChange[] }): void {
    this.prChanges.set(prKey(args), args.changes);
  }
  setPullRequestThreads(args: PrKey & { threads: GitPullRequestCommentThread[] }): void {
    this.prThreads.set(prKey(args), args.threads);
  }
  setPullRequestIterations(args: PrKey & { iterations: GitPullRequestIteration[] }): void {
    this.prIterations.set(prKey(args), args.iterations);
  }
  setFileContent(args: {
    project: string;
    repository: string;
    path: string;
    commitSha: string;
    content: string | null;
  }): void {
    this.fileContents.set(
      `${args.project}${args.repository}${args.path}${args.commitSha}`,
      args.content,
    );
  }
  injectError(method: string, err: Error): void {
    this.errors.set(method, err);
  }

  // ---- AdoClient impl ----
  private throwIfInjected(method: string): void {
    const e = this.errors.get(method);
    if (e) throw e;
  }

  async whoami(): Promise<Identity> {
    this.throwIfInjected("whoami");
    if (this.whoamiError) throw this.whoamiError;
    if (this.whoamiResult) return this.whoamiResult;
    throw new Error("FakeAdoClient.whoami: no result configured");
  }

  async listProjects(): Promise<TeamProjectReference[]> {
    this.throwIfInjected("listProjects");
    return this.projects ?? [];
  }

  async listRepositories(args: { project: string }): Promise<GitRepository[]> {
    this.throwIfInjected("listRepositories");
    return this.repos.get(args.project) ?? [];
  }

  async listPullRequests(args: {
    project: string;
    repository: string;
    status?: PullRequestStatus;
  }): Promise<GitPullRequest[]> {
    this.throwIfInjected("listPullRequests");
    return this.prLists.get(`${args.project}${args.repository}`) ?? [];
  }

  async getPullRequest(args: PrKey): Promise<GitPullRequest> {
    this.throwIfInjected("getPullRequest");
    const pr = this.prDetails.get(prKey(args));
    if (!pr) throw new Error(`FakeAdoClient.getPullRequest: no PR configured for ${prKey(args)}`);
    return pr;
  }

  async listPullRequestChanges(args: PrKey): Promise<GitPullRequestChange[]> {
    this.throwIfInjected("listPullRequestChanges");
    return this.prChanges.get(prKey(args)) ?? [];
  }

  async getFileContent(args: {
    project: string;
    repository: string;
    path: string;
    commitSha: string;
  }): Promise<string | null> {
    this.throwIfInjected("getFileContent");
    const k = `${args.project}${args.repository}${args.path}${args.commitSha}`;
    return this.fileContents.has(k) ? (this.fileContents.get(k) ?? null) : null;
  }

  async listPullRequestThreads(args: PrKey): Promise<GitPullRequestCommentThread[]> {
    this.throwIfInjected("listPullRequestThreads");
    return this.prThreads.get(prKey(args)) ?? [];
  }

  async listPullRequestIterations(args: PrKey): Promise<GitPullRequestIteration[]> {
    this.throwIfInjected("listPullRequestIterations");
    return this.prIterations.get(prKey(args)) ?? [];
  }
}
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck && npm test
```

Expected: typecheck exit 0; existing 26 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add test/fakes/FakeAdoClient.ts
git commit -m "test: extend FakeAdoClient for projects/repos/PRs/diff methods"
```

---

## Task 9: `domains/projects/service.ts` — TDD

Trivial. Just calls the client. Tests use `FakeAdoClient`.

**Files:**
- Create: `test/unit/domains/projects/service.test.ts`
- Create: `src/domains/projects/service.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/domains/projects/service.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/projects/service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/domains/projects/service.ts
import type { AdoClient } from "../../ado/client.js";
import type { TeamProjectReference } from "../../ado/types.js";

export interface ProjectSummary {
  id: string;
  name: string;
  url?: string;
}

export class ProjectsService {
  constructor(private readonly client: AdoClient) {}

  async list(): Promise<ProjectSummary[]> {
    const projects = await this.client.listProjects();
    return projects.map(shape);
  }
}

function shape(p: TeamProjectReference): ProjectSummary {
  return {
    id: p.id ?? "",
    name: p.name ?? "",
    url: p.url,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/domains/projects/service.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domains/projects/service.ts test/unit/domains/projects/service.test.ts
git commit -m "feat(projects): add ProjectsService.list"
```

---

## Task 10: `domains/projects/tools.ts`

**Files:**
- Create: `src/domains/projects/tools.ts`

- [ ] **Step 1: Implement**

```ts
// src/domains/projects/tools.ts
import type { ProjectsService } from "./service.js";
import type { ToolDefinition } from "../identity/tools.js";

export function buildProjectsTools(svc: ProjectsService): ToolDefinition[] {
  return [
    {
      name: "list_projects",
      config: {
        title: "List Azure DevOps projects",
        description:
          "Lists all projects in the configured ADO collection (on-prem) or organization (cloud). " +
          "Use this when you need the project name to pass to other tools, or to discover what's available.",
        inputSchema: {},
      },
      handler: async () => svc.list(),
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
git add src/domains/projects/tools.ts
git commit -m "feat(projects): add list_projects MCP tool"
```

---

## Task 11: `domains/repositories/service.ts` — TDD

**Files:**
- Create: `test/unit/domains/repositories/service.test.ts`
- Create: `src/domains/repositories/service.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/domains/repositories/service.test.ts
import { describe, it, expect } from "vitest";
import { RepositoriesService } from "../../../../src/domains/repositories/service.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type { GitRepository } from "../../../../src/ado/types.js";

describe("RepositoriesService.list", () => {
  it("returns shaped repos from the client for the given project", async () => {
    const fake = new FakeAdoClient();
    const repos: GitRepository[] = [
      { id: "r1", name: "RepoOne", defaultBranch: "refs/heads/main", webUrl: "https://x/r1" },
      { id: "r2", name: "RepoTwo", defaultBranch: "refs/heads/master", webUrl: "https://x/r2" },
    ];
    fake.setRepositories("MyProject", repos);

    const svc = new RepositoriesService(fake);
    const result = await svc.list({ project: "MyProject" });
    expect(result).toEqual([
      { id: "r1", name: "RepoOne", defaultBranch: "main", webUrl: "https://x/r1" },
      { id: "r2", name: "RepoTwo", defaultBranch: "master", webUrl: "https://x/r2" },
    ]);
  });

  it("returns empty array when project has no repos configured", async () => {
    const fake = new FakeAdoClient();
    const svc = new RepositoriesService(fake);
    expect(await svc.list({ project: "Empty" })).toEqual([]);
  });

  it("strips the refs/heads/ prefix from defaultBranch", async () => {
    const fake = new FakeAdoClient();
    fake.setRepositories("P", [
      { id: "r", name: "Repo", defaultBranch: "refs/heads/develop" },
    ]);
    const svc = new RepositoriesService(fake);
    const result = await svc.list({ project: "P" });
    expect(result[0]?.defaultBranch).toBe("develop");
  });

  it("handles missing defaultBranch gracefully", async () => {
    const fake = new FakeAdoClient();
    fake.setRepositories("P", [{ id: "r", name: "Repo" }]);
    const svc = new RepositoriesService(fake);
    const result = await svc.list({ project: "P" });
    expect(result[0]?.defaultBranch).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/repositories/service.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/domains/repositories/service.ts
import type { AdoClient } from "../../ado/client.js";
import type { GitRepository } from "../../ado/types.js";

export interface RepoSummary {
  id: string;
  name: string;
  defaultBranch?: string; // refs/heads/ prefix stripped for readability
  webUrl?: string;
}

export class RepositoriesService {
  constructor(private readonly client: AdoClient) {}

  async list(args: { project: string }): Promise<RepoSummary[]> {
    const repos = await this.client.listRepositories(args);
    return repos.map(shape);
  }
}

function shape(r: GitRepository): RepoSummary {
  const branch = r.defaultBranch?.replace(/^refs\/heads\//, "");
  return {
    id: r.id ?? "",
    name: r.name ?? "",
    defaultBranch: branch,
    webUrl: r.webUrl,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/domains/repositories/service.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domains/repositories/service.ts test/unit/domains/repositories/service.test.ts
git commit -m "feat(repositories): add RepositoriesService.list"
```

---

## Task 12: `domains/repositories/tools.ts`

**Files:**
- Create: `src/domains/repositories/tools.ts`

- [ ] **Step 1: Implement**

```ts
// src/domains/repositories/tools.ts
import { z } from "zod";
import type { RepositoriesService } from "./service.js";
import type { ToolDefinition } from "../identity/tools.js";

export function buildRepositoriesTools(svc: RepositoriesService): ToolDefinition[] {
  return [
    {
      name: "list_repositories",
      config: {
        title: "List git repositories in a project",
        description:
          "Lists all git repositories in the given Azure DevOps project. " +
          "Use this to discover repository names and ids needed by the pull-request tools.",
        inputSchema: {
          project: z.string().min(1).describe("The Azure DevOps project name."),
        },
      },
      handler: async (args) =>
        svc.list({ project: args["project"] as string }),
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
git add src/domains/repositories/tools.ts
git commit -m "feat(repositories): add list_repositories MCP tool"
```

---

## Task 13: `domains/pullRequests/schemas.ts` (zod input schemas)

Centralize the input schemas for the 5 PR tools so `tools.ts` and `service.ts` agree on shape. No tests — exercised through the service tests.

**Files:**
- Create: `src/domains/pullRequests/schemas.ts`

- [ ] **Step 1: Implement**

```ts
// src/domains/pullRequests/schemas.ts
import { z } from "zod";

// Common: project + repo can be omitted to trigger cwd auto-detection.
const repoCoords = {
  project: z.string().min(1).optional().describe(
    "ADO project name. If omitted, auto-detected from the current working directory's git remote.",
  ),
  repository: z.string().min(1).optional().describe(
    "ADO repository name. If omitted, auto-detected from the current working directory's git remote.",
  ),
};

export const ListPullRequestsInput = {
  ...repoCoords,
  status: z
    .enum(["active", "completed", "abandoned", "all"])
    .optional()
    .describe("Filter by PR status. Default: active."),
  creatorId: z.string().optional().describe("Filter to PRs authored by this identity id."),
  reviewerId: z.string().optional().describe("Filter to PRs where this identity is a reviewer."),
  targetRefName: z
    .string()
    .optional()
    .describe("Filter by target branch ref (e.g. 'refs/heads/main')."),
  top: z.number().int().positive().max(200).optional().describe("Max results (default 25)."),
  skip: z.number().int().nonnegative().optional().describe("Skip N results for pagination."),
};

export const PullRequestId = {
  ...repoCoords,
  pullRequestId: z.number().int().positive().describe("The pull-request id (an integer)."),
};

export const GetPullRequestDiffInput = {
  ...PullRequestId,
  path: z
    .string()
    .min(1)
    .describe("Repo-relative path of the file whose unified diff you want."),
  maxLines: z
    .number()
    .int()
    .positive()
    .max(5000)
    .optional()
    .describe("Truncate diff to this many lines (default 1000). A truncation marker is appended."),
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
git commit -m "feat(pullRequests): add zod input schemas for PR tools"
```

---

## Task 14: `domains/pullRequests/diffShaper.ts` — TDD

Pure function. Takes a file path, base content, and target content; returns a unified diff string with truncation. Handles edge cases: file added (no base), file deleted (no target), binary content (skip diff, return marker), identical content (return `(no changes)` marker).

**Files:**
- Create: `test/unit/domains/pullRequests/diffShaper.test.ts`
- Create: `src/domains/pullRequests/diffShaper.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/domains/pullRequests/diffShaper.test.ts
import { describe, it, expect } from "vitest";
import { shapeDiff } from "../../../../src/domains/pullRequests/diffShaper.js";

describe("shapeDiff", () => {
  it("produces a unified diff for a modified file", () => {
    const out = shapeDiff({
      path: "src/foo.ts",
      base: "line one\nline two\nline three\n",
      target: "line one\nline TWO\nline three\n",
    });
    expect(out).toMatch(/^Index: src\/foo\.ts/m);
    expect(out).toMatch(/-line two/);
    expect(out).toMatch(/\+line TWO/);
  });

  it("returns an 'added' marker when base is null", () => {
    const out = shapeDiff({ path: "new.ts", base: null, target: "hello\n" });
    expect(out).toMatch(/file added/i);
    expect(out).toMatch(/\+hello/);
  });

  it("returns a 'deleted' marker when target is null", () => {
    const out = shapeDiff({ path: "gone.ts", base: "bye\n", target: null });
    expect(out).toMatch(/file deleted/i);
    expect(out).toMatch(/-bye/);
  });

  it("returns a no-changes marker when base and target are identical", () => {
    const out = shapeDiff({ path: "same.ts", base: "x\n", target: "x\n" });
    expect(out).toMatch(/no textual changes/i);
  });

  it("returns a binary marker when content has null bytes", () => {
    const out = shapeDiff({
      path: "img.png",
      // Use the literal escape so the test file stays printable text.
      base: "abc\u0000def",
      target: "abc\u0000xyz",
    });
    expect(out).toMatch(/binary file/i);
    expect(out).not.toMatch(/^[+-]/m);
  });

  it("truncates large diffs and adds a truncation marker", () => {
    const baseLines = Array.from({ length: 2000 }, (_, i) => `base ${i}`).join("\n");
    const targetLines = Array.from({ length: 2000 }, (_, i) => `target ${i}`).join("\n");
    const out = shapeDiff({ path: "big.ts", base: baseLines, target: targetLines, maxLines: 50 });
    const lineCount = out.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(55); // 50 + a few marker lines
    expect(out).toMatch(/diff truncated/i);
  });

  it("handles both null (file untracked at both versions) as no-changes", () => {
    const out = shapeDiff({ path: "phantom.ts", base: null, target: null });
    expect(out).toMatch(/no textual changes/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/pullRequests/diffShaper.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/domains/pullRequests/diffShaper.ts
import { createPatch } from "diff";

export interface ShapeDiffArgs {
  path: string;
  base: string | null; // null when file didn't exist at base (added)
  target: string | null; // null when file no longer exists (deleted)
  maxLines?: number; // default 1000
}

const DEFAULT_MAX_LINES = 1000;

/**
 * Produces a single file's unified diff as a string, with truncation,
 * binary-file detection, and clear markers for added/deleted/unchanged cases.
 *
 * Pure function. No I/O. Used by PullRequestsService.getDiff.
 */
export function shapeDiff(args: ShapeDiffArgs): string {
  const max = args.maxLines ?? DEFAULT_MAX_LINES;
  const base = args.base;
  const target = args.target;

  if (base === null && target === null) {
    return `Index: ${args.path}\n(no textual changes — file did not exist at either side)`;
  }

  if (isBinary(base) || isBinary(target)) {
    return `Index: ${args.path}\n(binary file — diff suppressed)`;
  }

  if (base === target) {
    return `Index: ${args.path}\n(no textual changes)`;
  }

  // Synthesize a diff. createPatch wants strings (not null); represent missing
  // sides as empty strings and prepend a marker for clarity.
  const baseStr = base ?? "";
  const targetStr = target ?? "";
  const patch = createPatch(args.path, baseStr, targetStr, "", "");

  let prefix = "";
  if (base === null) prefix = `(file added)\n`;
  else if (target === null) prefix = `(file deleted)\n`;

  const full = prefix + patch;
  const lines = full.split("\n");
  if (lines.length <= max) return full;

  const truncated = lines.slice(0, max).join("\n");
  const omitted = lines.length - max;
  return `${truncated}\n... (diff truncated; ${omitted} more lines omitted)`;
}

function isBinary(s: string | null): boolean {
  if (s === null) return false;
  // Heuristic: any NUL byte in the first 8 KB → treat as binary. Real text
  // files essentially never contain raw NULs; binary formats almost always do.
  const sample = s.length > 8192 ? s.slice(0, 8192) : s;
  return sample.includes("\u0000");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/domains/pullRequests/diffShaper.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domains/pullRequests/diffShaper.ts test/unit/domains/pullRequests/diffShaper.test.ts
git commit -m "feat(pullRequests): add diffShaper for unified diff generation"
```

---

## Task 15: `domains/pullRequests/service.ts` — TDD (largest service)

Owns:
- Repo resolution (explicit args win, else cwd auto-detect, else throw `RepoContextError`)
- 6 service methods: `list`, `get`, `listChanges`, `getDiff`, `listComments`, `getIterations`
- Each method returns shaped responses (drop noisy SDK fields)

The service depends on `AdoClient` and a `RepoResolver` function (defaults to a real one that calls `detectRepo`). Tests inject a fake resolver — no need to mock cwd or git.

**Files:**
- Create: `test/unit/domains/pullRequests/service.test.ts`
- Create: `src/domains/pullRequests/service.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/domains/pullRequests/service.test.ts
import { describe, it, expect } from "vitest";
import {
  PullRequestsService,
  RepoContextError,
} from "../../../../src/domains/pullRequests/service.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type {
  GitPullRequest,
  GitPullRequestChange,
  GitPullRequestCommentThread,
  GitPullRequestIteration,
} from "../../../../src/ado/types.js";

const REPO = { project: "MyProject", repo: "MyRepo" };

function makeFake(): FakeAdoClient {
  return new FakeAdoClient();
}

describe("PullRequestsService — repo resolution", () => {
  it("uses explicit project + repository when both provided", async () => {
    const fake = makeFake();
    fake.setPullRequests("Explicit", "Repo", []);
    const svc = new PullRequestsService(fake, async () => REPO); // resolver would return MyProject
    const result = await svc.list({ project: "Explicit", repository: "Repo" });
    expect(result).toEqual([]);
  });

  it("falls back to cwd-detected repo when args are omitted", async () => {
    const fake = makeFake();
    fake.setPullRequests(REPO.project, REPO.repo, []);
    const svc = new PullRequestsService(fake, async () => REPO);
    const result = await svc.list({});
    expect(result).toEqual([]);
  });

  it("throws RepoContextError when args omitted and cwd is not an ADO repo", async () => {
    const fake = makeFake();
    const svc = new PullRequestsService(fake, async () => null);
    await expect(svc.list({})).rejects.toBeInstanceOf(RepoContextError);
  });

  it("uses partial args + resolver fill (project provided, repo from cwd)", async () => {
    const fake = makeFake();
    fake.setPullRequests("Override", REPO.repo, []);
    const svc = new PullRequestsService(fake, async () => REPO);
    const result = await svc.list({ project: "Override" });
    expect(result).toEqual([]);
  });
});

describe("PullRequestsService.list", () => {
  it("returns shaped PR summaries", async () => {
    const fake = makeFake();
    const prs: GitPullRequest[] = [
      {
        pullRequestId: 42,
        title: "Add feature X",
        status: 1, // active
        createdBy: { displayName: "Alice", id: "a1" },
        sourceRefName: "refs/heads/feature",
        targetRefName: "refs/heads/main",
        creationDate: new Date("2026-04-22T10:00:00Z"),
        url: "https://example.com/_apis/git/pr/42",
      },
    ];
    fake.setPullRequests(REPO.project, REPO.repo, prs);
    const svc = new PullRequestsService(fake, async () => REPO);
    const result = await svc.list({});
    expect(result[0]).toMatchObject({
      id: 42,
      title: "Add feature X",
      status: "active",
      author: "Alice",
      sourceBranch: "feature",
      targetBranch: "main",
    });
  });
});

describe("PullRequestsService.getDiff", () => {
  it("fetches base + target content and returns a unified diff", async () => {
    const fake = makeFake();
    const pr: GitPullRequest = {
      pullRequestId: 7,
      lastMergeSourceCommit: { commitId: "targetSHA" },
      lastMergeTargetCommit: { commitId: "baseSHA" },
    };
    fake.setPullRequest({ ...REPO, repository: REPO.repo, pullRequestId: 7, pr });
    fake.setFileContent({
      project: REPO.project,
      repository: REPO.repo,
      path: "src/foo.ts",
      commitSha: "baseSHA",
      content: "old\n",
    });
    fake.setFileContent({
      project: REPO.project,
      repository: REPO.repo,
      path: "src/foo.ts",
      commitSha: "targetSHA",
      content: "new\n",
    });
    const svc = new PullRequestsService(fake, async () => REPO);
    const diff = await svc.getDiff({ pullRequestId: 7, path: "src/foo.ts" });
    expect(diff).toMatch(/-old/);
    expect(diff).toMatch(/\+new/);
  });

  it("throws when PR has no merge commits yet", async () => {
    const fake = makeFake();
    fake.setPullRequest({
      ...REPO,
      repository: REPO.repo,
      pullRequestId: 8,
      pr: { pullRequestId: 8 } as GitPullRequest,
    });
    const svc = new PullRequestsService(fake, async () => REPO);
    await expect(svc.getDiff({ pullRequestId: 8, path: "x" })).rejects.toThrow(/SHA/);
  });
});

describe("PullRequestsService.listChanges", () => {
  it("returns shaped change list", async () => {
    const fake = makeFake();
    const changes: GitPullRequestChange[] = [
      { changeType: 2 /* edit */, item: { path: "/src/foo.ts" } },
      { changeType: 1 /* add */, item: { path: "/src/new.ts" } },
    ];
    fake.setPullRequestChanges({ ...REPO, repository: REPO.repo, pullRequestId: 9, changes });
    const svc = new PullRequestsService(fake, async () => REPO);
    const result = await svc.listChanges({ pullRequestId: 9 });
    expect(result).toEqual([
      { path: "/src/foo.ts", changeType: "edit" },
      { path: "/src/new.ts", changeType: "add" },
    ]);
  });
});

describe("PullRequestsService.listComments", () => {
  it("returns shaped comment threads", async () => {
    const fake = makeFake();
    const threads: GitPullRequestCommentThread[] = [
      {
        id: 1,
        status: 1, // active
        threadContext: { filePath: "/src/foo.ts", rightFileStart: { line: 10, offset: 1 } },
        comments: [
          {
            author: { displayName: "Bob" },
            content: "Looks good",
            publishedDate: new Date("2026-04-22T11:00:00Z"),
          },
        ],
      },
    ];
    fake.setPullRequestThreads({ ...REPO, repository: REPO.repo, pullRequestId: 10, threads });
    const svc = new PullRequestsService(fake, async () => REPO);
    const result = await svc.listComments({ pullRequestId: 10 });
    expect(result[0]).toMatchObject({
      threadId: 1,
      status: "active",
      filePath: "/src/foo.ts",
      line: 10,
      comments: [{ author: "Bob", content: "Looks good" }],
    });
  });
});

describe("PullRequestsService.getIterations", () => {
  it("returns shaped iteration summaries", async () => {
    const fake = makeFake();
    const iterations: GitPullRequestIteration[] = [
      { id: 1, description: "Initial push", createdDate: new Date("2026-04-22T09:00:00Z") },
      { id: 2, description: "Address feedback", createdDate: new Date("2026-04-22T15:00:00Z") },
    ];
    fake.setPullRequestIterations({
      ...REPO,
      repository: REPO.repo,
      pullRequestId: 11,
      iterations,
    });
    const svc = new PullRequestsService(fake, async () => REPO);
    const result = await svc.getIterations({ pullRequestId: 11 });
    expect(result).toEqual([
      {
        id: 1,
        description: "Initial push",
        createdDate: "2026-04-22T09:00:00.000Z",
      },
      {
        id: 2,
        description: "Address feedback",
        createdDate: "2026-04-22T15:00:00.000Z",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/pullRequests/service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/domains/pullRequests/service.ts
import type { AdoClient } from "../../ado/client.js";
import type {
  GitPullRequest,
  GitPullRequestChange,
  GitPullRequestCommentThread,
  GitPullRequestIteration,
  PullRequestStatus,
} from "../../ado/types.js";
import { detectRepo } from "../../git/detectRepo.js";
import type { ParsedRemote } from "../../git/parseRemoteUrl.js";
import { shapeDiff } from "./diffShaper.js";

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

const STATUS_FROM_ENUM: Record<number, string> = {
  0: "notSet",
  1: "active",
  2: "abandoned",
  3: "completed",
  4: "all",
};
const STATUS_TO_ENUM: Record<string, PullRequestStatus> = {
  notSet: 0,
  active: 1,
  abandoned: 2,
  completed: 3,
  all: 4,
};

const CHANGE_TYPE_FROM_ENUM: Record<number, string> = {
  0: "none",
  1: "add",
  2: "edit",
  4: "encoding",
  8: "rename",
  16: "delete",
  32: "undelete",
  64: "branch",
  128: "merge",
  256: "lock",
  512: "rollback",
  1024: "sourceRename",
  2048: "targetRename",
  // composite values fall through to "other"
};

const COMMENT_STATUS_FROM_ENUM: Record<number, string> = {
  0: "unknown",
  1: "active",
  2: "fixed",
  3: "wontFix",
  4: "closed",
  5: "byDesign",
  6: "pending",
};

export interface PrSummary {
  id: number;
  title: string;
  status: string;
  author?: string;
  sourceBranch?: string;
  targetBranch?: string;
  createdAt?: string;
  url?: string;
}

export interface PrDetail extends PrSummary {
  description?: string;
  isDraft?: boolean;
  reviewers: Array<{ name?: string; vote: number }>;
  mergeStatus?: string;
}

export interface PrChange {
  path: string;
  changeType: string;
  originalPath?: string;
}

export interface PrCommentThread {
  threadId: number;
  status: string;
  filePath?: string;
  line?: number;
  comments: Array<{
    author?: string;
    content?: string;
    publishedDate?: string;
  }>;
}

export interface PrIterationSummary {
  id: number;
  description?: string;
  createdDate?: string;
}

export class PullRequestsService {
  constructor(
    private readonly client: AdoClient,
    private readonly resolveRepo: RepoResolver = detectRepo,
  ) {}

  // -------- repo resolution --------
  private async resolve(args: {
    project?: string;
    repository?: string;
  }): Promise<{ project: string; repository: string }> {
    if (args.project && args.repository) {
      return { project: args.project, repository: args.repository };
    }
    const detected = await this.resolveRepo();
    const project = args.project ?? detected?.project;
    const repository = args.repository ?? detected?.repo;
    if (!project || !repository) throw new RepoContextError();
    return { project, repository };
  }

  // -------- tools --------
  async list(args: {
    project?: string;
    repository?: string;
    status?: string;
    creatorId?: string;
    reviewerId?: string;
    targetRefName?: string;
    top?: number;
    skip?: number;
  }): Promise<PrSummary[]> {
    const { project, repository } = await this.resolve(args);
    const status = args.status ? STATUS_TO_ENUM[args.status] : STATUS_TO_ENUM["active"];
    const prs = await this.client.listPullRequests({
      project,
      repository,
      status,
      creatorId: args.creatorId,
      reviewerId: args.reviewerId,
      targetRefName: args.targetRefName,
      top: args.top,
      skip: args.skip,
    });
    return prs.map(shapePrSummary);
  }

  async get(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
  }): Promise<PrDetail> {
    const { project, repository } = await this.resolve(args);
    const pr = await this.client.getPullRequest({
      project,
      repository,
      pullRequestId: args.pullRequestId,
    });
    return shapePrDetail(pr);
  }

  async listChanges(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
  }): Promise<PrChange[]> {
    const { project, repository } = await this.resolve(args);
    const changes = await this.client.listPullRequestChanges({
      project,
      repository,
      pullRequestId: args.pullRequestId,
    });
    return changes.map(shapeChange);
  }

  async getDiff(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    path: string;
    maxLines?: number;
  }): Promise<string> {
    const { project, repository } = await this.resolve(args);
    const pr = await this.client.getPullRequest({
      project,
      repository,
      pullRequestId: args.pullRequestId,
    });
    const baseSha = pr.lastMergeTargetCommit?.commitId;
    const targetSha = pr.lastMergeSourceCommit?.commitId;
    if (!baseSha || !targetSha) {
      throw new Error(
        `PR ${args.pullRequestId} has no merge SHAs yet (lastMergeTargetCommit / lastMergeSourceCommit). It may still be queued for processing.`,
      );
    }
    const [base, target] = await Promise.all([
      this.client.getFileContent({ project, repository, path: args.path, commitSha: baseSha }),
      this.client.getFileContent({ project, repository, path: args.path, commitSha: targetSha }),
    ]);
    return shapeDiff({ path: args.path, base, target, maxLines: args.maxLines });
  }

  async listComments(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
  }): Promise<PrCommentThread[]> {
    const { project, repository } = await this.resolve(args);
    const threads = await this.client.listPullRequestThreads({
      project,
      repository,
      pullRequestId: args.pullRequestId,
    });
    return threads.map(shapeThread);
  }

  async getIterations(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
  }): Promise<PrIterationSummary[]> {
    const { project, repository } = await this.resolve(args);
    const iterations = await this.client.listPullRequestIterations({
      project,
      repository,
      pullRequestId: args.pullRequestId,
    });
    return iterations.map(shapeIteration);
  }
}

// -------- shapers (pure) --------
function shapePrSummary(pr: GitPullRequest): PrSummary {
  return {
    id: pr.pullRequestId ?? 0,
    title: pr.title ?? "",
    status: STATUS_FROM_ENUM[pr.status ?? 0] ?? "unknown",
    author: pr.createdBy?.displayName,
    sourceBranch: pr.sourceRefName?.replace(/^refs\/heads\//, ""),
    targetBranch: pr.targetRefName?.replace(/^refs\/heads\//, ""),
    createdAt: pr.creationDate?.toISOString(),
    url: pr.url,
  };
}

function shapePrDetail(pr: GitPullRequest): PrDetail {
  return {
    ...shapePrSummary(pr),
    description: pr.description,
    isDraft: pr.isDraft,
    reviewers: (pr.reviewers ?? []).map((r) => ({
      name: r.displayName,
      vote: r.vote ?? 0,
    })),
    mergeStatus: pr.mergeStatus !== undefined ? String(pr.mergeStatus) : undefined,
  };
}

function shapeChange(c: GitPullRequestChange): PrChange {
  const ct = typeof c.changeType === "number" ? CHANGE_TYPE_FROM_ENUM[c.changeType] : undefined;
  return {
    path: c.item?.path ?? "",
    changeType: ct ?? "other",
    originalPath: c.originalPath,
  };
}

function shapeThread(t: GitPullRequestCommentThread): PrCommentThread {
  return {
    threadId: t.id ?? 0,
    status: COMMENT_STATUS_FROM_ENUM[t.status ?? 0] ?? "unknown",
    filePath: t.threadContext?.filePath,
    line: t.threadContext?.rightFileStart?.line,
    comments: (t.comments ?? []).map((c) => ({
      author: c.author?.displayName,
      content: c.content,
      publishedDate: c.publishedDate?.toISOString(),
    })),
  };
}

function shapeIteration(it: GitPullRequestIteration): PrIterationSummary {
  return {
    id: it.id ?? 0,
    description: it.description,
    createdDate: it.createdDate?.toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/domains/pullRequests/service.test.ts
```

Expected: PASS, ~10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domains/pullRequests/service.ts test/unit/domains/pullRequests/service.test.ts
git commit -m "feat(pullRequests): add PullRequestsService with repo resolution + 6 methods"
```

---

## Task 16: `domains/pullRequests/tools.ts`

Registers the 5 PR tools (`list_pull_requests`, `get_pull_request`, `list_pull_request_changes`, `get_pull_request_diff`, `list_pull_request_comments`, `get_pull_request_iterations`).

**Files:**
- Create: `src/domains/pullRequests/tools.ts`

- [ ] **Step 1: Implement**

```ts
// src/domains/pullRequests/tools.ts
import type { PullRequestsService } from "./service.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  ListPullRequestsInput,
  PullRequestId,
  GetPullRequestDiffInput,
} from "./schemas.js";

export function buildPullRequestTools(svc: PullRequestsService): ToolDefinition[] {
  return [
    {
      name: "list_pull_requests",
      config: {
        title: "List pull requests",
        description:
          "Lists pull requests in an Azure DevOps repository. Defaults to active PRs. " +
          "If `project` and `repository` are omitted, the server auto-detects them from " +
          "the current working directory's git remote (when run from inside a checkout).",
        inputSchema: ListPullRequestsInput,
      },
      handler: async (args) => svc.list(args as Parameters<typeof svc.list>[0]),
    },
    {
      name: "get_pull_request",
      config: {
        title: "Get a pull request",
        description:
          "Returns full metadata for one pull request: title, description, status, author, " +
          "reviewers, branches, draft state, merge status. Use `list_pull_request_changes` to " +
          "see what files changed and `get_pull_request_diff` to see one file's actual diff.",
        inputSchema: PullRequestId,
      },
      handler: async (args) => svc.get(args as Parameters<typeof svc.get>[0]),
    },
    {
      name: "list_pull_request_changes",
      config: {
        title: "List files changed in a pull request",
        description:
          "Returns the list of files changed in a pull request with their change type " +
          "(add/edit/delete/rename). Cheap and complete — doesn't include diff content. " +
          "Use `get_pull_request_diff` to inspect a specific file's diff afterwards.",
        inputSchema: PullRequestId,
      },
      handler: async (args) => svc.listChanges(args as Parameters<typeof svc.listChanges>[0]),
    },
    {
      name: "get_pull_request_diff",
      config: {
        title: "Get unified diff for one file in a pull request",
        description:
          "Returns the unified diff for a single file in a pull request, as a string. " +
          "Diff is truncated at `maxLines` (default 1000). Binary files return a marker " +
          "rather than diff text. Use `list_pull_request_changes` first to find the path.",
        inputSchema: GetPullRequestDiffInput,
      },
      handler: async (args) => svc.getDiff(args as Parameters<typeof svc.getDiff>[0]),
    },
    {
      name: "list_pull_request_comments",
      config: {
        title: "List comment threads on a pull request",
        description:
          "Returns all comment threads on a pull request, including line-anchored comments " +
          "with file path and line number. Includes thread status (active/fixed/wontFix/closed).",
        inputSchema: PullRequestId,
      },
      handler: async (args) => svc.listComments(args as Parameters<typeof svc.listComments>[0]),
    },
    {
      name: "get_pull_request_iterations",
      config: {
        title: "List iterations of a pull request",
        description:
          "Returns the iteration history of a pull request — each iteration represents " +
          "a push to the source branch. Useful for tracking 'what changed since my last review'.",
        inputSchema: PullRequestId,
      },
      handler: async (args) => svc.getIterations(args as Parameters<typeof svc.getIterations>[0]),
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
git add src/domains/pullRequests/tools.ts
git commit -m "feat(pullRequests): add 6 MCP tools (list/get/changes/diff/comments/iterations)"
```

---

## Task 17: Update `mcp/registerTools.ts` — wire all domains + readOnly

**Files:**
- Modify: `src/mcp/registerTools.ts` (full overwrite)

- [ ] **Step 1: Implement**

```ts
// src/mcp/registerTools.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IdentityService } from "../domains/identity/service.js";
import { buildIdentityTools } from "../domains/identity/tools.js";
import { ProjectsService } from "../domains/projects/service.js";
import { buildProjectsTools } from "../domains/projects/tools.js";
import { RepositoriesService } from "../domains/repositories/service.js";
import { buildRepositoriesTools } from "../domains/repositories/tools.js";
import { PullRequestsService } from "../domains/pullRequests/service.js";
import { buildPullRequestTools } from "../domains/pullRequests/tools.js";
import { toToolResult } from "./errorBoundary.js";
import type { AdoClient } from "../ado/client.js";

export interface RegisterAllToolsOptions {
  /**
   * When true, write tools are skipped. No-op in Phase 1 (all tools are reads);
   * the contract exists so Phase 2 can gate write tools without changing this signature.
   */
  readOnly?: boolean;
}

/**
 * Wires domain services to AdoClient and registers all tools on the McpServer.
 * Phase 1 domains: identity, projects, repositories, pullRequests.
 */
export function registerAllTools(
  server: McpServer,
  client: AdoClient,
  _options: RegisterAllToolsOptions = {},
): void {
  const tools = [
    ...buildIdentityTools(new IdentityService(client)),
    ...buildProjectsTools(new ProjectsService(client)),
    ...buildRepositoriesTools(new RepositoriesService(client)),
    ...buildPullRequestTools(new PullRequestsService(client)),
  ];

  // Note: when Phase 2 adds write tools, build a separate `writeTools` array
  // and conditionally include it via `...(options.readOnly ? [] : writeTools)`.

  for (const tool of tools) {
    server.registerTool(tool.name, tool.config, toToolResult(tool.handler));
  }
}
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck && npm test
```

Expected: typecheck exit 0; all unit tests still pass (count grows as Phase 1 tasks land — by here you should be at ~50).

- [ ] **Step 3: Commit**

```bash
git add src/mcp/registerTools.ts
git commit -m "feat(mcp): register Phase 1 domain tools and accept readOnly option"
```

---

## Task 18: Update `src/index.ts` — read AZURE_DEVOPS_READ_ONLY, pass through

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Apply edit**

Replace the `registerAllTools(server, client);` line with the read-only-aware version, and add the import.

```ts
// src/index.ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runSetup } from "./setup.js";
import { readConfig, ConfigNotFoundError } from "./config/configFile.js";
import { getPat, accountFromBaseUrl, PatNotFoundError } from "./config/keyring.js";
import { isReadOnly } from "./config/readOnly.js";
import { SdkAdoClient } from "./ado/sdkClient.js";
import { registerAllTools } from "./mcp/registerTools.js";

async function main(): Promise<void> {
  if (process.argv[2] === "setup") {
    await runSetup();
    return;
  }

  let config;
  let pat: string;
  try {
    config = await readConfig();
    pat = getPat(accountFromBaseUrl(config.baseUrl));
  } catch (err) {
    if (err instanceof ConfigNotFoundError || err instanceof PatNotFoundError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const client = new SdkAdoClient({
    baseUrl: config.baseUrl,
    pat,
    caBundlePath: config.caBundlePath,
  });

  const server = new McpServer({
    name: "azure-devops-mcp",
    version: "0.0.1",
  });

  const readOnly = isReadOnly();
  registerAllTools(server, client, { readOnly });
  if (readOnly) {
    process.stderr.write("[azure-devops-mcp] read-only mode: write tools (when added) will not be registered\n");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[azure-devops-mcp] connected on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`[azure-devops-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it builds and existing behaviors still work**

```bash
npm run typecheck && npm run build && npm test
```

Expected: all green. Tests should be at ~50.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: read AZURE_DEVOPS_READ_ONLY and thread into registerAllTools"
```

---

## Task 19: Update README with full Phase 1 tool catalog

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace Phase 0 tool table + intro**

```markdown
# Azure DevOps MCP

Read-only Azure DevOps MCP server for Claude Code and other MCP hosts. v1 ships read-only PR review workflows for both **Azure DevOps Server** (on-prem) and **Azure DevOps Services** (cloud). Phase 2 will add write operations (create PR, comment, approve, etc.); read-only mode (see below) lets you opt out of those when they land.

## Setup

\`\`\`bash
npx -y @vasekzdvihal/azure-devops-mcp setup
\`\`\`

You'll be prompted for:

- **ADO base URL** — e.g. `https://dev.azure.com/myorg` (cloud) or `https://tfs.company.com/tfs/DefaultCollection` (on-prem).
- **Personal Access Token** — input is masked. Required scopes for v1: **Code (read)**, **Identity (read)**.
- **CA bundle path** (optional) — path to a PEM file. Set this if your on-prem ADO uses an internal CA that isn't in your OS trust store. Leave blank otherwise.

The wizard tests the connection before writing anything. Config goes to `~/.config/azure-devops-mcp/config.json` (mode `0600`); PAT goes to your OS keyring.

## Use with Claude Code

Add to your `~/.claude.json` under `mcpServers`:

\`\`\`json
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["-y", "@vasekzdvihal/azure-devops-mcp"]
    }
  }
}
\`\`\`

### Read-only mode

Set `AZURE_DEVOPS_READ_ONLY=true` in the `env` block to suppress write tools (when they land in Phase 2). Useful when:
- Your PAT is read-only and you want clean error UX.
- You want Claude to summarize PRs but never post on your behalf.

\`\`\`json
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["-y", "@vasekzdvihal/azure-devops-mcp"],
      "env": { "AZURE_DEVOPS_READ_ONLY": "true" }
    }
  }
}
\`\`\`

(In Phase 1 this is a no-op since all tools are reads. The flag is in place so Phase 2's write tools have a clean gate.)

### Cwd auto-detect

The pull-request tools auto-detect the current `project` and `repository` from your shell's `cwd` `.git/config remote.origin.url` when those args aren't passed. So `list_pull_requests` "just works" when Claude is run from inside an ADO checkout. Pass them explicitly to override.

## Available tools

| Tool                            | Description                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `whoami`                        | Returns the identity associated with the configured PAT.                                                 |
| `list_projects`                 | Lists ADO projects in the configured collection / org.                                                   |
| `list_repositories`             | Lists git repositories in a given project.                                                               |
| `list_pull_requests`            | Lists PRs in a repo (default: active). Supports filters: status, creator, reviewer, target branch.       |
| `get_pull_request`              | Full PR metadata: title, description, status, reviewers, branches, draft state, merge status.            |
| `list_pull_request_changes`     | Lists files changed in a PR with change types (add/edit/delete/rename). Cheap; no diff content.          |
| `get_pull_request_diff`         | Returns unified diff text for a single file in a PR (truncatable). Use after `list_pull_request_changes`. |
| `list_pull_request_comments`    | Returns comment threads on a PR (with line anchors).                                                     |
| `get_pull_request_iterations`   | Returns iteration history of a PR (each push = one iteration).                                           |

## Troubleshooting

- **"Azure DevOps MCP config not found"** — run setup.
- **"No PAT found in OS keyring"** — same fix; setup writes both.
- **"Authentication failed against Azure DevOps. The PAT may be expired..."** — regenerate the PAT and re-run setup. Required scopes: **Code (read)**, **Identity (read)**.
- **"TLS verification failed"** — your ADO Server uses a cert your machine doesn't trust. Re-run setup and provide the path to your organization's CA bundle (PEM file).
- **"Could not reach Azure DevOps"** — base URL or network issue.
- **"Could not resolve project + repository"** — you called a PR tool from outside an ADO checkout without passing `project`/`repository`. Either `cd` into the repo or pass the names.

## Development

\`\`\`bash
npm install
npm test            # unit tests
npm run typecheck   # TypeScript check
npm run build       # compile to dist/
npm run dev         # run server from source via tsx
npm run setup       # run setup wizard from source
\`\`\`

Architecture and design decisions live in `docs/superpowers/specs/2026-04-21-azure-devops-mcp-design.md`. Phase 1 implementation plan in `docs/superpowers/plans/2026-04-22-azure-devops-mcp-phase-1.md`.

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with Phase 1 tool catalog and read-only mode"
```

---

## Task 20: Manual end-to-end verification

This is the user-driven checkpoint. Cannot be automated — needs a real ADO instance and a real PR to point at.

**Files:** None changed.

- [ ] **Step 1: Run the full unit test suite**

```bash
npm test
```

Expected: ALL pass. Test count should be roughly 50+ (Phase 0's 26 plus parseRemoteUrl ~13, projects ~3, repositories ~4, pullRequests service ~10, diffShaper ~7).

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 3: Update the local Claude Code MCP config to point at this worktree's `dist/index.js`**

Edit `~/.claude.json`, find the `azure-devops` entry under `mcpServers`, change the path to:

`/Users/vasekzdvihal/source/GitHub/azure-mcp/.worktrees/phase-1-read-only-pr-mvp/dist/index.js`

Reload Claude Code (or `/mcp` reconnect).

- [ ] **Step 4: Exercise each tool from a Claude session**

Inside Claude Code, with `cwd` set to an actual ADO repo on your machine, ask:

- "use azure-devops to list projects"
- "list repositories in project <one of yours>"
- "list pull requests" — should auto-detect project/repo from cwd
- "get pull request <some PR number>"
- "list pull request changes for PR <id>"
- "get pull request diff for PR <id>, file <path>"
- "list pull request comments for PR <id>"
- "list pull request iterations for PR <id>"

For each, confirm the response shape is useful. Note anything that feels noisy, missing, or wrong.

- [ ] **Step 5: Verify read-only mode plumbing**

Edit `~/.claude.json` to add `"env": { "AZURE_DEVOPS_READ_ONLY": "true" }` to the `azure-devops` entry. Reload. The server's stderr line should now read:

```
[azure-devops-mcp] read-only mode: write tools (when added) will not be registered
```

(Visible in Claude Code's MCP debug pane.) Confirm the read tools still work — read-only mode shouldn't suppress them. Remove the env entry to flip back.

- [ ] **Step 6: Verify a friendly error path**

From Claude, in a non-ADO directory (e.g. `cd /tmp`), ask "list pull requests". Should surface the `RepoContextError` message ("Could not resolve project + repository...").

- [ ] **Step 7: Capture checkpoint feedback**

Anything that felt off in the manual exercise — tool naming, response shape, error messages, performance, missing fields, awkward args — capture it. We fold it back into the spec before Phase 2 (or before publish, whichever is sooner).

- [ ] **Step 8: Decide the path forward**

When you're satisfied with Phase 1, the next workflow step is `superpowers:finishing-a-development-branch` (offers merge / PR / keep / discard, same as Phase 0).

If you want a Phase 1.5 for **contract tests** (recorded HTTP fixtures against your real ADO), brainstorm + plan that as a separate small phase before Phase 2 starts.

If you want to start Phase 2 (write tools), brainstorm a fresh spec section + plan with the Phase 1 lessons applied.
