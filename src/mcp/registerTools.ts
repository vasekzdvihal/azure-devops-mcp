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
