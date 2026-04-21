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
