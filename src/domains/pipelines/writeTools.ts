import type { PipelinesWriteService } from "./writeService.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  QueuePipelineRunInput,
  CancelPipelineRunInput,
  UpdateBuildTagsInput,
} from "./schemas.js";

export function buildPipelineWriteTools(svc: PipelinesWriteService): ToolDefinition[] {
  return [
    {
      name: "queue_pipeline_run",
      config: {
        title: "Queue a new run of a pipeline",
        description:
          "Starts a new build/run of the named pipeline. Optional `branch` overrides the default; " +
          "`templateParameters` and `variables` let YAML pipelines parameterize the run. Returns the " +
          "new run id and URL so you can chain `get_pipeline_run` to watch it.",
        inputSchema: QueuePipelineRunInput,
      },
      handler: async (args) =>
        svc.queueRun(args as Parameters<typeof svc.queueRun>[0]),
    },
    {
      name: "cancel_pipeline_run",
      config: {
        title: "Cancel an in-progress pipeline run",
        description:
          "Cancels a running build. Already-completed runs return a clear conflict error; this " +
          "tool does not retry or noop in that case.",
        inputSchema: CancelPipelineRunInput,
      },
      handler: async (args) =>
        svc.cancelRun(args as Parameters<typeof svc.cancelRun>[0]),
    },
    {
      name: "update_build_tags",
      config: {
        title: "Add and/or remove tags on a build/run",
        description:
          "Adds tags in `addTags` and removes tags in `removeTags` from a build. Either array (or " +
          "both) may be supplied; at least one tag is required across the two arrays. Returns the " +
          "final tag list after the changes.",
        inputSchema: UpdateBuildTagsInput,
      },
      handler: async (args) =>
        svc.updateTags(args as Parameters<typeof svc.updateTags>[0]),
    },
  ];
}
