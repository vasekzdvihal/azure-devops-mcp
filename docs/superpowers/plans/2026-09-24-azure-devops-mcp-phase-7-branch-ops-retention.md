# Phase 7 — Branch ops, repo/pipeline admin & build retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add branch comparison / commit-range / branch-filter reads (7a, v0.13.0) and branch creation, repo + pipeline default-branch writes, and build-retention tools (7b, v0.14.0) to the azure-devops MCP server.

**Architecture:** Every new capability is a new method on the `AdoClient` seam (`src/ado/client.ts`), implemented in `SdkAdoClient` against `azure-devops-node-api` and in `test/fakes/FakeAdoClient.ts` for tests. Domain services shape results; tool files hold zod schemas + descriptions. A new `src/domains/retention/` domain owns lease tools. Two slices, two PRs; 7b branches off the merged 7a.

**Tech Stack:** TypeScript (ESM, NodeNext), Node ≥20, `azure-devops-node-api`, `@modelcontextprotocol/sdk`, zod, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-24-azure-devops-mcp-phase-7-branch-ops-retention-design.md`

## Global Constraints

- Relative imports end in `.js` (`import { x } from './y.js'`).
- No `any`; `noUncheckedIndexedAccess` is on — narrow with `??`.
- SDK types reach domains only through `src/ado/types.ts`; domains never import `azure-devops-node-api/interfaces/...`.
- `domains/*` must not import another `domains/*` (the existing `commits → pullRequests/repoResolution` import is pre-existing; don't add new cross-domain imports).
- Every new `SdkAdoClient` `catch` starts with `if (err instanceof AdoError) { throw err; }` then `throw mapSdkError(err);`.
- Don't touch `socketTimeout: 15_000` or the `https.globalAgent` CA mutation in `SdkAdoClient`.
- Destructive tools (`set_default_branch`, `set_pipeline_default_branch`, `delete_build_lease`) start their description with `**Always confirm with the user before calling — …**`.
- `delete_branch` is NOT implemented.
- New PAT scope → update `src/setup.ts`, `src/ado/errors.ts` (`AdoAuthError` message), `README.md` (Required PAT scopes table) together.
- `pnpm lint:fix`, `pnpm typecheck`, `pnpm test` all clean before every commit (husky pre-commit enforces lint).
- Versions: 7a → `0.13.0`, 7b → `0.14.0` in `package.json`.
- Branches: `zdvihal/phase-7a-branch-reads`, then `zdvihal/phase-7b-writes-retention` (off `main` after 7a merges).

## Review Focus

1. **Branch names given as full refs** (`refs/heads/main`) to any new input — every tool must accept both short and full names and behave identically. Pinned by tests in Tasks 1, 3, 8, 10.
2. **`compare_branches` ahead/behind direction** — the SDK doc says only "commits ahead". A swapped mapping silently inverts every downmerge decision. Task 3 has a live verification step against a known pair.
3. **`list_branches` with `names` that includes a branch that does exist but under `refs/heads/` prefix in SDK output** — `missing` must not report it. Pinned in Task 1.
4. **`set_pipeline_default_branch` on a definition whose `repository` is absent** (e.g. a definition with no repo, or a GitHub repo) — must be skipped with a reason, not crash or PUT. Pinned in Task 10.
5. **`find_build_retainers` when release definitions span multiple pages** — must follow `continuationToken`, not stop at page 1. Pinned in Task 11 (SdkAdoClient loop) — FakeAdoClient returns the flattened list; the pagination loop is reviewed by reading.

---

## Slice 7a — reads & compares (v0.13.0)

### Task 0: Workspace

- [ ] **Step 1:** Create an isolated workspace for branch `zdvihal/phase-7a-branch-reads` off `main` (use the `cmux-create` skill; worktree under `.worktrees/`). Copy the spec + this plan into the worktree if they're untracked in the main checkout, and commit them as the branch's first commit:

```bash
git add docs/superpowers/specs/2026-09-24-azure-devops-mcp-phase-7-branch-ops-retention-design.md docs/superpowers/plans/2026-09-24-azure-devops-mcp-phase-7-branch-ops-retention.md
git commit -m "docs(phase-7): spec + plan for branch ops, admin writes, retention"
```

- [ ] **Step 2:** `pnpm install && pnpm test` — baseline green.

### Task 1: `list_branches` — `baseBranch`, `names`, `nameContains`

**Files:**
- Modify: `src/ado/client.ts` (`listBranches` args), `src/ado/sdkClient.ts` (`listBranches`), `test/fakes/FakeAdoClient.ts` (`listBranches` records args)
- Modify: `src/domains/commits/readService.ts`, `src/domains/commits/schemas.ts`, `src/domains/commits/readTools.ts`
- Test: `test/unit/domains/commits/readService.test.ts`

**Interfaces:**
- Produces: `AdoClient.listBranches(args: { project; repository; baseBranch?: string })`; `FakeAdoClient.getListBranchesCalls()`; exported helper `shortBranch(ref: string): string` in `src/domains/commits/readService.ts` (strips `refs/heads/`), reused by Tasks 2, 3, 8.
- `CommitsReadService.listBranches(args: { project?; repository?; baseBranch?; names?: string[]; nameContains?: string }): Promise<BranchSummary[] | { branches: BranchSummary[]; missing: string[] }>`

- [ ] **Step 1: Failing tests** — append to `readService.test.ts`:

```ts
describe('commitsReadService.listBranches filters', () => {
  const branches: GitBranchStats[] = [
    { name: 'main', commit: { commitId: 'a' }, aheadCount: 0, behindCount: 0, isBaseVersion: true },
    { name: 'staging', commit: { commitId: 'b' }, aheadCount: 48, behindCount: 0 },
    { name: 'feature/login', commit: { commitId: 'c' }, aheadCount: 2, behindCount: 5 },
  ];

  it('names → exact allowlist plus missing list', async () => {
    const fake = new FakeAdoClient();
    fake.setBranches(REPO.project, REPO.repo, branches);
    const svc = new CommitsReadService(fake, async () => REPO);
    const result = await svc.listBranches({ names: ['main', 'refs/heads/staging', 'develop'] });
    expect(result).toEqual({
      branches: [
        { name: 'main', lastCommitId: 'a', aheadCount: 0, behindCount: 0, isBaseVersion: true },
        { name: 'staging', lastCommitId: 'b', aheadCount: 48, behindCount: 0, isBaseVersion: undefined },
      ],
      missing: ['develop'],
    });
  });

  it('nameContains → case-insensitive substring, plain array', async () => {
    const fake = new FakeAdoClient();
    fake.setBranches(REPO.project, REPO.repo, branches);
    const svc = new CommitsReadService(fake, async () => REPO);
    const result = await svc.listBranches({ nameContains: 'LOGIN' });
    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<{ name: string }>).map(b => b.name)).toEqual(['feature/login']);
  });

  it('SDK names with refs/heads/ prefix still match names and are not reported missing', async () => {
    const fake = new FakeAdoClient();
    fake.setBranches(REPO.project, REPO.repo, [{ name: 'refs/heads/develop', commit: { commitId: 'd' } }]);
    const svc = new CommitsReadService(fake, async () => REPO);
    const result = await svc.listBranches({ names: ['develop'] });
    expect(result).toMatchObject({ branches: [{ name: 'develop' }], missing: [] });
  });

  it('baseBranch is passed to the client as a short name', async () => {
    const fake = new FakeAdoClient();
    fake.setBranches(REPO.project, REPO.repo, branches);
    const svc = new CommitsReadService(fake, async () => REPO);
    await svc.listBranches({ baseBranch: 'refs/heads/staging' });
    expect(fake.getListBranchesCalls()).toEqual([
      { project: REPO.project, repository: REPO.repo, baseBranch: 'staging' },
    ]);
  });
});
```

- [ ] **Step 2:** `pnpm vitest run test/unit/domains/commits/readService.test.ts` → FAIL (`getListBranchesCalls` not a function / filters ignored).

- [ ] **Step 3: Implement.**

`src/ado/client.ts` — `listBranches` args gain `baseBranch?: string;` with a doc comment `/** Short branch name; ahead/behind are measured against it instead of the default branch. */`.

`src/ado/sdkClient.ts` — replace `listBranches`:

```ts
  async listBranches(args: {
    project: string;
    repository: string;
    baseBranch?: string;
  }): Promise<GitBranchStats[]> {
    try {
      const git = await this.api.getGitApi();
      const base = args.baseBranch
        ? { version: args.baseBranch, versionType: 0 /* Branch */ }
        : undefined;
      return await git.getBranches(args.repository, args.project, base);
    }
    catch (err) {
      if (err instanceof AdoError) {
        throw err;
      }
      throw mapSdkError(err);
    }
  }
