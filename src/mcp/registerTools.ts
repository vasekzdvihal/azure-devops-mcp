import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IdentityService } from "../domains/identity/service.js";
import { buildIdentityTools } from "../domains/identity/tools.js";
import { ProjectsService } from "../domains/projects/service.js";
import { buildProjectsTools } from "../domains/projects/tools.js";
import { RepositoriesService } from "../domains/repositories/service.js";
import { buildRepositoriesTools } from "../domains/repositories/tools.js";
import { PullRequestsReadService } from "../domains/pullRequests/readService.js";
import { buildPullRequestReadTools } from "../domains/pullRequests/readTools.js";
import { PullRequestsWriteService } from "../domains/pullRequests/writeService.js";
import { buildPullRequestWriteTools } from "../domains/pullRequests/writeTools.js";
import { toToolResult } from "./errorBoundary.js";
import type { AdoClient } from "../ado/client.js";

export interface RegisterAllToolsOptions {
  /**
   * When true, write tools (Phase 2: comment / reply / vote / update / draft / reviewers)
   * are NOT registered. The LLM's tool list contains only the read tools — write attempts
   * are impossible because the tools don't exist on the surface.
   *
   * Set via the AZURE_DEVOPS_READ_ONLY env var, read by index.ts at startup.
   */
  readOnly?: boolean;
}

/**
 * Wires domain services to AdoClient and registers all tools on the McpServer.
 * Phase 1 read tools always register. Phase 2 write tools are gated by `options.readOnly`.
 */
export function registerAllTools(
  server: McpServer,
  client: AdoClient,
  options: RegisterAllToolsOptions = {},
): void {
  const readTools = [
    ...buildIdentityTools(new IdentityService(client)),
    ...buildProjectsTools(new ProjectsService(client)),
    ...buildRepositoriesTools(new RepositoriesService(client)),
    ...buildPullRequestReadTools(new PullRequestsReadService(client)),
  ];

  const writeTools = options.readOnly
    ? []
    : buildPullRequestWriteTools(new PullRequestsWriteService(client));

  for (const tool of [...readTools, ...writeTools]) {
    server.registerTool(tool.name, tool.config, toToolResult(tool.handler));
  }
}
