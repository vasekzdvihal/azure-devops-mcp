# CLAUDE.md

Project-specific instructions for any Claude (or other AI agent) working in this repository. Read this in full before doing anything beyond a one-shot question.

## What this is

A public, generic **MCP server for Azure DevOps**. Exposes read + write PR review tools to Claude Code and other MCP hosts. Supports both **Azure DevOps Server** (on-prem) and **Azure DevOps Services** (cloud) behind one config. Distributed via npm as `@vasekzdvihal/azure-devops-mcp`. MIT-licensed, public on GitHub at `vasekzdvihal/azure-devops-mcp`.

The deeper "why" of every architectural choice lives in the design spec (path below). This file is the on-ramp.

## Where things live

| Path | Contents |
| --- | --- |
| `docs/superpowers/specs/2026-04-21-azure-devops-mcp-design.md` | The design spec. Source of truth for cross-phase architecture and decisions. Updated at every checkpoint. |
| `docs/superpowers/plans/<date>-azure-devops-mcp-phase-N.md` | One implementation plan per phase. Bite-sized tasks; written before coding, executed by subagents. |
| `docs/ROADMAP.md` | Phase status (Done / Planned / Idea), order, and rationale for deferrals. |
| `README.md` | User-facing — install, setup, tool catalog, troubleshooting. |
| `src/` | Production code. Domain-first layout under `src/domains/`. |
| `test/` | Vitest unit tests. Fakes in `test/fakes/`. |
| `dist/` | Compiled output (gitignored). |

When making non-trivial design changes, update the spec. When planning new work, write a plan file. When phase status changes, update ROADMAP.

## Tech stack

- TypeScript on Node ≥ 20, ESM (`"type": "module"`), NodeNext module resolution
- `@modelcontextprotocol/sdk` (MCP server, stdio transport)
- `azure-devops-node-api` (the official Microsoft SDK; behind our `AdoClient` interface)
- `@napi-rs/keyring` (PAT in OS keyring)
- `zod` (input validation + config schema)
- `@inquirer/prompts` (interactive setup wizard)
- `diff` (synthesizes per-file unified diffs client-side)
- `vitest` (unit tests)

No new dependency without consciously adding one.

## Architecture, in one minute

```
src/
├── index.ts           # MCP server entry; loads config+PAT, registers tools, starts stdio
├── setup.ts           # interactive wizard (URL + PAT + optional CA bundle)
├── config/            # XDG paths, config.json (0600), OS keyring, AZURE_DEVOPS_READ_ONLY env var
├── git/               # parseRemoteUrl + detectRepo for cwd auto-detection
├── ado/               # AdoClient interface (the seam) + SdkAdoClient impl + AdoError taxonomy
├── domains/
│   ├── identity/
│   ├── projects/
│   ├── repositories/
│   └── pullRequests/  # readService.ts + writeService.ts, shared repoResolution.ts
└── mcp/               # registerTools.ts (composition root) + errorBoundary.ts
```

Layered dependency rule: `domains/*` may import from `ado/`, `config/`, `git/`. `domains/*` MUST NOT import from another `domains/*`. `ado/`, `config/`, `git/` MUST NOT import from `domains/`.

## Conventions that bite

These are NOT optional — every PR will be reviewed against them.

### TypeScript / ESM

- **Relative imports require `.js` extension** even though source is `.ts`. NodeNext resolution. Example: `import { foo } from "./bar.js"` resolves `./bar.ts` at compile and `./bar.js` at runtime.
- **No `any`.** Strict TS. `noUncheckedIndexedAccess` is on — narrow with `??` fallbacks.
- SDK type re-exports go through `src/ado/types.ts`. Domains never import from `azure-devops-node-api/interfaces/...` directly.

### `AdoError` preservation pattern in `SdkAdoClient`

Every `try/catch` in `SdkAdoClient` must look like this:

```ts
try {
  // SDK call(s); may throw raw SDK errors OR our typed AdoErrors (if the try synthesizes them)
} catch (err) {
  if (err instanceof AdoError) throw err;   // preserve typed errors as-is
  throw mapSdkError(err);                    // map only raw SDK errors
}
```

Without the `instanceof AdoError` guard, an `AdoNotFoundError` thrown inside the try gets re-mapped by `mapSdkError`, which has no `statusCode` to inspect on it, and downgrades to `AdoUnknownError`. We've already had this bug; the guard is the fix.

### TDD for things that have logic

