import type { ProjectsService } from "./service.js";
import type { ToolDefinition } from "../identity/tools.js";

export function buildProjectsTools(svc: ProjectsService): ToolDefinition[] {
  return [
    {
      name: "list_projects",
      config: {
        title: "List Azure DevOps projects",
        description:
          "Lists all projects in the configured ADO collection (on-prem) or organization (cloud). " +
          "Use this when you need the project name to pass to other tools, or to discover what's available.",
        inputSchema: {},
      },
      handler: async () => svc.list(),
    },
  ];
}
