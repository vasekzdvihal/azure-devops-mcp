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
