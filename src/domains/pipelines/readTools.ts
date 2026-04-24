import type { PipelinesReadService } from "./readService.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  ListPipelinesInput,
  ListPipelineRunsInput,
  PipelineRunId,
} from "./schemas.js";

export function buildPipelinesReadTools(svc: PipelinesReadService): ToolDefinition[] {
  return [
    {
      name: "list_pipelines",
      config: {
        title: "List build/pipeline definitions",
        description:
          "Lists build/pipeline definitions in a project. Covers both classic-build (type: " +
          "'classic') and YAML (type: 'yaml') pipelines. Optionally filter by repository id.",
        inputSchema: ListPipelinesInput,
      },
      handler: async (args) => svc.list(args as Parameters<typeof svc.list>[0]),
    },
    {
      name: "list_pipeline_runs",
      config: {
        title: "List pipeline runs (builds)",
        description:
          "Lists runs (builds) for pipelines in a project. Filter by pipelineId, branch " +
          "(e.g. 'refs/heads/main'), status, or result.",
        inputSchema: ListPipelineRunsInput,
      },
      handler: async (args) => svc.listRuns(args as Parameters<typeof svc.listRuns>[0]),
    },
    {
      name: "get_pipeline_run",
      config: {
        title: "Get a pipeline run with stages",
        description:
          "Returns run detail including the stages timeline. For YAML multi-stage pipelines, " +
          "the `stages` array is how you see 'did the Production stage succeed'.",
        inputSchema: PipelineRunId,
      },
      handler: async (args) => svc.get(args as Parameters<typeof svc.get>[0]),
    },
  ];
}
