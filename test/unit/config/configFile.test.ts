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
