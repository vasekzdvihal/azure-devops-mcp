#!/usr/bin/env node
import type { Config } from './config/schema.js';
import process from 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SdkAdoClient } from './ado/sdkClient.js';
import { readConfig } from './config/configFile.js';
import { configFromEnv } from './config/envConfig.js';
import { isReadOnly } from './config/readOnly.js';
import { registerAllTools } from './mcp/registerTools.js';
import { runSetup } from './setup.js';

// Startup problems with a clear user-facing fix — print the message, skip the
// stack. PatNotFoundError is matched by name: importing its class would load
// the keyring native module, which the env-config path must never touch.
const FRIENDLY_STARTUP_ERRORS = new Set(['EnvConfigError', 'ConfigNotFoundError', 'PatNotFoundError']);

async function resolveConfigAndPat(): Promise<{ config: Config; pat: string }> {
  const fromEnv = configFromEnv();
  if (fromEnv) {
    return fromEnv;
  }
  // Keyring is imported lazily so headless/container environments configured
  // via env vars never load the native module.
  const config = await readConfig();
  const { accountFromBaseUrl, getPat } = await import('./config/keyring.js');
  return { config, pat: getPat(accountFromBaseUrl(config.baseUrl)) };
}

async function main(): Promise<void> {
  if (process.argv[2] === 'setup') {
    await runSetup();
    return;
  }

  let config: Config;
  let pat: string;
  try {
    ({ config, pat } = await resolveConfigAndPat());
  }
  catch (err) {
    if (err instanceof Error && FRIENDLY_STARTUP_ERRORS.has(err.name)) {
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
    name: 'azure-devops-mcp',
    version: '0.0.1',
  });

  const readOnly = isReadOnly();
  registerAllTools(server, client, { readOnly });
  if (readOnly) {
    process.stderr.write('[azure-devops-mcp] read-only mode: write tools are not registered\n');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[azure-devops-mcp] connected on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[azure-devops-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
