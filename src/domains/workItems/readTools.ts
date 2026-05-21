import type { WorkItemsReadService } from "./readService.js";
import type { ToolDefinition } from "../identity/tools.js";
import { ListWorkItemsInput, GetWorkItemInput } from "./schemas.js";

export function buildWorkItemsReadTools(svc: WorkItemsReadService): ToolDefinition[] {
  return [
    {
      name: "list_work_items",
      config: {
        title: "List work items by a canned filter",
        description:
          "Finds work items via one of four canned queries (no raw WIQL): 'myActive' (open items " +
          "assigned to you), 'linkedToPr' (items linked to a PR — pass repository + pullRequestId), " +
          "'currentIteration' (open items in a team's current sprint — pass team), or 'tag' (pass tag). " +
          "Returns trimmed rows; use `get_work_item` for full detail.",
        inputSchema: ListWorkItemsInput,
      },
      handler: async (args) => svc.list(args as Parameters<typeof svc.list>[0]),
    },
    {
      name: "get_work_item",
      config: {
        title: "Get a work item's full detail",
        description:
          "Returns one work item: all fields keyed by reference name (e.g. 'System.Title' — the set " +
          "varies by process template), relations (parent/child/related/PR artifact links), and recent " +
          "comments.",
        inputSchema: GetWorkItemInput,
      },
      handler: async (args) => svc.get(args as Parameters<typeof svc.get>[0]),
    },
  ];
}
