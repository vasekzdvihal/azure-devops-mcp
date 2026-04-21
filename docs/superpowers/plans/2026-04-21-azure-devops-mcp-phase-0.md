# Azure DevOps MCP — Phase 0 (Walking Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the smallest end-to-end MCP server that exposes a single `whoami` tool against Azure DevOps, with full setup wizard, OS-keyring PAT storage, JSON config file, TLS-aware SDK client, and the entire layered architecture in place — so that the user can wire it into Claude Code, run `whoami`, validate the shape, and feed corrections into the spec before Phase 1.

**Architecture:** TypeScript on Node.js ≥20, ESM, stdio MCP transport. Domain-first folder layout under `src/domains/`. ADO calls go through an `AdoClient` interface (the seam) — Phase 0 implements only `whoami`. Tests use Vitest with a `FakeAdoClient` injected into services; no network in unit tests.

**Tech Stack:** `@modelcontextprotocol/sdk` (1.29.x), `azure-devops-node-api` (15.x), `@napi-rs/keyring` (1.2.x), `zod` (4.x), `@inquirer/prompts` (8.x), `vitest` (4.x), `tsx` (dev runner), `typescript` (5.7+).

**Spec reference:** `docs/superpowers/specs/2026-04-21-azure-devops-mcp-design.md` — Phase 0 section.

---

## File map for Phase 0

Each file's responsibility, listed in dependency order. No file does more than one thing.

```
azure-mcp/
├── package.json                              # bin: { azure-devops-mcp: dist/index.js }, scripts, deps
├── tsconfig.json                             # strict, ES2022, Node module, declaration off
├── vitest.config.ts                          # test config; node env
├── .gitignore                                # node_modules, dist, .env, etc.
├── README.md                                 # install, setup, Claude Code config
│
├── src/
│   ├── index.ts                              # MCP server entry; loads config+PAT, registers tools, starts stdio
│   ├── setup.ts                              # CLI wizard entry; "azure-devops-mcp setup"
│   │
│   ├── config/
│   │   ├── paths.ts                          # XDG-style paths (~/.config/azure-devops-mcp/config.json)
│   │   ├── schema.ts                         # zod schema for Config { baseUrl, kind, caBundlePath? }
│   │   ├── configFile.ts                     # readConfig() / writeConfig() with 0600 perms
│   │   └── keyring.ts                        # getPat(account) / setPat(account, pat) / deletePat(account)
│   │
│   ├── ado/
│   │   ├── types.ts                          # re-export SDK types we expose (IdentityRef, etc.)
│   │   ├── errors.ts                         # AdoError taxonomy + mapSdkError(unknown) → AdoError
│   │   ├── tlsAgent.ts                       # buildHttpsAgent(caBundlePath?) → https.Agent | undefined
│   │   ├── client.ts                         # AdoClient interface (Phase 0: whoami only)
│   │   └── sdkClient.ts                      # SdkAdoClient implements AdoClient via WebApi
│   │
│   ├── domains/
│   │   └── identity/
│   │       ├── service.ts                    # IdentityService (whoami business logic)
│   │       └── tools.ts                      # MCP tool definition for whoami
│   │
│   └── mcp/
│       ├── errorBoundary.ts                  # toToolResult(handler) wrapper; converts errors to MCP error result
│       └── registerTools.ts                  # composition root: build deps, register tools on McpServer
│
└── test/
    ├── fakes/
    │   └── FakeAdoClient.ts                  # in-memory AdoClient for unit tests
    │
    ├── unit/
    │   ├── ado/
    │   │   └── errors.test.ts                # error mapper coverage
    │   ├── config/
    │   │   ├── paths.test.ts                 # XDG resolution
    │   │   └── configFile.test.ts            # round-trip read/write with tmpdir
    │   ├── domains/
    │   │   └── identity/
    │   │       └── service.test.ts           # whoami service with FakeAdoClient
    │   └── mcp/
    │       └── errorBoundary.test.ts         # error → MCP result mapping
```

Out-of-scope reminder: `git/`, `parseRemoteUrl.ts`, `diffShaper.ts`, contract tests, and all PR/projects/repositories domains are **Phase 1**. Do not create those files in Phase 0.

---

## Conventions

- **Commit after every task** with the message shown in the task. One task = one commit. Do not batch commits across tasks.
- **TDD where it has logic.** Tasks 6, 8, 12, 14, 16 are TDD (write failing test → run → implement → run → commit). Other tasks are scaffolding or pass-through code; tests would be ceremony, not value.
- **All code is ESM** (`"type": "module"` in package.json). Use `.js` in import specifiers for relative imports (TS-quirk: even though source files are `.ts`, ESM resolution requires `.js` extension on imports). Example: `import { foo } from "./bar.js"`.
- **No `any`.** Strict TS. If you need an unknown shape, use `unknown` and narrow.
- **Run from `/Users/vasekzdvihal/source/GitHub/azure-mcp`** for all `npm` and `git` commands.

---