```

`test/fakes/FakeAdoClient.ts` — add `private listBranchesCalls: Array<{ project: string; repository: string; baseBranch?: string }> = [];`, `getListBranchesCalls() { return this.listBranchesCalls; }`, and in `listBranches` push `{ project: args.project, repository: args.repository, ...(args.baseBranch ? { baseBranch: args.baseBranch } : {}) }` before returning.

`src/domains/commits/readService.ts`:

```ts
export function shortBranch(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}

export interface FilteredBranches {
  branches: BranchSummary[];
  missing: string[];
}

  async listBranches(args: {
    project?: string;
    repository?: string;
    baseBranch?: string;
    names?: string[];
    nameContains?: string;
  }): Promise<BranchSummary[] | FilteredBranches> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const raw = await this.client.listBranches({
      project,
      repository,
      ...(args.baseBranch ? { baseBranch: shortBranch(args.baseBranch) } : {}),
    });
    let branches = raw.map(shapeBranch);
    if (args.nameContains) {
      const needle = args.nameContains.toLowerCase();
      branches = branches.filter(b => b.name.toLowerCase().includes(needle));
    }
    if (!args.names) {
      return branches;
    }
    const wanted = args.names.map(shortBranch);
    const byName = new Map(branches.map(b => [b.name, b]));
    return {
      branches: wanted.flatMap(n => byName.get(n) ?? []),
      missing: wanted.filter(n => !byName.has(n)),
    };
  }
