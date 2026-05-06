import type { ReleasesReadService } from "./readService.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  ProjectOnly,
  ListReleasesInput,
  ReleaseDefinitionId,
  ReleaseId,
  ListDeploymentsInput,
} from "./schemas.js";

export function buildReleasesReadTools(svc: ReleasesReadService): ToolDefinition[] {
  return [
    {
      name: "list_release_definitions",
      config: {
        title: "List release definitions (classic Release pipelines)",
        description:
          "Lists classic Release pipeline definitions in a project. Use this to find the " +
          "release-definition id, then pass it to `list_releases` or `list_deployments` to " +
          "narrow down to a specific pipeline.",
        inputSchema: ProjectOnly,
      },
      handler: async (args) =>
        svc.listDefinitions(args as Parameters<typeof svc.listDefinitions>[0]),
    },
    {
      name: "get_release_definition",
      config: {
        title: "Get a release definition (classic Release pipeline)",
        description:
          "Returns one classic Release pipeline definition: variables (with secret flags — " +
          "secret values are never returned), variable groups, artifacts, triggers, and " +
          "environments. Each environment includes pre/post approval setup (automated vs. " +
          "named approvers) plus per-stage deploy task count. Pass `verbose: true` to also " +
          "include the full deploy task list per environment — large definitions can produce " +
          "long payloads, so prefer the default compact view unless you need the task names.",
        inputSchema: ReleaseDefinitionId,
      },
      handler: async (args) =>
        svc.getDefinition(args as Parameters<typeof svc.getDefinition>[0]),
    },
    {
      name: "list_releases",
      config: {
        title: "List releases (classic Release runs)",
        description:
          "Lists release instances in a project. Each release corresponds to one run of a " +
          "release definition (which may deploy to multiple stages). Filter by definitionId or " +
          "status (active/abandoned/draft).",
        inputSchema: ListReleasesInput,
      },
      handler: async (args) => svc.list(args as Parameters<typeof svc.list>[0]),
    },
    {
      name: "get_release",
      config: {
        title: "Get a release with stages and artifacts",
        description:
          "Returns one release: stages (each with status + who deployed + when), artifacts " +
          "(with source build id and branch so you can chain to `get_pipeline_run` to find the " +
          "commit that was deployed).",
        inputSchema: ReleaseId,
      },
      handler: async (args) => svc.get(args as Parameters<typeof svc.get>[0]),
    },
    {
      name: "list_deployments",
      config: {
        title: "List deployments (per-stage flattened)",
        description:
          "Returns one row per stage deployment. This is the best tool to answer 'who last " +
          "deployed X to Production?' — pass `status: 'succeeded'`, `top: 1`, and filter the " +
          "result client-side by environment name (e.g. 'Production').",
        inputSchema: ListDeploymentsInput,
      },
      handler: async (args) =>
        svc.listDeployments(args as Parameters<typeof svc.listDeployments>[0]),
    },
  ];
}
