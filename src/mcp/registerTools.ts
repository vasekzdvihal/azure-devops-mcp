import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AdoClient } from '../ado/client.js';
import { CommitsReadService } from '../domains/commits/readService.js';
import { buildCommitsReadTools } from '../domains/commits/readTools.js';
import { IdentityService } from '../domains/identity/service.js';
import { buildIdentityTools } from '../domains/identity/tools.js';
import { PipelinesReadService } from '../domains/pipelines/readService.js';
import { buildPipelinesReadTools } from '../domains/pipelines/readTools.js';
import { PipelinesWriteService } from '../domains/pipelines/writeService.js';
import { buildPipelineWriteTools } from '../domains/pipelines/writeTools.js';
import { ProjectsService } from '../domains/projects/service.js';
import { buildProjectsTools } from '../domains/projects/tools.js';
import { PullRequestsReadService } from '../domains/pullRequests/readService.js';
import { buildPullRequestReadTools } from '../domains/pullRequests/readTools.js';
import { PullRequestsWriteService } from '../domains/pullRequests/writeService.js';
import { buildPullRequestWriteTools } from '../domains/pullRequests/writeTools.js';
import { ReleasesReadService } from '../domains/releases/readService.js';
import { buildReleasesReadTools } from '../domains/releases/readTools.js';
import { ReleasesWriteService } from '../domains/releases/writeService.js';
import { buildReleaseWriteTools } from '../domains/releases/writeTools.js';
import { RepositoriesService } from '../domains/repositories/service.js';
import { buildRepositoriesTools } from '../domains/repositories/tools.js';
import { WorkItemsReadService } from '../domains/workItems/readService.js';
import { buildWorkItemsReadTools } from '../domains/workItems/readTools.js';
import { WorkItemsWriteService } from '../domains/workItems/writeService.js';
import { buildWorkItemsWriteTools } from '../domains/workItems/writeTools.js';
import { toToolResult } from './errorBoundary.js';

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
    ...buildReleasesReadTools(new ReleasesReadService(client)),
    ...buildPipelinesReadTools(new PipelinesReadService(client)),
    ...buildCommitsReadTools(new CommitsReadService(client)),
    ...buildWorkItemsReadTools(new WorkItemsReadService(client)),
  ];

  const writeTools = options.readOnly
    ? []
    : [
        ...buildPullRequestWriteTools(new PullRequestsWriteService(client)),
        ...buildPipelineWriteTools(new PipelinesWriteService(client)),
        ...buildReleaseWriteTools(new ReleasesWriteService(client)),
        ...buildWorkItemsWriteTools(new WorkItemsWriteService(client)),
      ];

  for (const tool of [...readTools, ...writeTools]) {
    server.registerTool(tool.name, tool.config, toToolResult(tool.handler));
  }
}