## Task 1: Project bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/index.ts` (placeholder so `npm run build` works)

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
.env
.env.*
*.log
.DS_Store
coverage/
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "@vasekzdvihal/azure-devops-mcp",
  "version": "0.0.1",
  "description": "MCP server for Azure DevOps (Server and Services) — read-only PR workflows.",
  "license": "MIT",
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "bin": {
    "azure-devops-mcp": "dist/index.js"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/index.ts",
    "setup": "tsx src/setup.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@inquirer/prompts": "^8.4.2",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@napi-rs/keyring": "^1.2.0",
    "azure-devops-node-api": "^15.1.2",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.4"
  }
}
```

> **Note:** scope `@vasekzdvihal/` is a placeholder you can change before publishing — pick whatever scope you actually own on npm. The scope appears in three places: `package.json` `name`, README, and the Claude Code config snippet.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
    },
  },
});
```

- [ ] **Step 5: Create placeholder `src/index.ts`**

```ts
// Phase 0 placeholder; replaced in Task 16.
console.error("azure-devops-mcp: not yet implemented");
process.exit(1);
```

- [ ] **Step 6: Install deps and verify build**

```bash
npm install
npm run build
```

Expected: install succeeds; `npm run build` exits 0; `dist/index.js` exists.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json vitest.config.ts src/index.ts
git commit -m "chore: bootstrap TypeScript ESM project with vitest"
```

---

## Task 2: `config/paths.ts` (XDG paths) — TDD

**Files:**
- Create: `test/unit/config/paths.test.ts`
- Create: `src/config/paths.ts`

XDG resolution: honor `XDG_CONFIG_HOME` if set, otherwise `~/.config`. The directory and file names are fixed (`azure-devops-mcp/config.json`).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/config/paths.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { configDir, configFilePath } from "../../../src/config/paths.js";
import os from "node:os";
import path from "node:path";

describe("config/paths", () => {
  const originalEnv = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalEnv;
  });

  it("uses ~/.config when XDG_CONFIG_HOME is unset", () => {
    expect(configDir()).toBe(path.join(os.homedir(), ".config", "azure-devops-mcp"));
  });

  it("honors XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-test";
    expect(configDir()).toBe("/tmp/xdg-test/azure-devops-mcp");
  });

  it("configFilePath joins configDir with config.json", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-test";
    expect(configFilePath()).toBe("/tmp/xdg-test/azure-devops-mcp/config.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/config/paths.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/config/paths.ts
import os from "node:os";
import path from "node:path";

const APP_DIR_NAME = "azure-devops-mcp";
const CONFIG_FILE_NAME = "config.json";

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, APP_DIR_NAME);
}

export function configFilePath(): string {
  return path.join(configDir(), CONFIG_FILE_NAME);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/config/paths.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config/paths.ts test/unit/config/paths.test.ts
git commit -m "feat(config): add XDG-aware config paths"
```

---

## Task 3: `config/schema.ts` (zod schema)

No test — schemas are declarative and exercised through `configFile.ts` tests.

**Files:**
- Create: `src/config/schema.ts`

- [ ] **Step 1: Implement**

```ts
// src/config/schema.ts
import { z } from "zod";

export const ConfigSchema = z.object({
  baseUrl: z.string().url(),
  kind: z.enum(["server", "services"]),
  caBundlePath: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/config/schema.ts
git commit -m "feat(config): add Config zod schema"
```

---

## Task 4: `config/configFile.ts` (read/write JSON, 0600 perms) — TDD

**Files:**
- Create: `test/unit/config/configFile.test.ts`
- Create: `src/config/configFile.ts`

The read function must throw a clear, typed error when missing — the server uses this to print the "run setup" message.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/config/configFile.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readConfig, writeConfig, ConfigNotFoundError } from "../../../src/config/configFile.js";

