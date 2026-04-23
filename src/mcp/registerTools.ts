import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IdentityService } from "../domains/identity/service.js";
import { buildIdentityTools } from "../domains/identity/tools.js";
import { ProjectsService } from "../domains/projects/service.js";
import { buildProjectsTools } from "../domains/projects/tools.js";
import { RepositoriesService } from "../domains/repositories/service.js";
import { buildRepositoriesTools } from "../domains/repositories/tools.js";
import { PullRequestsReadService } from "../domains/pullRequests/readService.js";
import { buildPullRequestReadTools } from "../domains/pullRequests/readTools.js";
import { toToolResult } from "./errorBoundary.js";
import type { AdoClient } from "../ado/client.js";

export interface RegisterAllToolsOptions {
  /**
   * When true, write tools are skipped. No-op in Phase 1 (all tools are reads);
   * the contract exists so Phase 2 can gate write tools without changing this signature.
   */
  readOnly?: boolean;
}

/**
 * Wires domain services to AdoClient and registers all tools on the McpServer.
 * Phase 1 domains: identity, projects, repositories, pullRequests.
 */
export function registerAllTools(
  server: McpServer,
  client: AdoClient,
  _options: RegisterAllToolsOptions = {},
): void {
  const tools = [
    ...buildIdentityTools(new IdentityService(client)),
    ...buildProjectsTools(new ProjectsService(client)),
    ...buildRepositoriesTools(new RepositoriesService(client)),
    ...buildPullRequestReadTools(new PullRequestsReadService(client)),
  ];

  // Note: when Phase 2 adds write tools, build a separate `writeTools` array
  // and conditionally include it via `...(options.readOnly ? [] : writeTools)`.

  for (const tool of tools) {
    server.registerTool(tool.name, tool.config, toToolResult(tool.handler));
  }
}