- Pure functions with branching → TDD (failing test first).
- Domain services → TDD via `FakeAdoClient`.
- The error mapper → TDD per status/code branch.
- Mechanical scaffolding (re-exports, interface signatures, tool definitions, setup wizard prompts) → no test required, just typecheck + manual end-to-end.

### Domain organization (feature-first)

Each domain folder owns its feature end-to-end. For `pullRequests/`: `readService.ts`, `writeService.ts`, `readTools.ts`, `writeTools.ts`, `schemas.ts`, `repoResolution.ts`, `diffShaper.ts` all live together. Don't split by technical role across folders (no `tools/`, `services/`, `helpers/` parallel hierarchies).

### Tool naming

Short, unprefixed (`whoami`, `list_pull_requests`, `add_pull_request_comment`). MCP hosts namespace tools as `mcp__<server>__<tool>` already; an in-server prefix is redundant. Discoverability lives in tool *descriptions*, not names. Avoid bare names that collide with other common MCP servers (e.g. `list_projects` is generic but currently kept; revisit if false-routing becomes a problem).

### Read-only mode

`AZURE_DEVOPS_READ_ONLY=true` env var → `registerAllTools` skips the writeTools array entirely. Write tools don't appear on the LLM's tool surface, period. PAT scope is the actual security guarantee; the env var is the ergonomic layer for users with broad-scope PATs who want Claude restricted.

## Workflow we use

This project follows the Anthropic "superpowers" workflow skills throughout:

1. **`superpowers:brainstorming`** before any new feature — produces a spec section, locks decisions.
2. **`superpowers:writing-plans`** before any implementation — produces a per-phase plan with bite-sized TDD tasks.
3. **`superpowers:using-git-worktrees`** to develop each phase in `.worktrees/<branch-name>/` (kept out of main repo).
4. **`superpowers:subagent-driven-development`** to execute the plan — fresh subagent per task, two-stage review (spec compliance → code quality) on tasks with real logic, inline review for trivial scaffolding.
5. **`superpowers:finishing-a-development-branch`** to merge / open PR / clean up.

If you're picking up where a previous Claude left off, check ROADMAP.md for current phase status, then read the most recent plan file in `docs/superpowers/plans/`. Don't reinvent design decisions — read the spec first.

## Common gotchas (from real session experience)

- **`npm run setup` MUST be `tsx src/index.ts setup`**, not `tsx src/setup.ts`. The setup module exports `runSetup()` but only the entry point invokes it.
- **MCP server config goes in `~/.claude.json` under `mcpServers`**, NOT `~/.claude/settings.json`. Different files, only the former is read by Claude Code's MCP loader.
- **For local dev, point Claude Code at the absolute path of `dist/index.js`** in the worktree you're working in (e.g. `/Users/<you>/source/GitHub/azure-mcp/.worktrees/phase-X-/dist/index.js`). The `npx -y @scope/...` snippet the wizard prints is the post-publish path; it doesn't work before publish.
- **`socketTimeout: 15_000` on `WebApi`** — typed-rest-client defaults to 3 minutes, way too long for a CLI tool when a firewall silently drops packets. Don't remove this.
- **`https.globalAgent` mutation** in `SdkAdoClient` constructor when `caBundlePath` is set — required because `azure-devops-node-api` doesn't expose a per-request hook for an extra CA. Single ADO instance per process, so safe.
- **The `diff` v9 package ships its own TypeScript types** — no need for `@types/diff`.
- **`tsconfig.json` has `rootDir: "src"`**, so `tsc --noEmit` does not typecheck `test/`. Vitest compiles tests separately. A clean typecheck does NOT mean test-side code is correct; the runtime test pass is the actual signal.

## Versions and releases

- One npm version per phase. v0.1.x was Phase 1, v0.2.x is Phase 2. Bump in `package.json` as part of the phase's final task; tag at publish time.
- Not yet published to npm (`prepublishOnly` script + extra `package.json` metadata is a planned Phase 1.6 — see ROADMAP).
- `LICENSE` is MIT (matches `package.json`).

## Quick commands

```bash
npm install
npm test            # unit tests (currently 90)
npm run typecheck   # TypeScript check (src/ only)
npm run build       # compile to dist/
npm run dev         # run server from source via tsx
npm run setup       # run setup wizard from source
```

## When in doubt

1. Read the spec section that's relevant (`docs/superpowers/specs/...`).
2. Read the most recent plan to see how the last similar problem was approached.
3. If still unsure, ask the user — don't guess on architecture.