describe("config/configFile", () => {
  let tmpDir: string;
  const originalEnv = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ado-mcp-test-"));
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("throws ConfigNotFoundError when file does not exist", async () => {
    await expect(readConfig()).rejects.toBeInstanceOf(ConfigNotFoundError);
  });

  it("round-trips a valid config", async () => {
    const cfg = {
      baseUrl: "https://dev.azure.com/myorg",
      kind: "services" as const,
    };
    await writeConfig(cfg);
    const loaded = await readConfig();
    expect(loaded).toEqual(cfg);
  });

  it("writes file with mode 0600", async () => {
    await writeConfig({ baseUrl: "https://dev.azure.com/x", kind: "services" });
    const stat = await fs.stat(path.join(tmpDir, "azure-devops-mcp", "config.json"));
    // mask off file type bits, keep permission bits
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("validates schema on read (rejects garbage)", async () => {
    const dir = path.join(tmpDir, "azure-devops-mcp");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "config.json"), JSON.stringify({ wrong: "shape" }));
    await expect(readConfig()).rejects.toThrow(/baseUrl/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/config/configFile.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/config/configFile.ts
import fs from "node:fs/promises";
import path from "node:path";
import { ConfigSchema, type Config } from "./schema.js";
import { configDir, configFilePath } from "./paths.js";

export class ConfigNotFoundError extends Error {
  constructor() {
    super("Azure DevOps MCP config not found. Run: npx -y @vasekzdvihal/azure-devops-mcp setup");
    this.name = "ConfigNotFoundError";
  }
}

export async function readConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await fs.readFile(configFilePath(), "utf8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      throw new ConfigNotFoundError();
    }
    throw err;
  }
  const parsed = JSON.parse(raw);
  return ConfigSchema.parse(parsed);
}

export async function writeConfig(cfg: Config): Promise<void> {
  const validated = ConfigSchema.parse(cfg);
  await fs.mkdir(configDir(), { recursive: true });
  const tmp = configFilePath() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(validated, null, 2), { mode: 0o600 });
  await fs.rename(tmp, configFilePath());
  // rename can preserve old perms on some FS; enforce 0600 explicitly
  await fs.chmod(configFilePath(), 0o600);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/config/configFile.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config/configFile.ts test/unit/config/configFile.test.ts
git commit -m "feat(config): add read/write with 0600 perms and schema validation"
```

---

## Task 5: `config/keyring.ts` (PAT storage)

No unit test in Phase 0 — `@napi-rs/keyring` writes to the real OS keyring, which is brittle in CI and noisy in local test runs. Verified manually via the setup wizard end-to-end (Task 18).

**Files:**
- Create: `src/config/keyring.ts`

- [ ] **Step 1: Implement**

```ts
// src/config/keyring.ts
import { Entry } from "@napi-rs/keyring";

const SERVICE_NAME = "azure-devops-mcp";

export class PatNotFoundError extends Error {
  constructor(account: string) {
    super(`No PAT found in OS keyring for account "${account}". Run: npx -y @vasekzdvihal/azure-devops-mcp setup`);
    this.name = "PatNotFoundError";
  }
}

function entryFor(account: string): Entry {
  return new Entry(SERVICE_NAME, account);
}

export function setPat(account: string, pat: string): void {
  entryFor(account).setPassword(pat);
}

export function getPat(account: string): string {
  try {
    return entryFor(account).getPassword();
  } catch {
    // Keyring throws when no entry exists; we normalize to our typed error.
    throw new PatNotFoundError(account);
  }
}

export function deletePat(account: string): void {
  try {
    entryFor(account).deletePassword();
  } catch {
    // Idempotent: deleting a missing entry is fine.
  }
}

/**
 * The keyring "account" we use is the host of the configured baseUrl.
 * That way two ADO instances (e.g. on-prem + cloud) coexist without colliding.
 */
export function accountFromBaseUrl(baseUrl: string): string {
  return new URL(baseUrl).host;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/config/keyring.ts
git commit -m "feat(config): add OS keyring PAT storage"
```

---

## Task 6: `ado/errors.ts` (taxonomy + mapper) — TDD

**Files:**
- Create: `test/unit/ado/errors.test.ts`
- Create: `src/ado/errors.ts`

The mapper's job: take an `unknown` thrown from anywhere (SDK, fetch, our code) and return one of our typed errors with a friendly message.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/ado/errors.test.ts
import { describe, it, expect } from "vitest";
import {
  AdoAuthError,
  AdoNotFoundError,
  AdoNetworkError,
  AdoTlsError,
  AdoUnknownError,
  mapSdkError,
} from "../../../src/ado/errors.js";

describe("mapSdkError", () => {
  it("maps statusCode 401 to AdoAuthError", () => {
    const err = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    const mapped = mapSdkError(err);
    expect(mapped).toBeInstanceOf(AdoAuthError);
  });

  it("maps statusCode 403 to AdoAuthError", () => {
    const err = Object.assign(new Error("Forbidden"), { statusCode: 403 });
    expect(mapSdkError(err)).toBeInstanceOf(AdoAuthError);
  });

  it("maps statusCode 404 to AdoNotFoundError", () => {
    const err = Object.assign(new Error("Not found"), { statusCode: 404 });
    expect(mapSdkError(err)).toBeInstanceOf(AdoNotFoundError);
  });

  it("maps ECONNREFUSED to AdoNetworkError", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(mapSdkError(err)).toBeInstanceOf(AdoNetworkError);
  });

  it("maps ETIMEDOUT to AdoNetworkError", () => {
    const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    expect(mapSdkError(err)).toBeInstanceOf(AdoNetworkError);
  });

  it("maps ENOTFOUND to AdoNetworkError", () => {
    const err = Object.assign(new Error("DNS"), { code: "ENOTFOUND" });
    expect(mapSdkError(err)).toBeInstanceOf(AdoNetworkError);
  });

  it("maps UNABLE_TO_VERIFY_LEAF_SIGNATURE to AdoTlsError", () => {
    const err = Object.assign(new Error("tls"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
    expect(mapSdkError(err)).toBeInstanceOf(AdoTlsError);
  });

  it("maps SELF_SIGNED_CERT_IN_CHAIN to AdoTlsError", () => {
    const err = Object.assign(new Error("tls"), { code: "SELF_SIGNED_CERT_IN_CHAIN" });
    expect(mapSdkError(err)).toBeInstanceOf(AdoTlsError);
  });

  it("falls back to AdoUnknownError for unrecognized errors", () => {
    expect(mapSdkError(new Error("???"))).toBeInstanceOf(AdoUnknownError);
  });

  it("handles thrown non-Error values", () => {
    expect(mapSdkError("string error")).toBeInstanceOf(AdoUnknownError);
    expect(mapSdkError(undefined)).toBeInstanceOf(AdoUnknownError);
  });

  it("AdoAuthError carries a helpful message about scopes", () => {
    const mapped = mapSdkError(Object.assign(new Error("x"), { statusCode: 401 }));
    expect(mapped.message).toMatch(/PAT/i);
    expect(mapped.message).toMatch(/scope/i);
  });

  it("AdoTlsError mentions CA bundle config", () => {
    const mapped = mapSdkError(Object.assign(new Error("x"), { code: "SELF_SIGNED_CERT_IN_CHAIN" }));
    expect(mapped.message).toMatch(/CA bundle/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/ado/errors.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/ado/errors.ts
export abstract class AdoError extends Error {
  abstract readonly kind: string;
}

export class AdoAuthError extends AdoError {
  readonly kind = "auth";
  constructor(detail?: string) {
    super(
      "Authentication failed against Azure DevOps. " +
        "The PAT may be expired, revoked, or missing required scopes. " +
        "For read access to PRs, the PAT needs: Code (read), Identity (read)." +
        (detail ? ` Details: ${detail}` : ""),
    );
    this.name = "AdoAuthError";
  }
}

export class AdoNotFoundError extends AdoError {
  readonly kind = "not_found";
  constructor(detail?: string) {
    super("The requested Azure DevOps resource was not found." + (detail ? ` Details: ${detail}` : ""));
    this.name = "AdoNotFoundError";
  }
}

export class AdoNetworkError extends AdoError {
  readonly kind = "network";
  constructor(detail?: string) {
    super(
      "Could not reach Azure DevOps. Check the configured baseUrl and your network connectivity." +
        (detail ? ` Details: ${detail}` : ""),
    );
    this.name = "AdoNetworkError";
  }
}

export class AdoTlsError extends AdoError {
  readonly kind = "tls";
  constructor(detail?: string) {
    super(
      "TLS verification failed against Azure DevOps. " +
        "If your server uses an internal CA, set caBundlePath in the config (re-run setup)." +
        (detail ? ` Details: ${detail}` : ""),
    );
    this.name = "AdoTlsError";
  }
}

export class AdoUnknownError extends AdoError {
  readonly kind = "unknown";
  constructor(detail?: string) {
    super("Unexpected error from Azure DevOps." + (detail ? ` Details: ${detail}` : ""));
    this.name = "AdoUnknownError";
  }
}

interface SdkErrorShape {
  message?: string;
  statusCode?: number;
  code?: string;
}

function asSdkErrorShape(err: unknown): SdkErrorShape {
  if (err && typeof err === "object") return err as SdkErrorShape;
  return {};
}

export function mapSdkError(err: unknown): AdoError {
  const shape = asSdkErrorShape(err);
  const detail = shape.message;

  if (shape.statusCode === 401 || shape.statusCode === 403) {
    return new AdoAuthError(detail);
  }
  if (shape.statusCode === 404) {
    return new AdoNotFoundError(detail);
  }

  switch (shape.code) {
    case "ECONNREFUSED":
    case "ETIMEDOUT":
    case "ENOTFOUND":
    case "EHOSTUNREACH":
      return new AdoNetworkError(detail);
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      return new AdoTlsError(detail);
  }

  return new AdoUnknownError(detail);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/ado/errors.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ado/errors.ts test/unit/ado/errors.test.ts
git commit -m "feat(ado): add error taxonomy with SDK-error mapper"
```

---

## Task 7: `ado/tlsAgent.ts` (optional CA bundle)

No test — single small function with one branch; verified through manual setup runs.

**Files:**
- Create: `src/ado/tlsAgent.ts`

- [ ] **Step 1: Implement**

```ts
// src/ado/tlsAgent.ts
import https from "node:https";
import fs from "node:fs";
import tls from "node:tls";

/**
 * Returns an https.Agent honoring an optional extra CA bundle, or undefined when
 * no extra CA is needed (lets the SDK use its default agent and Node's system trust store).
 */
export function buildHttpsAgent(caBundlePath?: string): https.Agent | undefined {
  if (!caBundlePath) return undefined;
  const extraCa = fs.readFileSync(caBundlePath);
  // Append to system roots so private CAs work alongside public ones.
  const roots = [...tls.rootCertificates, extraCa.toString("utf8")];
  return new https.Agent({ ca: roots });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/ado/tlsAgent.ts
git commit -m "feat(ado): add HTTPS agent builder with optional CA bundle"
```

---

## Task 8: `ado/types.ts` (re-exports)

**Files:**
- Create: `src/ado/types.ts`

- [ ] **Step 1: Implement**

Re-export only the SDK types we expose at the `AdoClient` seam in Phase 0.

```ts
// src/ado/types.ts
// Re-exports of azure-devops-node-api types we expose at the AdoClient seam.
// Keeping a single import surface here means downstream files don't import from
// "azure-devops-node-api/interfaces/...".
export type { Identity } from "azure-devops-node-api/interfaces/IdentitiesInterfaces.js";
export type { ConnectionData } from "azure-devops-node-api/interfaces/LocationsInterfaces.js";
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/ado/types.ts
git commit -m "feat(ado): re-export SDK types used at the seam"
```

---

## Task 9: `ado/client.ts` (interface — Phase 0: whoami only)

**Files:**
- Create: `src/ado/client.ts`

- [ ] **Step 1: Implement**

```ts
// src/ado/client.ts
import type { Identity } from "./types.js";

/**
 * The AdoClient is the seam between our domain services and Azure DevOps.
 * Phase 0 exposes only whoami(). Phase 1 will extend this interface with
 * project/repo/PR methods.
 */
export interface AdoClient {
  /** Returns the identity the configured PAT belongs to. */
  whoami(): Promise<Identity>;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/ado/client.ts
git commit -m "feat(ado): add AdoClient interface (Phase 0: whoami)"
```

---

## Task 10: `ado/sdkClient.ts` (SDK-backed implementation)

No unit test — tested via the live setup wizard "test connection" step (Task 16) and by manual end-to-end (Task 18).

**Files:**
- Create: `src/ado/sdkClient.ts`

- [ ] **Step 1: Implement**

```ts
// src/ado/sdkClient.ts
import * as azdev from "azure-devops-node-api";
import https from "node:https";
import type { AdoClient } from "./client.js";
import type { Identity } from "./types.js";
import { mapSdkError, AdoUnknownError } from "./errors.js";
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

    this.api = new azdev.WebApi(opts.baseUrl, handler);
  }

  async whoami(): Promise<Identity> {
    try {
      const conn = await this.api.connect();
      const user = conn.authenticatedUser;
      if (!user) throw new AdoUnknownError("connect() returned no authenticatedUser");
      return user;
    } catch (err) {
      // Re-throw our own errors (already mapped) instead of double-wrapping.
      if (err instanceof AdoUnknownError) throw err;
      throw mapSdkError(err);
    }
  }
}
```

> **Note on TLS injection:** Setting `https.globalAgent` is the pragmatic way to inject a custom CA without forking the SDK. If Phase 1 surfaces a need to talk to multiple ADO instances in one process (or to non-ADO HTTPS endpoints with different trust requirements), we'll revisit — likely by setting `NODE_EXTRA_CA_CERTS` at a child-process boundary instead.

- [ ] **Step 2: Verify it compiles and builds**

```bash
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/ado/sdkClient.ts
git commit -m "feat(ado): add SDK-backed AdoClient with PAT auth and TLS injection"
```

---

## Task 11: `test/fakes/FakeAdoClient.ts`

No tests for the fake itself — its job is to be consumed by service tests.

**Files:**
- Create: `test/fakes/FakeAdoClient.ts`

- [ ] **Step 1: Implement**

```ts
// test/fakes/FakeAdoClient.ts
import type { AdoClient } from "../../src/ado/client.js";
import type { Identity } from "../../src/ado/types.js";

export interface FakeAdoClientState {
  whoamiResult?: Identity;
  whoamiError?: Error;
}

export class FakeAdoClient implements AdoClient {
  constructor(private state: FakeAdoClientState = {}) {}

  setWhoamiResult(identity: Identity): void {
    this.state = { whoamiResult: identity };
  }

  setWhoamiError(err: Error): void {
    this.state = { whoamiError: err };
  }

  async whoami(): Promise<Identity> {
    if (this.state.whoamiError) throw this.state.whoamiError;
    if (this.state.whoamiResult) return this.state.whoamiResult;
    throw new Error("FakeAdoClient.whoami: no result configured");
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

> Note: `tsconfig.json` has `rootDir: src`, so the test fakes won't be in the prod build. Vitest compiles tests independently and is fine with imports outside `rootDir`. If `tsc --noEmit` complains about the test files because they're outside `src/`, that's expected — `npm run typecheck` only runs against `src`. Vitest does its own TS handling for the `test/` tree.

- [ ] **Step 3: Commit**

```bash
git add test/fakes/FakeAdoClient.ts
git commit -m "test: add FakeAdoClient for service unit tests"
```

---

## Task 12: `domains/identity/service.ts` — TDD

**Files:**
- Create: `test/unit/domains/identity/service.test.ts`
- Create: `src/domains/identity/service.ts`

The service is thin: shape the SDK `Identity` into a small response object that's friendly for an LLM to read.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/domains/identity/service.test.ts
import { describe, it, expect } from "vitest";
import { IdentityService, type WhoamiResponse } from "../../../../src/domains/identity/service.js";
import { FakeAdoClient } from "../../../fakes/FakeAdoClient.js";
import type { Identity } from "../../../../src/ado/types.js";

describe("IdentityService.whoami", () => {
  it("returns a shaped response with id, displayName, and uniqueName", async () => {
    const fake = new FakeAdoClient();
    const identity: Partial<Identity> = {
      id: "abc-123",
      providerDisplayName: "Vasek Z.",
      properties: { Account: { $value: "vasek@example.com" } },
    };
    fake.setWhoamiResult(identity as Identity);

    const svc = new IdentityService(fake);
    const result: WhoamiResponse = await svc.whoami();

    expect(result.id).toBe("abc-123");
    expect(result.displayName).toBe("Vasek Z.");
    expect(result.account).toBe("vasek@example.com");
  });

  it("propagates errors from the AdoClient untouched", async () => {
    const fake = new FakeAdoClient();
    const err = new Error("boom");
    fake.setWhoamiError(err);

    const svc = new IdentityService(fake);
    await expect(svc.whoami()).rejects.toBe(err);
  });

  it("handles missing Account property gracefully", async () => {
    const fake = new FakeAdoClient();
    fake.setWhoamiResult({ id: "x", providerDisplayName: "Y" } as Identity);

    const svc = new IdentityService(fake);
    const result = await svc.whoami();
    expect(result.account).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/domains/identity/service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/domains/identity/service.ts
import type { AdoClient } from "../../ado/client.js";
import type { Identity } from "../../ado/types.js";

export interface WhoamiResponse {
  id: string;
  displayName?: string;
  account?: string;
}

export class IdentityService {
  constructor(private readonly client: AdoClient) {}

  async whoami(): Promise<WhoamiResponse> {
    const identity = await this.client.whoami();
    return shape(identity);
  }
}

function shape(identity: Identity): WhoamiResponse {
  const accountProp = identity.properties?.["Account"] as { $value?: string } | undefined;
  return {
    id: identity.id ?? "",
    displayName: identity.providerDisplayName,
    account: accountProp?.$value,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/domains/identity/service.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domains/identity/service.ts test/unit/domains/identity/service.test.ts
git commit -m "feat(identity): add IdentityService.whoami"
```

---

## Task 13: `domains/identity/tools.ts` (MCP tool definition)

**Files:**
- Create: `src/domains/identity/tools.ts`

This file describes the tool but does not register it with `McpServer` — that's the composition root's job (Task 15). Keeping the description here means the domain owns its tool's wire surface.

- [ ] **Step 1: Implement**

```ts
// src/domains/identity/tools.ts
import { z } from "zod";
import type { IdentityService } from "./service.js";

export interface ToolDefinition {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodRawShape;
  };
  // The handler returns a JSON-serializable payload; the MCP layer wraps it.
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export function buildIdentityTools(svc: IdentityService): ToolDefinition[] {
  return [
    {
      name: "whoami",
      config: {
        title: "Who am I?",
        description:
          "Returns the Azure DevOps identity associated with the configured PAT. " +
          "Use this to verify the connection or to learn the current user's id and display name.",
        inputSchema: {}, // no inputs
      },
      handler: async () => svc.whoami(),
    },
  ];
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/domains/identity/tools.ts
git commit -m "feat(identity): add MCP tool definition for whoami"
```

---

## Task 14: `mcp/errorBoundary.ts` — TDD

**Files:**
- Create: `test/unit/mcp/errorBoundary.test.ts`
- Create: `src/mcp/errorBoundary.ts`

This wraps a tool handler so that any thrown error becomes a friendly MCP error result instead of an unhandled rejection.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/mcp/errorBoundary.test.ts
import { describe, it, expect } from "vitest";
import { toToolResult } from "../../../src/mcp/errorBoundary.js";
import { AdoAuthError } from "../../../src/ado/errors.js";

describe("toToolResult", () => {
  it("wraps a successful handler return as a JSON content block", async () => {
    const wrapped = toToolResult(async () => ({ ok: true, count: 3 }));
    const result = await wrapped({});
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true, count: 3 }, null, 2) }]);
  });

  it("converts thrown AdoError to an MCP error result with friendly message", async () => {
    const wrapped = toToolResult(async () => {
      throw new AdoAuthError("token expired");
    });
    const result = await wrapped({});
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toMatch(/Authentication failed/);
    expect(result.content[0].text).toMatch(/token expired/);
  });

  it("converts non-AdoError exceptions to a generic error result", async () => {
    const wrapped = toToolResult(async () => {
      throw new Error("oh no");
    });
    const result = await wrapped({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/oh no/);
  });

  it("handles thrown non-Error values", async () => {
    const wrapped = toToolResult(async () => {
      throw "string thrown";
    });
    const result = await wrapped({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/string thrown/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/unit/mcp/errorBoundary.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/mcp/errorBoundary.ts
export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

export function toToolResult(handler: Handler): (args: Record<string, unknown>) => Promise<McpToolResult> {
  return async (args) => {
    try {
      const value = await handler(args);
      return {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Stack trace goes to stderr for debugging; user-facing message stays clean.
      if (err instanceof Error && err.stack) {
        process.stderr.write(`[azure-devops-mcp] tool error: ${err.stack}\n`);
      } else {
        process.stderr.write(`[azure-devops-mcp] tool error: ${message}\n`);
      }
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/unit/mcp/errorBoundary.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/errorBoundary.ts test/unit/mcp/errorBoundary.test.ts
git commit -m "feat(mcp): add error boundary wrapping handlers as MCP results"
```

---

## Task 15: `mcp/registerTools.ts` (composition root)

No test — this is wiring; verified by running the server end-to-end (Task 18).

**Files:**
- Create: `src/mcp/registerTools.ts`

- [ ] **Step 1: Implement**

```ts
// src/mcp/registerTools.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IdentityService } from "../domains/identity/service.js";
import { buildIdentityTools } from "../domains/identity/tools.js";
import { toToolResult } from "./errorBoundary.js";
import type { AdoClient } from "../ado/client.js";

/**
 * Wires domain services to AdoClient and registers all tools on the McpServer.
 * Phase 0: only the identity domain.
 */
export function registerAllTools(server: McpServer, client: AdoClient): void {
  const identityService = new IdentityService(client);
  const tools = [...buildIdentityTools(identityService)];

  for (const tool of tools) {
    server.registerTool(tool.name, tool.config, toToolResult(tool.handler));
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/registerTools.ts
git commit -m "feat(mcp): add composition root that registers all tools"
```

---

## Task 16: `src/setup.ts` (interactive wizard)

Tests are deliberately omitted — interactive prompts are hard to test in isolation; the wizard's connection-test step is its real correctness check, and Task 18 exercises the full path.

**Files:**
- Create: `src/setup.ts`

- [ ] **Step 1: Implement**

```ts
// src/setup.ts
import { input, password } from "@inquirer/prompts";
import { writeConfig } from "./config/configFile.js";
import { setPat, accountFromBaseUrl } from "./config/keyring.js";
import { SdkAdoClient } from "./ado/sdkClient.js";
import { configFilePath } from "./config/paths.js";
import type { Config } from "./config/schema.js";

export async function runSetup(): Promise<void> {
  process.stdout.write("\nAzure DevOps MCP — setup\n\n");

  // Loop: collect inputs, test connection, only write on success.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const baseUrl = await input({
      message: "ADO base URL (e.g. https://dev.azure.com/myorg or https://tfs.company.com/tfs/DefaultCollection):",
      validate: (v) => {
        try {
          new URL(v);
          return true;
        } catch {
          return "Must be a valid URL";
        }
      },
    });

    const pat = await password({
      message: "Personal Access Token (input hidden):",
      mask: "*",
      validate: (v) => v.length > 0 || "PAT cannot be empty",
    });

    const caBundlePath = await input({
      message: "Path to extra CA bundle (PEM file) — leave blank if not needed:",
      default: "",
    });

    const kind: Config["kind"] = detectKind(baseUrl);

    process.stdout.write("\nTesting connection...\n");
    try {
      const client = new SdkAdoClient({
        baseUrl,
        pat,
        caBundlePath: caBundlePath || undefined,
      });
      const me = await client.whoami();
      process.stdout.write(`  ✓ Connected as: ${me.providerDisplayName ?? me.id}\n\n`);

      const config: Config = {
        baseUrl,
        kind,
        ...(caBundlePath ? { caBundlePath } : {}),
      };
      await writeConfig(config);
      setPat(accountFromBaseUrl(baseUrl), pat);

      process.stdout.write(`Config saved: ${configFilePath()}\n`);
      process.stdout.write(`PAT stored in OS keyring (service: azure-devops-mcp, account: ${accountFromBaseUrl(baseUrl)})\n\n`);
      printClaudeCodeSnippet();
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\n  ✗ ${message}\n\n`);
      process.stdout.write("Let's try again.\n\n");
      // loop back
    }
  }
}

function detectKind(baseUrl: string): Config["kind"] {
  const host = new URL(baseUrl).host.toLowerCase();
  if (host === "dev.azure.com" || host.endsWith(".visualstudio.com")) return "services";
  return "server";
}

function printClaudeCodeSnippet(): void {
  const snippet = {
    mcpServers: {
      "azure-devops": {
        command: "npx",
        args: ["-y", "@vasekzdvihal/azure-devops-mcp"],
      },
    },
  };
  process.stdout.write("Add this to your Claude Code MCP config:\n\n");
  process.stdout.write(JSON.stringify(snippet, null, 2));
  process.stdout.write("\n\n");
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/setup.ts
git commit -m "feat: add interactive setup wizard with connection test"
```

---

## Task 17: `src/index.ts` (server entry point)

Replaces the placeholder from Task 1. Must come after Task 16 because `index.ts` imports `runSetup` from `setup.ts`.

**Files:**
- Modify: `src/index.ts` (overwrite the placeholder from Task 1)

- [ ] **Step 1: Implement**

```ts
// src/index.ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runSetup } from "./setup.js";
import { readConfig, ConfigNotFoundError } from "./config/configFile.js";
import { getPat, accountFromBaseUrl, PatNotFoundError } from "./config/keyring.js";
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

  registerAllTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[azure-devops-mcp] connected on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`[azure-devops-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles and builds**

```bash
npm run typecheck && npm run build
```

Expected: both exit 0; `dist/index.js` exists with a shebang line.

- [ ] **Step 3: Manually verify the missing-config error path**

(Quick smoke; doesn't write anything.)

```bash
XDG_CONFIG_HOME=/tmp/empty-xdg-test node dist/index.js
```

Expected: exits non-zero, prints "Azure DevOps MCP config not found. Run: npx -y @vasekzdvihal/azure-devops-mcp setup".

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add MCP server bootstrap with stdio transport"
```

---

## Task 18: README + manual end-to-end verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run the full unit test suite**

```bash
npm test
```

Expected: ALL pass. Confirm test count matches what we expect (paths: 3, configFile: 4, errors: 12, identity service: 3, errorBoundary: 4 → ~26 tests).

- [ ] **Step 2: Run the setup wizard against your real ADO**

```bash
npm run setup
```

Walk through the prompts with a real PAT for an ADO instance you have access to. Verify:
- Connection test succeeds and prints your name.
- Config file is written to `~/.config/azure-devops-mcp/config.json` with `0600` perms (`stat -f '%Sp' ~/.config/azure-devops-mcp/config.json` should show `-rw-------`).
- PAT is in the OS keyring (on macOS: open Keychain Access, search for "azure-devops-mcp").
- The Claude Code config snippet prints at the end.

- [ ] **Step 3: Wire into Claude Code and test `whoami`**

Add the printed snippet to your Claude Code MCP config (typically `~/.claude/settings.json` under `mcpServers`). Restart Claude Code or reload MCP servers. In a Claude session, ask: "use the azure-devops MCP server to call whoami".

Expected: Claude calls the tool and returns your identity (id, displayName, account).

- [ ] **Step 4: Test an error path manually**

Either delete the keyring entry (`security delete-generic-password -s azure-devops-mcp` on macOS) or set a bad PAT, then call whoami again from Claude. Verify the error message Claude surfaces matches the friendly text from `AdoAuthError` (mentions PAT and required scopes).

Restore the keyring entry by re-running `npm run setup` when done.

- [ ] **Step 5: Write README**

```markdown
# Azure DevOps MCP

Read-only Azure DevOps MCP server for Claude Code and other MCP hosts. Phase 0 ships `whoami` only — Phase 1 adds the read-only PR workflow.

Supports both **Azure DevOps Server** (on-prem) and **Azure DevOps Services** (cloud).

## Setup

\`\`\`bash
npx -y @vasekzdvihal/azure-devops-mcp setup
\`\`\`

You'll be prompted for:
- ADO base URL (e.g. `https://dev.azure.com/myorg` or `https://tfs.company.com/tfs/DefaultCollection`)
- Personal Access Token (required scopes for v1: **Code (read)**, **Identity (read)**)
- Optional: path to a CA bundle (PEM file) if your ADO Server uses an internal CA

Config is written to `~/.config/azure-devops-mcp/config.json` (mode `0600`).
PAT is stored in the OS keyring (service `azure-devops-mcp`).

## Use with Claude Code

Add to your Claude Code MCP config:

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

## Available tools (Phase 0)

| Tool | Description |
|---|---|
| `whoami` | Returns the identity associated with the configured PAT. |

More tools (read-only PR workflow) are coming in Phase 1.

## Troubleshooting

- **"config not found"** → run setup
- **"PAT may be expired..."** → regenerate the PAT and re-run setup
- **TLS verification failed** → if your ADO uses an internal CA, re-run setup and provide the CA bundle path

## Development

\`\`\`bash
npm install
npm test            # run unit tests
npm run typecheck   # TypeScript check
npm run build       # compile to dist/
npm run dev         # run server from source
npm run setup       # run setup wizard from source
\`\`\`

## License

MIT
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup, usage, and troubleshooting"
```

---

## Phase 0 Done — Checkpoint

Once all 18 tasks are complete, the user runs Phase 0 hands-on and feeds corrections back into the spec. **Do not start Phase 1 until the spec has been revised.**

When the spec is updated, write a separate plan file at `docs/superpowers/plans/YYYY-MM-DD-azure-devops-mcp-phase-1.md`.

Phase 1 will cover: extending the `AdoClient` interface, `git/detectRepo` + `parseRemoteUrl`, `domains/projects`, `domains/repositories`, `domains/pullRequests` (with `diffShaper`), and contract tests. The architecture from Phase 0 absorbs these without restructuring — each new domain is a new folder, each new SDK method is one new entry on the `AdoClient` interface and one new method on `SdkAdoClient`.
