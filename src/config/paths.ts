import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const APP_DIR_NAME = 'azure-devops-mcp';
const CONFIG_FILE_NAME = 'config.json';

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, APP_DIR_NAME);
}

export function configFilePath(): string {
  return path.join(configDir(), CONFIG_FILE_NAME);
}