```

and `shapeBranch` uses `name: shortBranch(branch.name ?? '')`.

`schemas.ts` — `ListBranchesInput`:

```ts
export const ListBranchesInput = {
  ...repoCoords,
  baseBranch: z.string().min(1).optional().describe(
    'Measure aheadCount/behindCount against this branch instead of the repository default branch.',
  ),
  names: z.array(z.string().min(1)).min(1).max(50).optional().describe(
    'Return only these branches (exact short names). The result becomes { branches, missing } — '
    + '`missing` lists requested names that do not exist.',
  ),
  nameContains: z.string().min(1).optional().describe('Case-insensitive substring filter on branch name.'),
};
```

`readTools.ts` — `list_branches` description:
`'Lists branches in an Azure DevOps git repository, each with the last commit id and ahead/behind counts vs the default branch, or vs `baseBranch` when given. Use `names` to check specific branches (e.g. main/staging/develop) without listing every branch — the result then includes `missing`. If `project` and `repository` are omitted, they are auto-detected from the current working directory\'s git remote.'`

- [ ] **Step 4:** Re-run the test file → PASS. Run full `pnpm test` (the existing listBranches tests must still pass unchanged).
- [ ] **Step 5:** `pnpm lint:fix && pnpm typecheck && git commit -am "feat(phase-7a): list_branches baseBranch + names/nameContains filters"`

### Task 2: `list_commits` — `notInBranch`

**Files:**
- Modify: `src/ado/client.ts`, `src/ado/sdkClient.ts`, `test/fakes/FakeAdoClient.ts` (`listCommits` + recorder)
- Modify: `src/domains/commits/readService.ts`, `schemas.ts`, `readTools.ts`
- Test: `test/unit/domains/commits/readService.test.ts`

**Interfaces:**
- Consumes: `shortBranch` (Task 1).
- Produces: `AdoClient.listCommits` args gain `notInBranch?: string`; `FakeAdoClient.getListCommitsCalls()`; `CommitsReadService.listCommits` accepts `notInBranch?: string` (used by Task 3).

- [ ] **Step 1: Failing tests:**

```ts
describe('commitsReadService.listCommits notInBranch', () => {
  it('passes branch + notInBranch as short names and returns author email', async () => {
    const fake = new FakeAdoClient();
    fake.setCommits(REPO.project, REPO.repo, [
      { commitId: 'x1', comment: 'fix', author: { name: 'Ann', email: 'ann@corp.cz', date: new Date('2026-09-01T00:00:00Z') } },
    ]);
    const svc = new CommitsReadService(fake, async () => REPO);
    const result = await svc.listCommits({ branch: 'refs/heads/staging', notInBranch: 'develop' });
    expect(fake.getListCommitsCalls()[0]).toMatchObject({ branch: 'staging', notInBranch: 'develop' });
    expect(result[0]?.author?.email).toBe('ann@corp.cz');
  });

  it('rejects notInBranch without branch', async () => {
    const svc = new CommitsReadService(new FakeAdoClient(), async () => REPO);
    await expect(svc.listCommits({ notInBranch: 'develop' })).rejects.toThrow(
      /`notInBranch` requires `branch`/,
    );
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**

`client.ts` `listCommits` args: add `/** Exclude commits reachable from this branch (commits in `branch` not in `notInBranch`). */ notInBranch?: string;`.

`sdkClient.ts` `listCommits` criteria: add
```ts
        ...(args.notInBranch
          ? { compareVersion: { version: args.notInBranch, versionType: 0 /* Branch */ } }
          : {}),
```
and add the `AdoError` guard to its catch.

Fake: record `args` into `private listCommitsCalls: Array<Parameters<AdoClient['listCommits']>[0]> = []` with `getListCommitsCalls()`.

Service `listCommits`: add `notInBranch?: string` arg; before resolving:
```ts
    if (args.notInBranch && !args.branch) {
      throw new Error('list_commits: `notInBranch` requires `branch` (commits in `branch` that are not in `notInBranch`).');
    }
```
pass `branch: args.branch ? shortBranch(args.branch) : undefined` and `notInBranch: args.notInBranch ? shortBranch(args.notInBranch) : undefined`.

Schema: `notInBranch: z.string().min(1).optional().describe('Only commits in `branch` that are NOT reachable from this branch (e.g. branch=staging, notInBranch=develop → what a staging→develop merge would bring). Requires `branch`.')`.

Tool description appended: `' Use `notInBranch` for a commit range. Each commit includes author.name and author.email (use the email for identity lookups, e.g. Slack users.lookupByEmail).'`

- [ ] **Step 4:** Run → PASS; `pnpm test`.
- [ ] **Step 5:** lint/typecheck; `git commit -am "feat(phase-7a): list_commits notInBranch range"`

### Task 3: `compare_branches`

**Files:**
- Modify: `src/ado/types.ts` (export `GitCommitDiffs`), `src/ado/client.ts`, `src/ado/sdkClient.ts`, `test/fakes/FakeAdoClient.ts`
- Modify: `src/domains/commits/readService.ts`, `schemas.ts`, `readTools.ts`
- Modify: `test/unit/mcp/registerTools.test.ts` (counts 57 / 24)
- Test: `test/unit/domains/commits/readService.test.ts`

**Interfaces:**
- Consumes: `shortBranch`, `CommitsReadService.listCommits({ branch, notInBranch, top })` (Task 2).
- Produces: `AdoClient.getCommitDiffs(args: { project; repository; base: string; target: string }): Promise<GitCommitDiffs>`; `FakeAdoClient.setCommitDiffs(project, repository, diffs)`; `CommitsReadService.compareBranches(...)`: `Promise<BranchComparison>`.

`BranchComparison`:
```ts
export interface BranchComparison {
  base: string;
  target: string;
  /** Commits in `target` that are not in `base`. */
  aheadCount: number;
  /** Commits in `base` that are not in `target`. */
  behindCount: number;
  commonCommit?: string;
  changeCounts?: { Add?: number; Edit?: number; Delete?: number };
  commits?: CommitSummary[];
}
```

- [ ] **Step 1: Failing tests:**

```ts
describe('commitsReadService.compareBranches', () => {
  it('returns counts + named changeCounts, no commits by default', async () => {
    const fake = new FakeAdoClient();
    fake.setCommitDiffs(REPO.project, REPO.repo, {
      aheadCount: 3, behindCount: 1, commonCommit: 'cc', changeCounts: { 1: 2, 2: 5, 16: 1 },
    });
    const svc = new CommitsReadService(fake, async () => REPO);
    const result = await svc.compareBranches({ base: 'refs/heads/develop', target: 'staging' });
    expect(result).toEqual({
      base: 'develop', target: 'staging', aheadCount: 3, behindCount: 1, commonCommit: 'cc',
      changeCounts: { Add: 2, Edit: 5, Delete: 1 },
    });
    expect(fake.getListCommitsCalls()).toEqual([]);
  });

  it('includeCommits → commits in target not in base', async () => {
    const fake = new FakeAdoClient();
    fake.setCommitDiffs(REPO.project, REPO.repo, { aheadCount: 1, behindCount: 0 });
    fake.setCommits(REPO.project, REPO.repo, [{ commitId: 'k', author: { name: 'B', email: 'b@x.cz' } }]);
    const svc = new CommitsReadService(fake, async () => REPO);
    const result = await svc.compareBranches({ base: 'develop', target: 'staging', includeCommits: true, top: 10 });
    expect(fake.getListCommitsCalls()[0]).toMatchObject({ branch: 'staging', notInBranch: 'develop', top: 10 });
    expect(result.commits?.[0]?.author?.email).toBe('b@x.cz');
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**

`types.ts`: add `GitCommitDiffs` to the "Git commits & branches" export list.

`client.ts`:
```ts
  /** Ahead/behind + change counts between two branches (GitApi.getCommitDiffs, diffCommonCommit). */
  getCommitDiffs: (args: {
    project: string;
    repository: string;
    base: string;
    target: string;
  }) => Promise<GitCommitDiffs>;
```

`sdkClient.ts`:
```ts
  async getCommitDiffs(args: {
    project: string;
    repository: string;
    base: string;
    target: string;
  }): Promise<GitCommitDiffs> {
    try {
      const git = await this.api.getGitApi();
      return await git.getCommitDiffs(
        args.repository,
        args.project,
        true, // diffCommonCommit
        0, // top — we only want counts, not the file change list
        0, // skip
        { baseVersion: args.base, baseVersionType: 0 /* Branch */ },
        { targetVersion: args.target, targetVersionType: 0 /* Branch */ },
      );
    }
    catch (err) {
      if (err instanceof AdoError) {
        throw err;
      }
      throw mapSdkError(err);
    }
  }
```

Fake: `private commitDiffs = new Map<string, GitCommitDiffs>()`, `setCommitDiffs(project, repository, diffs)`, `getCommitDiffs` returns the entry for `${project} ${repository}` or throws `new Error('FakeAdoClient.getCommitDiffs: no diffs configured …')`.

Service:
```ts
const CHANGE_TYPE_NAMES: Record<number, 'Add' | 'Edit' | 'Delete'> = { 1: 'Add', 2: 'Edit', 16: 'Delete' };

  async compareBranches(args: {
    project?: string;
    repository?: string;
    base: string;
    target: string;
    includeCommits?: boolean;
    top?: number;
  }): Promise<BranchComparison> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const base = shortBranch(args.base);
    const target = shortBranch(args.target);
    const diffs = await this.client.getCommitDiffs({ project, repository, base, target });
    const result: BranchComparison = {
      base,
      target,
      aheadCount: diffs.aheadCount ?? 0,
      behindCount: diffs.behindCount ?? 0,
      ...(diffs.commonCommit ? { commonCommit: diffs.commonCommit } : {}),
      ...(diffs.changeCounts ? { changeCounts: nameChangeCounts(diffs.changeCounts) } : {}),
    };
    if (args.includeCommits) {
      result.commits = await this.listCommits({
        project, repository, branch: target, notInBranch: base, top: args.top ?? 100,
      });
    }
    return result;
  }

function nameChangeCounts(counts: Record<number, number>): BranchComparison['changeCounts'] {
  const named: NonNullable<BranchComparison['changeCounts']> = {};
  for (const [key, value] of Object.entries(counts)) {
    const name = CHANGE_TYPE_NAMES[Number(key)];
    if (name) {
      named[name] = value;
    }
  }
  return named;
}
```

Schema:
```ts
export const CompareBranchesInput = {
  ...repoCoords,
  base: z.string().min(1).describe('Base branch (e.g. \'develop\').'),
  target: z.string().min(1).describe('Target branch (e.g. \'staging\').'),
  includeCommits: z.boolean().optional().describe('Also return the commits in target that are not in base (default false).'),
  top: z.number().int().positive().max(MAX_TOP).optional().describe('Max commits when includeCommits (default 100).'),
};
```

Tool `compare_branches`, title `'Compare two branches'`, description: `'Compares two branches: aheadCount = commits in `target` not in `base`, behindCount = commits in `base` not in `target`, plus the merge base and file change counts. aheadCount 0 means merging target into base brings nothing. Set includeCommits to also list those commits with author name + email. Project and repository auto-detect from cwd if omitted.'`

registerTools.test.ts: `FULL_TOOL_COUNT = 57`, `READ_ONLY_TOOL_COUNT = 24`.

- [ ] **Step 4:** Run → PASS; `pnpm test`.
- [ ] **Step 5: Live direction check (Review Focus #2).** Build (`pnpm build`) and run against real ADO a pair whose answer is known from `list_branches` (e.g. N2: `staging` is 48 ahead / 0 behind `main`):

Register the local `dist/index.js` as an MCP server in a scratch Claude Code session (absolute path, per AGENTS.md) and call `compare_branches { project: <N2 project>, repository: <N2 repo>, base: 'main', target: 'staging' }`. Expected `aheadCount: 48, behindCount: 0`. **If swapped**, swap `aheadCount`/`behindCount` in `compareBranches` (not in the client), add a comment `// getCommitDiffs counts are relative to base; ADO names them from base's side`, and flip the unit test expectations to keep them as documented semantics. If no live ADO is reachable, stop and ask the user to run this check.
- [ ] **Step 6:** lint/typecheck; `git commit -am "feat(phase-7a): compare_branches"`

### Task 4: PR `webUrl`

**Files:**
- Modify: `src/domains/pullRequests/readService.ts` (`PrSummary`, `shapePrSummary`), `src/domains/pullRequests/writeService.ts` (create result)
- Test: `test/unit/domains/pullRequests/readService.test.ts`, `writeService.test.ts`

**Interfaces:**
- Produces: `prWebUrl(pr: GitPullRequest): string | undefined` exported from `src/domains/pullRequests/readService.ts`; `PrSummary.webUrl?: string`; create-PR result gains `webUrl?: string`.

- [ ] **Step 1: Failing tests** (readService): a PR `{ pullRequestId: 9013, repository: { webUrl: 'https://tfs/c/P/_git/N2' }, … }` → `list` result `[0].webUrl === 'https://tfs/c/P/_git/N2/pullrequest/9013'`; `get` result carries the same; a PR without `repository.webUrl` → `webUrl` is `undefined`. (writeService): `setNextCreatedPr({ pullRequestId: 5, repository: { webUrl: 'https://x/_git/R' } })` → `createPr(...)` result `webUrl === 'https://x/_git/R/pullrequest/5'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement:**

```ts
export function prWebUrl(pr: GitPullRequest): string | undefined {
  const repoUrl = pr.repository?.webUrl;
  return repoUrl && pr.pullRequestId ? `${repoUrl.replace(/\/$/, '')}/pullrequest/${pr.pullRequestId}` : undefined;
}
```
Add `webUrl?: string` to `PrSummary` (after `url`) and `webUrl: prWebUrl(pr)` in `shapePrSummary`. In the write service's create result add `webUrl?: string` to the result type and `webUrl: prWebUrl(created)` — the write service is in the same domain, so importing from `./readService.js` is allowed. Update the `list_pull_requests` / `get_pull_request` / `create_pull_request` descriptions: `'… `webUrl` is the clickable browser link; `url` is the REST API URL.'`
- [ ] **Step 4:** Run → PASS; `pnpm test` (existing `toEqual` expectations on PR shapes may need `webUrl: undefined` — `toEqual` ignores undefined props, so they should pass as-is).
- [ ] **Step 5:** lint/typecheck; `git commit -am "feat(phase-7a): webUrl on pull request results"`

### Task 5: `list_repositories` liveness fields

**Files:**
- Modify: `src/domains/repositories/service.ts`, `src/domains/repositories/tools.ts`
- Test: `test/unit/domains/repositories/service.test.ts`

- [ ] **Step 1: Failing test:** repos `{ id: 'r3', name: 'Dead', isDisabled: true, size: 0 }` and `{ id: 'r4', name: 'Busy', defaultBranch: 'refs/heads/main', isInMaintenance: true, size: 1234 }` → `toEqual([{ id: 'r3', name: 'Dead', isDisabled: true, size: 0 }, { id: 'r4', name: 'Busy', defaultBranch: 'main', isInMaintenance: true, size: 1234 }])` (`toEqual` treats absent and `undefined` props alike).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `isDisabled?: boolean; isInMaintenance?: boolean; size?: number;` to `RepoSummary` and pass them through in `shape`. Tool description append: `' Each repo includes defaultBranch (absent = never pushed to), size in bytes (0 = empty), isDisabled and isInMaintenance.'`
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** lint/typecheck; `git commit -am "feat(phase-7a): repo liveness fields on list_repositories"`

### Task 6: 7a docs, version, PR

**Files:** `README.md`, `docs/ROADMAP.md`, `docs/superpowers/specs/2026-04-21-azure-devops-mcp-design.md` (phase list/tool inventory section, if present), `package.json`

- [ ] **Step 1:** README Read-tools table: add `compare_branches` row; update `list_branches` (`baseBranch`, `names`/`nameContains` with `missing`), `list_commits` (`notInBranch`, author email), `list_repositories` (liveness fields), PR tools (`webUrl`).
- [ ] **Step 2:** ROADMAP: add `## ✅ Phase 7a — Branch comparison & sweep reads` (status: shipped <date> in v0.13.0), tools table, key decisions: client-side branch filtering, commits for compare via `compareVersion` because `getCommitDiffs` returns no commit list, verified ahead/behind direction, webUrl derived from `repository.webUrl`. Add `## 🟡 Phase 7b — …` as planned.
- [ ] **Step 3:** `package.json` version → `0.13.0`. Spec status line → `approved 2026-09-24; 7a shipped in v0.13.0`.
- [ ] **Step 4:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green.
- [ ] **Step 5:** `git commit -am "docs(phase-7a): README + roadmap; bump to 0.13.0"`; open the PR with the `my-create-pr` skill (base `main`).

---

## Slice 7b — writes & retention (v0.14.0)

### Task 7: Workspace + `repositories` domain rename

**Files:**
- Rename: `src/domains/repositories/service.ts` → `readService.ts` (class `RepositoriesService` → `RepositoriesReadService`), `tools.ts` → `readTools.ts` (`buildRepositoriesTools` → `buildRepositoriesReadTools`)
- Rename: `test/unit/domains/repositories/service.test.ts` → `readService.test.ts`
- Modify: `src/mcp/registerTools.ts`

- [ ] **Step 1:** After 7a merges: new workspace `zdvihal/phase-7b-writes-retention` off updated `main` (`cmux-create`). `pnpm install && pnpm test`.
- [ ] **Step 2:** `git mv` the three files, rename the class/function, fix imports (`grep -rn "repositories/service\|repositories/tools\|RepositoriesService\|buildRepositoriesTools" src test`).
- [ ] **Step 3:** `pnpm typecheck && pnpm test` → green, no behaviour change.
- [ ] **Step 4:** `git commit -am "refactor(repositories): readService/readTools naming to match other domains"`

### Task 8: `create_branch`

**Files:**
- Modify: `src/ado/types.ts` (export `GitRefUpdate`, `GitRefUpdateResult`, value-export `GitRefUpdateStatus`), `src/ado/client.ts`, `src/ado/sdkClient.ts`, `test/fakes/FakeAdoClient.ts`
- Create: `src/domains/commits/writeService.ts`, `src/domains/commits/writeTools.ts`
- Modify: `src/domains/commits/schemas.ts`, `src/mcp/registerTools.ts`
- Test: `test/unit/domains/commits/writeService.test.ts`

**Interfaces:**
- Consumes: `shortBranch` from `./readService.js`.
- Produces:
  - `AdoClient.getBranch(args: { project; repository; branch: string }): Promise<GitBranchStats | null>` (null on 404) — also used by Task 9.
  - `AdoClient.updateRefs(args: { project; repository; updates: GitRefUpdate[] }): Promise<GitRefUpdateResult[]>`
  - Fake: `setBranches` already feeds `getBranch` (match on `shortBranch(name)`); `setNextRefUpdateResults(results)`; `getRefUpdateCalls()`.
  - `CommitsWriteService.createBranch(args: { project?; repository?; name: string; from: string }): Promise<{ name: string; objectId: string }>`
  - `buildCommitsWriteTools(svc): ToolDefinition[]`

- [ ] **Step 1: Failing tests** (`writeService.test.ts`):

```ts
const REPO = { project: 'P', repo: 'R' };
const ZERO = '0'.repeat(40);
const SHA = 'a'.repeat(40);

describe('commitsWriteService.createBranch', () => {
  it('resolves `from` branch to its head sha and creates refs/heads/<name>', async () => {
    const fake = new FakeAdoClient();
    fake.setBranches(REPO.project, REPO.repo, [{ name: 'master', commit: { commitId: SHA } }]);
    fake.setNextRefUpdateResults([{ name: 'refs/heads/main', success: true, updateStatus: 0, newObjectId: SHA }]);
    const svc = new CommitsWriteService(fake, async () => REPO);
    const result = await svc.createBranch({ name: 'refs/heads/main', from: 'master' });
    expect(fake.getRefUpdateCalls()).toEqual([{
      project: 'P', repository: 'R',
      updates: [{ name: 'refs/heads/main', oldObjectId: ZERO, newObjectId: SHA }],
    }]);
    expect(result).toEqual({ name: 'main', objectId: SHA });
  });

  it('uses a 40-hex `from` as the sha without a branch lookup', async () => {
    const fake = new FakeAdoClient();
    fake.setNextRefUpdateResults([{ success: true, updateStatus: 0 }]);
    const svc = new CommitsWriteService(fake, async () => REPO);
    await svc.createBranch({ name: 'main', from: SHA.toUpperCase() });
    expect(fake.getRefUpdateCalls()[0]?.updates[0]?.newObjectId).toBe(SHA);
  });

  it('throws when the source branch does not exist', async () => {
    const svc = new CommitsWriteService(new FakeAdoClient(), async () => REPO);
    await expect(svc.createBranch({ name: 'main', from: 'nope' })).rejects.toThrow(/source branch 'nope' not found/);
  });

  it('throws when updateRefs reports success:false with HTTP 200', async () => {
    const fake = new FakeAdoClient();
    fake.setNextRefUpdateResults([{ success: false, updateStatus: 12 /* RefNameConflict */, customMessage: 'exists' }]);
    const svc = new CommitsWriteService(fake, async () => REPO);
    await expect(svc.createBranch({ name: 'main', from: SHA })).rejects.toThrow(
      "create_branch: Azure DevOps rejected creating 'main' (refNameConflict): exists.",
    );
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**

`types.ts`: add `GitRefUpdate`, `GitRefUpdateResult` to the Git type exports; `export { GitRefUpdateStatus } from 'azure-devops-node-api/interfaces/GitInterfaces.js';`.

`sdkClient.ts`:
```ts
  async getBranch(args: { project: string; repository: string; branch: string }): Promise<GitBranchStats | null> {
    try {
      const git = await this.api.getGitApi();
      return await git.getBranch(args.repository, args.branch, args.project);
    }
    catch (err) {
      if (err instanceof AdoError) {
        throw err;
      }
      const mapped = mapSdkError(err);
      if (mapped instanceof AdoNotFoundError) {
        return null;
      }
      throw mapped;
    }
  }

  async updateRefs(args: { project: string; repository: string; updates: GitRefUpdate[] }): Promise<GitRefUpdateResult[]> {
    try {
      const git = await this.api.getGitApi();
      return await git.updateRefs(args.updates, args.repository, args.project);
    }
    catch (err) {
      if (err instanceof AdoError) {
        throw err;
      }
      throw mapSdkError(err);
    }
  }
```
Note: the SDK's `getBranch` may resolve `null`/throw on a missing branch depending on server; both paths yield `null` here.

Fake `getBranch`: `return (this.branches.get(\`${p} ${r}\`) ?? []).find(b => (b.name ?? '').replace(/^refs\/heads\//, '') === args.branch) ?? null;`.

`writeService.ts`:
```ts
import type { AdoClient } from '../../ado/client.js';
import type { RepoResolver } from '../pullRequests/repoResolution.js';
import { GitRefUpdateStatus } from '../../ado/types.js';
import { detectRepo } from '../../git/detectRepo.js';
import { resolveRepo } from '../pullRequests/repoResolution.js';
import { shortBranch } from './readService.js';

const ZERO_SHA = '0'.repeat(40);
const SHA_RE = /^[0-9a-f]{40}$/i;

export interface CreateBranchResult {
  name: string;
  objectId: string;
}

export class CommitsWriteService {
  constructor(
    private readonly client: AdoClient,
    private readonly resolver: RepoResolver = detectRepo,
  ) {}

  async createBranch(args: { project?: string; repository?: string; name: string; from: string }): Promise<CreateBranchResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const name = shortBranch(args.name);
    const sha = SHA_RE.test(args.from) ? args.from.toLowerCase() : await this.headOf(project, repository, args.from);
    const [result] = await this.client.updateRefs({
      project,
      repository,
      updates: [{ name: `refs/heads/${name}`, oldObjectId: ZERO_SHA, newObjectId: sha }],
    });
    if (!result?.success) {
      const status = result?.updateStatus;
      const label = status === undefined ? 'unknown' : lowerFirst(GitRefUpdateStatus[status] ?? String(status));
      // Plain Error, not AdoConflictError: that class's message says "state changed, re-fetch",
      // which is wrong for an existing branch or a policy rejection.
      throw new Error(
        `create_branch: Azure DevOps rejected creating '${name}' (${label})${result?.customMessage ? `: ${result.customMessage}` : ''}.`,
      );
    }
    return { name, objectId: sha };
  }

  private async headOf(project: string, repository: string, from: string): Promise<string> {
    const branch = await this.client.getBranch({ project, repository, branch: shortBranch(from) });
    const sha = branch?.commit?.commitId;
    if (!sha) {
      throw new Error(`create_branch: source branch '${shortBranch(from)}' not found in ${repository}.`);
    }
    return sha;
  }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
```
Schema `CreateBranchInput = { ...repoCoords, name: z.string().min(1).describe('New branch name (e.g. \'main\').'), from: z.string().min(1).describe('Source: a branch name or a full 40-char commit sha.') }`.

`writeTools.ts` → `create_branch`, title `'Create a branch'`, description: `'Creates a new branch pointing at `from` (a branch name or a 40-char commit sha) without cloning. Fails if the branch already exists or a policy blocks it. Project and repository auto-detect from cwd if omitted. There is intentionally no delete-branch tool.'`

`registerTools.ts`: import `CommitsWriteService` / `buildCommitsWriteTools`, add `...buildCommitsWriteTools(new CommitsWriteService(client))` to `writeTools`.

registerTools.test.ts: `FULL_TOOL_COUNT = 58`; add `'create_branch'` to `FULL_ONLY_NAMES`.

- [ ] **Step 4:** Run → PASS; `pnpm test`.
- [ ] **Step 5:** lint/typecheck; `git add -A src test && git commit -m "feat(phase-7b): create_branch"`

### Task 9: `set_default_branch`

**Files:**
- Modify: `src/ado/client.ts`, `src/ado/sdkClient.ts`, `test/fakes/FakeAdoClient.ts`
- Create: `src/domains/repositories/writeService.ts`, `src/domains/repositories/writeTools.ts`
- Modify: `src/mcp/registerTools.ts`, `test/unit/mcp/registerTools.test.ts`
- Test: `test/unit/domains/repositories/writeService.test.ts`

**Interfaces:**
- Consumes: `AdoClient.getBranch` (Task 8), `AdoClient.listRepositories`.
- Produces: `AdoClient.updateRepositoryDefaultBranch(args: { project; repositoryId: string; defaultBranch: string /* full ref */ }): Promise<GitRepository>`; fake `getRepositoryUpdates()`; `RepositoriesWriteService.setDefaultBranch(args: { project; repository; branch }): Promise<{ repository: string; previous?: string; current: string }>`.

- [ ] **Step 1: Failing tests:**
  - repo `{ id: 'r1', name: 'NewtonLens', defaultBranch: 'refs/heads/cleanup-docker-standalone' }` + branch `main` exists → result `{ repository: 'NewtonLens', previous: 'cleanup-docker-standalone', current: 'main' }`; fake recorded `{ project: 'P', repositoryId: 'r1', defaultBranch: 'refs/heads/main' }`.
  - `branch: 'refs/heads/main'` behaves the same.
  - branch does not exist → rejects `/branch 'main' does not exist in NewtonLens/`, no update recorded.
  - unknown repository name → rejects `/repository 'Nope' not found in project 'P'/`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**

`sdkClient.ts`:
```ts
  async updateRepositoryDefaultBranch(args: { project: string; repositoryId: string; defaultBranch: string }): Promise<GitRepository> {
    try {
      const git = await this.api.getGitApi();
      return await git.updateRepository({ defaultBranch: args.defaultBranch }, args.repositoryId, args.project);
    }
    catch (err) {
      if (err instanceof AdoError) {
        throw err;
      }
      throw mapSdkError(err);
    }
  }
```

Service:
```ts
export class RepositoriesWriteService {
  constructor(private readonly client: AdoClient) {}

  async setDefaultBranch(args: { project: string; repository: string; branch: string }): Promise<SetDefaultBranchResult> {
    const repos = await this.client.listRepositories({ project: args.project });
    const repo = repos.find(r => r.name?.toLowerCase() === args.repository.toLowerCase());
    if (!repo?.id) {
      throw new Error(`set_default_branch: repository '${args.repository}' not found in project '${args.project}'.`);
    }
    const branch = args.branch.replace(/^refs\/heads\//, '');
    const exists = await this.client.getBranch({ project: args.project, repository: repo.id, branch });
    if (!exists) {
      throw new Error(`set_default_branch: branch '${branch}' does not exist in ${repo.name}; create it first (create_branch).`);
    }
    const updated = await this.client.updateRepositoryDefaultBranch({
      project: args.project,
      repositoryId: repo.id,
      defaultBranch: `refs/heads/${branch}`,
    });
    return {
      repository: repo.name ?? args.repository,
      previous: repo.defaultBranch?.replace(/^refs\/heads\//, ''),
      current: (updated.defaultBranch ?? `refs/heads/${branch}`).replace(/^refs\/heads\//, ''),
    };
  }
}
```
(The fake's `getBranch` matches on repository key `${project} ${repository}` — in this test configure branches under the repo **id** `r1`, since the service passes the id.)

Tool `set_default_branch`: title `'Set a repository\'s default branch'`, description: `'**Always confirm with the user before calling — this changes the default branch for everyone using the repository (new PR targets, clone checkout).** Sets the default branch of one repository. The branch must already exist. Returns previous and current values.'`; schema `{ project: z.string().min(1), repository: z.string().min(1), branch: z.string().min(1) }` with describes.

registerTools: add `...buildRepositoriesWriteTools(new RepositoriesWriteService(client))`. Test: `FULL_TOOL_COUNT = 59`; add `'set_default_branch'` to `FULL_ONLY_NAMES`.

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** lint/typecheck; `git commit -am "feat(phase-7b): set_default_branch"`

### Task 10: `set_pipeline_default_branch`

**Files:**
- Modify: `src/ado/client.ts`/`sdkClient.ts`/fake — `listPipelines` args gain `repositoryType?: string` (SdkAdoClient passes it as the 4th `getDefinitions` arg)
- Modify: `src/domains/pipelines/writeService.ts`, `schemas.ts`, `writeTools.ts`, `test/unit/mcp/registerTools.test.ts`
- Test: `test/unit/domains/pipelines/writeService.test.ts`

**Interfaces:**
- Consumes: `listRepositories`, `listPipelines({ project, repositoryId, repositoryType: 'TfsGit' })`, `getPipelineDefinition`, `updatePipelineDefinition`, fake `setPipelines`, `setPipelineDefinition`, `getPipelineDefUpdates`, `injectError`.
- Produces: `PipelinesWriteService.setDefaultBranch(args: { project: string; repository?: string; fromBranch?: string; toBranch: string; definitionIds?: number[]; dryRun?: boolean }): Promise<SetPipelineDefaultBranchResult>`

```ts
export interface DefaultBranchChange { id: number; name: string; current?: string; next: string }
export interface DefaultBranchSkip { id: number; name: string; current?: string; reason: string }
export type SetPipelineDefaultBranchResult =
  | { dryRun: true; changes: DefaultBranchChange[]; skipped: DefaultBranchSkip[]; note?: string }
  | { dryRun: false; updated: DefaultBranchChange[]; skipped: DefaultBranchSkip[]; failed: Array<{ id: number; name: string; error: string }> };
```

- [ ] **Step 1: Failing tests** (fixtures: def 1 `{ id: 1, name: 'api-ci', revision: 7, repository: { defaultBranch: 'refs/heads/master' }, variables: { token: { isSecret: true, value: undefined }, env: { value: 'x' } } }`, def 2 `{ id: 2, name: 'web-ci', repository: { defaultBranch: 'refs/heads/main' } }`, def 3 `{ id: 3, name: 'no-repo' }`):
  1. dry run by default with `definitionIds: [1,2,3], toBranch: 'main'` → `changes: [{ id: 1, name: 'api-ci', current: 'master', next: 'main' }]`, `skipped` has 2 (`already on main`) and 3 (`definition has no repository`); `getPipelineDefUpdates()` empty.
  2. reads `repository.defaultBranch`, not a top-level field: a def with top-level `defaultBranch: 'master'` cast in but `repository.defaultBranch: 'refs/heads/main'` is skipped as already on main.
  3. `fromBranch: 'develop'` → def 1 skipped with `reason: "defaultBranch is 'master', not 'develop'"`; result has `note` matching `/0 definitions to change.*current values: master, main/`.
  4. `dryRun: false` → one update for def 1 with `definition.repository.defaultBranch === 'refs/heads/main'`, `definition.revision === 7`, and `definition.variables.token` still `{ isSecret: true }` (secret preserved — whole GET body sent back).
  5. `dryRun: false` where `updatePipelineDefinition` is injected to throw `new AdoConflictError('stale')` → `failed: [{ id: 1, name: 'api-ci', error: /stale/ }]`, no throw.
  6. neither `repository` nor `definitionIds` → rejects `/provide `repository` or `definitionIds`/`.
  7. `repository: 'R'` → uses `listRepositories` → id `rid`, then `listPipelines` (fake returns `setPipelines('P', [ {id:1}, {id:2} ])`), then fetches each definition.
  8. `toBranch: 'refs/heads/main'` identical to `'main'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** in `writeService.ts` (reuse existing `ensureRefsHeads`):

```ts
  async setDefaultBranch(args: {
    project: string;
    repository?: string;
    fromBranch?: string;
    toBranch: string;
    definitionIds?: number[];
    dryRun?: boolean;
  }): Promise<SetPipelineDefaultBranchResult> {
    const ids = await this.candidateIds(args);
    const to = ensureRefsHeads(args.toBranch) as string;
    const from = ensureRefsHeads(args.fromBranch);
    const changes: Array<DefaultBranchChange & { definition: BuildDefinition }> = [];
    const skipped: DefaultBranchSkip[] = [];
    const seen = new Set<string>();

    for (const id of ids) {
      const definition = await this.client.getPipelineDefinition({ project: args.project, definitionId: id });
      const name = definition.name ?? String(id);
      const currentRef = definition.repository?.defaultBranch;
      const current = currentRef ? shortRef(currentRef) : undefined;
      if (current) {
        seen.add(current);
      }
      if (!definition.repository) {
        skipped.push({ id, name, reason: 'definition has no repository' });
      }
      else if (from && ensureRefsHeads(currentRef) !== from) {
        skipped.push({ id, name, current, reason: `defaultBranch is '${current ?? '(unset)'}', not '${shortRef(from)}'` });
      }
      else if (ensureRefsHeads(currentRef) === to) {
        skipped.push({ id, name, current, reason: `already on ${shortRef(to)}` });
      }
      else {
        changes.push({ id, name, current, next: shortRef(to), definition });
      }
    }

    const strip = ({ definition: _d, ...c }: DefaultBranchChange & { definition: BuildDefinition }): DefaultBranchChange => c;

    if (args.dryRun ?? true) {
      return {
        dryRun: true,
        changes: changes.map(strip),
        skipped,
        ...(changes.length === 0
          ? { note: `0 definitions to change out of ${ids.length}; current values: ${[...seen].join(', ') || '(none)'}.` }
          : {}),
      };
    }

    const updated: DefaultBranchChange[] = [];
    const failed: Array<{ id: number; name: string; error: string }> = [];
    for (const change of changes) {
      try {
        await this.client.updatePipelineDefinition({
          project: args.project,
          definitionId: change.id,
          definition: { ...change.definition, repository: { ...change.definition.repository, defaultBranch: to } },
        });
        updated.push(strip(change));
      }
      catch (err) {
        failed.push({ id: change.id, name: change.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { dryRun: false, updated, skipped, failed };
  }

  private async candidateIds(args: { project: string; repository?: string; definitionIds?: number[] }): Promise<number[]> {
    if (args.definitionIds?.length) {
      return args.definitionIds;
    }
    if (!args.repository) {
      throw new Error('set_pipeline_default_branch: provide `repository` or `definitionIds` (no project-wide sweeps).');
    }
    const repos = await this.client.listRepositories({ project: args.project });
    const repo = repos.find(r => r.name?.toLowerCase() === args.repository?.toLowerCase());
    if (!repo?.id) {
      throw new Error(`set_pipeline_default_branch: repository '${args.repository}' not found in project '${args.project}'.`);
    }
    const defs = await this.client.listPipelines({ project: args.project, repositoryId: repo.id, repositoryType: 'TfsGit' });
    return defs.flatMap(d => (d.id === undefined ? [] : [d.id]));
  }
```
with module helper `function shortRef(ref: string): string { return ref.replace(/^refs\/heads\//, ''); }`. Definitions are fetched sequentially on purpose (on-prem servers throttle; 109 GETs is fine).

Schema `SetPipelineDefaultBranchInput`:
```ts
export const SetPipelineDefaultBranchInput = {
  project: z.string().min(1).describe('ADO project name.'),
  repository: z.string().min(1).optional().describe('Repository name — targets every pipeline built from it. Required unless definitionIds is given.'),
  definitionIds: z.array(z.number().int().positive()).min(1).max(500).optional().describe('Explicit pipeline definition ids.'),
  fromBranch: z.string().min(1).optional().describe('Only change pipelines whose default branch is currently this (e.g. \'master\').'),
  toBranch: z.string().min(1).describe('New default branch (e.g. \'main\').'),
  dryRun: z.boolean().optional().describe('Default true: report what would change without writing. Set false to apply.'),
};
```

Tool `set_pipeline_default_branch`, title `'Set the default branch on pipeline definitions (bulk)'`, description: `'**Always confirm with the user before calling with dryRun: false — this changes the default branch every future manual/scheduled run uses.** Always run with dryRun (the default) first and show the user the change list. Targets all pipelines for `repository`, or explicit `definitionIds`; `fromBranch` limits to pipelines currently on that branch. Applies one definition at a time and reports updated / skipped / failed; one failure does not stop the rest. Secret variables are preserved.'`

registerTools.test: `FULL_TOOL_COUNT = 60`; add `'set_pipeline_default_branch'` to `FULL_ONLY_NAMES`.

- [ ] **Step 4:** Run → PASS; `pnpm test`.
- [ ] **Step 5:** lint/typecheck; `git commit -am "feat(phase-7b): set_pipeline_default_branch with dry run"`

### Task 11: `retention` domain — reads (`list_build_leases`, `find_build_retainers`)

**Files:**
- Modify: `src/ado/types.ts` (export `RetentionLease`), `src/ado/client.ts`, `src/ado/sdkClient.ts`, `test/fakes/FakeAdoClient.ts`
- Create: `src/domains/retention/readService.ts`, `readTools.ts`, `schemas.ts`
- Modify: `src/mcp/registerTools.ts`, `test/unit/mcp/registerTools.test.ts`
- Test: `test/unit/domains/retention/readService.test.ts`

**Interfaces:**
- Produces:
  - `AdoClient.listBuildLeases(args: { project: string; buildId: number }): Promise<RetentionLease[]>`
  - `AdoClient.listReleaseDefinitionsWithArtifacts(args: { project: string }): Promise<ReleaseDefinition[]>` (all pages)
  - Fake: `setBuildLeases(project, buildId, leases)`, `setReleaseDefinitionsWithArtifacts(project, defs)`.
  - `export type LeaseOwnerType = 'RM' | 'Pipeline' | 'Branch' | 'User' | 'other'`; `export interface LeaseSummary { leaseId: number; ownerId: string; ownerType: LeaseOwnerType; definitionId?: number; runId?: number; validUntil?: string; protectPipeline: boolean; createdOn?: string }`; `export function shapeLease(l: RetentionLease): LeaseSummary` — reused by Task 12.
  - `RetentionReadService.listBuildLeases({ project, buildId })`, `.findBuildRetainers({ project, buildDefinitionId })`.

- [ ] **Step 1: Failing tests:**
  - leases with ownerIds `'RM:3:12'`, `'Pipeline:7'`, `'Branch:repo:refs/heads/main'`, `'User:1b2c…'`, `'Something'` → ownerTypes `RM, Pipeline, Branch, User, other`; `validUntil` ISO string; `protectPipeline` defaults to `false` when absent.
  - release defs: def 50 with artifacts `[{ type: 'Build', alias: '_api', isPrimary: true, definitionReference: { definition: { id: '7', name: 'api' } } }]`, def 76 with `[{ type: 'Build', alias: '_old', definitionReference: { definition: { id: '7' } } }, { type: 'Git', alias: '_src', definitionReference: { definition: { id: '7' } } }]`, def 80 with a Build artifact for definition `'8'` → `findBuildRetainers({ project: 'P', buildDefinitionId: 7 })` returns `[{ releaseDefinitionId: 50, name: …, artifactAlias: '_api', isPrimary: true }, { releaseDefinitionId: 76, name: …, artifactAlias: '_old', isPrimary: false }]` (the Git artifact with id 7 is ignored).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**

`sdkClient.ts`:
```ts
  async listBuildLeases(args: { project: string; buildId: number }): Promise<RetentionLease[]> {
    try {
      const build = await this.api.getBuildApi();
      return await build.getRetentionLeasesForBuild(args.project, args.buildId);
    }
    catch (err) {
      if (err instanceof AdoError) {
        throw err;
      }
      throw mapSdkError(err);
    }
  }

  async listReleaseDefinitionsWithArtifacts(args: { project: string }): Promise<ReleaseDefinition[]> {
    try {
      const rel = await this.api.getReleaseApi();
      const all: ReleaseDefinition[] = [];
      let continuationToken: string | undefined;
      do {
        const page = await rel.getReleaseDefinitions(
          args.project,
          undefined, // searchText
          ReleaseDefinitionExpands.Artifacts,
          undefined, // artifactType
          undefined, // artifactSourceId
          undefined, // top
          continuationToken,
        );
        all.push(...page);
        continuationToken = page.continuationToken || undefined;
      } while (continuationToken);
      return all;
    }
    catch (err) {
      if (err instanceof AdoError) {
        throw err;
      }
      throw mapSdkError(err);
    }
  }
```
Add `ReleaseDefinitionExpands` as a value export in `types.ts` next to `ReleaseDefinitionSource`. Verify `PagedList` exposes `continuationToken` in `node_modules/azure-devops-node-api/interfaces/common/VSSInterfaces.d.ts`; if not typed, read it via `(page as { continuationToken?: string }).continuationToken` with a comment.

`readService.ts`:
```ts
const OWNER_PREFIXES = ['RM', 'Pipeline', 'Branch', 'User'] as const;

export function shapeLease(l: RetentionLease): LeaseSummary {
  const ownerId = l.ownerId ?? '';
  const prefix = ownerId.split(':')[0] ?? '';
  const ownerType = (OWNER_PREFIXES as readonly string[]).includes(prefix) ? (prefix as LeaseOwnerType) : 'other';
  return {
    leaseId: l.leaseId ?? 0,
    ownerId,
    ownerType,
    definitionId: l.definitionId,
    runId: l.runId,
    validUntil: l.validUntil?.toISOString(),
    protectPipeline: l.protectPipeline ?? false,
    createdOn: l.createdOn?.toISOString(),
  };
}

export class RetentionReadService {
  constructor(private readonly client: AdoClient) {}

  async listBuildLeases(args: { project: string; buildId: number }): Promise<LeaseSummary[]> {
    return (await this.client.listBuildLeases(args)).map(shapeLease);
  }

  async findBuildRetainers(args: { project: string; buildDefinitionId: number }): Promise<BuildRetainer[]> {
    const defs = await this.client.listReleaseDefinitionsWithArtifacts({ project: args.project });
    const wanted = String(args.buildDefinitionId);
    return defs.flatMap(def =>
      (def.artifacts ?? [])
        .filter(a => a.type === 'Build' && a.definitionReference?.definition?.id === wanted)
        .map(a => ({
          releaseDefinitionId: def.id ?? 0,
          name: def.name ?? '',
          artifactAlias: a.alias ?? '',
          isPrimary: a.isPrimary ?? false,
        })),
    );
  }
}
```

Tools:
- `list_build_leases` — `'Lists the retention leases on a build — why it cannot be deleted. ownerType: RM (a classic release), Pipeline (pipeline retention), Branch (branch retention policy), User (manual "retain"), other. protectPipeline: true also blocks deleting the pipeline definition. Remove a lease with delete_build_lease.'`
- `find_build_retainers` — `'Finds classic release definitions that still use a build definition as a Build artifact — they keep its builds retained. Scans every release definition in the project.'`
Schemas: `{ project: z.string().min(1), buildId: z.number().int().positive() }`, `{ project: z.string().min(1), buildDefinitionId: z.number().int().positive() }`.

registerTools: add `...buildRetentionReadTools(new RetentionReadService(client))` to `readTools`. Test: `FULL_TOOL_COUNT = 62`, `READ_ONLY_TOOL_COUNT = 26`.

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** lint/typecheck; `git commit -am "feat(phase-7b): retention domain — list_build_leases, find_build_retainers"`

### Task 12: `delete_build_lease`

**Files:**
- Modify: `src/ado/client.ts`, `src/ado/sdkClient.ts`, `test/fakes/FakeAdoClient.ts`
- Create: `src/domains/retention/writeService.ts`, `writeTools.ts`; modify `schemas.ts`
- Modify: `src/mcp/registerTools.ts`, `test/unit/mcp/registerTools.test.ts`
- Test: `test/unit/domains/retention/writeService.test.ts`

**Interfaces:**
- Consumes: `AdoClient.listBuildLeases`, `shapeLease`, `LeaseSummary` from `./readService.js`.
- Produces: `AdoClient.deleteRetentionLeases(args: { project: string; leaseIds: number[] }): Promise<void>`; fake `getDeletedLeaseIds()`; `RetentionWriteService.deleteBuildLease(args: { project; buildId; leaseId; force?: boolean }): Promise<{ deleted: true; lease: LeaseSummary }>`.

- [ ] **Step 1: Failing tests:**
  - lease 11 (`protectPipeline: false`, owner `'User:abc'`) on build 500 → `{ deleted: true, lease: { leaseId: 11, ownerType: 'User', … } }`, fake recorded `[11]`.
  - leaseId 99 not on build 500 → rejects `/lease 99 is not on build 500/`, nothing deleted.
  - lease 12 `protectPipeline: true`, owner `'Pipeline:7'`, no force → rejects `/protects the pipeline.*Pipeline:7.*force: true/`, nothing deleted.
  - same with `force: true` → deleted.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** SdkAdoClient `deleteRetentionLeases` → `build.deleteRetentionLeasesById(args.project, args.leaseIds)` with the AdoError guard.

```ts
export class RetentionWriteService {
  constructor(private readonly client: AdoClient) {}

  async deleteBuildLease(args: { project: string; buildId: number; leaseId: number; force?: boolean }): Promise<{ deleted: true; lease: LeaseSummary }> {
    const leases = (await this.client.listBuildLeases({ project: args.project, buildId: args.buildId })).map(shapeLease);
    const lease = leases.find(l => l.leaseId === args.leaseId);
    if (!lease) {
      throw new Error(
        `delete_build_lease: lease ${args.leaseId} is not on build ${args.buildId} `
        + `(leases there: ${leases.map(l => l.leaseId).join(', ') || 'none'}).`,
      );
    }
    if (lease.protectPipeline && !args.force) {
      throw new Error(
        `delete_build_lease: lease ${lease.leaseId} (owner ${lease.ownerId}) protects the pipeline. `
        + 'Confirm with the user, then retry with force: true.',
      );
    }
    await this.client.deleteRetentionLeases({ project: args.project, leaseIds: [lease.leaseId] });
    return { deleted: true, lease };
  }
}
```

Tool `delete_build_lease`, title `'Delete a retention lease from a build'`, description: `'**Always confirm with the user before calling — retention may be what keeps this build for audit or compliance, and deletion is irreversible.** Removes one lease (from list_build_leases) so the build can be cleaned up or its pipeline deleted. Refuses leases with protectPipeline: true unless force: true. Returns the deleted lease.'`; schema `{ project, buildId, leaseId: z.number().int().positive(), force: z.boolean().optional() }`.

registerTools: add `...buildRetentionWriteTools(new RetentionWriteService(client))` to `writeTools`. Test: `FULL_TOOL_COUNT = 63`; add `'delete_build_lease'` to `FULL_ONLY_NAMES`.

- [ ] **Step 4:** Run → PASS; `pnpm test`.
- [ ] **Step 5:** lint/typecheck; `git commit -am "feat(phase-7b): delete_build_lease with protectPipeline guard"`

### Task 13: 7b PAT scopes, live checks, docs, version, PR

- [ ] **Step 1: Live verification** (local `dist/` registered as an MCP server, absolute path): `list_build_leases` on a real build retained by a release → confirm the owner prefixes (`RM`, `Pipeline`, `Branch`, `User`); if the real prefix differs (e.g. `RM:` vs `Release:`), fix `OWNER_PREFIXES` and the Task 11 test. `set_pipeline_default_branch` dry run on a real repo → sensible `changes`. Do **not** run any write live without the user's explicit go-ahead.
- [ ] **Step 2: PAT scopes.** Verify what `updateRepository` needs (Microsoft Learn: Repositories – Update → scope). If it's `vso.code_manage` (Code: manage): add "Code (read, write, & manage)" to the full-mode line in `src/setup.ts`, the `AdoAuthError` message in `src/ado/errors.ts`, and the README table, plus a README sentence "The manage tier of Code is needed only by `set_default_branch`." Check lease endpoints need only Build (read & execute), already listed.
- [ ] **Step 3: Docs.** README: Read-tools rows for `list_build_leases`, `find_build_retainers`; Write-tools rows for `create_branch`, `set_default_branch`, `set_pipeline_default_branch`, `delete_build_lease`; a line that there is deliberately no `delete_branch`. ROADMAP: flip 7b to ✅ with tools table + key decisions (updateRefs success:false check → plain Error with the ADO status, dry-run-first bulk with note, whole-definition PUT, lease guards, client-side retainer scan, no delete_branch). Spec status → `7b shipped in v0.14.0`.
- [ ] **Step 4:** `package.json` → `0.14.0`. `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- [ ] **Step 5:** `git commit -am "docs(phase-7b): README, roadmap, PAT scopes; bump to 0.14.0"`; open the PR with `my-create-pr` (base `main`).
