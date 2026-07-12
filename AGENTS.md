# Project: azure-devops-mcp

MCP server for Azure DevOps (Server + Services). TypeScript + ESM (NodeNext) on Node ≥20. Published to npm as `@vasekzdvihal/azure-devops-mcp`.

## Commands
- pnpm (pinned via `packageManager`). `.nvmrc` is 22 for local dev, but `engines` stays `>=20` on purpose — published package; raising it is a breaking change for consumers. Lint itself needs Node ≥22 (eslint-plugin-unicorn uses iterator helpers), so CI lints on 22 only.
- `pnpm run setup` — runs `tsx src/index.ts setup`, NOT `tsx src/setup.ts` (the entry point invokes `runSetup()`). Must be `pnpm run setup`; bare `pnpm setup` is pnpm's own built-in command.
- `pnpm typecheck` — `tsc --noEmit` only checks `src/` (`rootDir: "src"`). A clean typecheck does NOT mean `test/` is correct; the runtime test pass is the actual signal.
- `pnpm test` — vitest, compiles tests separately.

## Code style
- Style is enforced by `@vasekzdvihal/eslint-config` (`pnpm lint:fix` auto-fixes). Follow the configured rules; don't override or disable them. A pre-commit hook (husky + lint-staged) blocks commits with unfixable errors.
- **Relative imports require `.js` extension** even though source is `.ts` (NodeNext): `import { foo } from "./bar.js"`.
- No `any`. `noUncheckedIndexedAccess` is on — narrow with `??` fallbacks.
- SDK type re-exports go through `src/ado/types.ts`. Domains never import `azure-devops-node-api/interfaces/...` directly.

## Architecture
- **Layered import rule:** `domains/*` may import from `ado/`, `config/`, `git/`. `domains/*` MUST NOT import from another `domains/*`. `ado/`, `config/`, `git/` MUST NOT import from `domains/`.
- **Feature-first folders.** Each domain folder owns its feature end-to-end: `readService.ts`, `writeService.ts`, `readTools.ts`, `writeTools.ts`, `schemas.ts`, helpers — all together. No parallel `tools/` / `services/` / `helpers/` hierarchies.
- **`AdoError` preservation in `SdkAdoClient`** — every `try/catch` must guard before mapping:
  ```ts
  } catch (err) {
    if (err instanceof AdoError) throw err;
    throw mapSdkError(err);
  }
  ```
  Without the guard, typed errors thrown inside the try get re-mapped and downgraded to `AdoUnknownError`. We've shipped this bug once already.
- **Read-only mode:** `AZURE_DEVOPS_READ_ONLY=true` makes `registerAllTools` skip writeTools entirely. PAT scope is the real security boundary; the env var is the ergonomic layer.
- **Don't touch `socketTimeout: 15_000` or the `https.globalAgent` CA mutation** in `SdkAdoClient` — both exist for on-prem reliability (firewalls drop packets; SDK has no per-request CA hook).

## Gotchas
- New ADO API surface → update PAT scope in **3 places**: `src/setup.ts` (wizard copy), `src/ado/errors.ts` (auth-failure hint), `README.md` (Required PAT scopes table).
- For local dev, point Claude Code at the absolute path of `dist/index.js` in your worktree — the `npx -y @scope/...` snippet only works post-publish.
- MCP server config goes in `~/.claude.json` under `mcpServers`, NOT `~/.claude/settings.json`.
- `release.yml` uses `npm publish` deliberately (npm provenance; `pnpm publish` fails git checks on a tag's detached HEAD) — don't convert it to pnpm.

## Workflow
- Follows the `superpowers:*` skills: `brainstorming` → `writing-plans` → `using-git-worktrees` (in `.worktrees/<branch>/`) → `subagent-driven-development` → `finishing-a-development-branch`.
- Design spec: `docs/superpowers/specs/2026-04-21-azure-devops-mcp-design.md` — source of truth, update at every checkpoint.
- Per-phase plans: `docs/superpowers/plans/<date>-azure-devops-mcp-phase-N.md`.
- Phase status: `docs/ROADMAP.md`. Bump `package.json` version per phase.
- IMPORTANT: when picking up mid-stream, read ROADMAP first, then the most recent plan, then the relevant spec section. Don't reinvent design decisions.
