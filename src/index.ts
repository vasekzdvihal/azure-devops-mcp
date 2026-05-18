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
    process.stderr.write("[azure-devops-mcp] read-only mode: write tools are not registered\n");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[azure-devops-mcp] connected on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`[azure-devops-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
