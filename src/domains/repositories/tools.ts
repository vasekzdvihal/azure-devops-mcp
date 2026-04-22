import { z } from "zod";
import type { RepositoriesService } from "./service.js";
import type { ToolDefinition } from "../identity/tools.js";

export function buildRepositoriesTools(svc: RepositoriesService): ToolDefinition[] {
  return [
    {
      name: "list_repositories",
      config: {
        title: "List git repositories in a project",
        description:
          "Lists all git repositories in the given Azure DevOps project. " +
          "Use this to discover repository names and ids needed by the pull-request tools.",
        inputSchema: {
          project: z.string().min(1).describe("The Azure DevOps project name."),
        },
      },
      handler: async (args) =>
        svc.list({ project: args["project"] as string }),
    },
  ];
}
