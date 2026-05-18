import type { ReleasesWriteService } from "./writeService.js";
import type { ToolDefinition } from "../identity/tools.js";
import {
  CreateReleaseInput,
  DeployReleaseStageInput,
  ApproveReleaseGateInput,
  CancelReleaseInput,
} from "./schemas.js";

export function buildReleaseWriteTools(svc: ReleasesWriteService): ToolDefinition[] {
  return [
    {
      name: "create_release",
      config: {
        title: "Create a release from a definition",
        description:
          "Creates a new release for the given release definition. `artifacts` binds aliases to " +
          "build ids; omit to use the definition's default artifact resolution. `variables` overrides " +
          "release-scoped variables. Returns the new release id and its environment list so you can " +
          "chain `deploy_release_stage` or `list_deployments`.",
        inputSchema: CreateReleaseInput,
      },
      handler: async (args) =>
        svc.createRelease(args as Parameters<typeof svc.createRelease>[0]),
    },
    {
      name: "deploy_release_stage",
      config: {
        title: "Manually deploy a release stage",
        description:
          "Manually triggers deployment of one environment (stage) on an existing release. " +
          "Always confirm with the user before calling — this deploys to a live environment.",
        inputSchema: DeployReleaseStageInput,
      },
      handler: async (args) =>
        svc.deployStage(args as Parameters<typeof svc.deployStage>[0]),
    },
    {
      name: "approve_release_gate",
      config: {
        title: "Approve or reject a release approval gate",
        description:
          "Sets the status of a pre- or post-deploy approval. Use `list_pending_approvals` to find " +
          "approvalId. Always confirm with the user before calling — your name is recorded on the " +
          "approval and is visible to everyone watching the release.",
        inputSchema: ApproveReleaseGateInput,
      },
      handler: async (args) =>
        svc.approveGate(args as Parameters<typeof svc.approveGate>[0]),
    },
    {
      name: "cancel_release",
      config: {
        title: "Abandon a release",
        description:
          "Marks an in-flight release as abandoned. Already-abandoned releases return a clear " +
          "conflict error.",
        inputSchema: CancelReleaseInput,
      },
      handler: async (args) =>
        svc.cancelRelease(args as Parameters<typeof svc.cancelRelease>[0]),
    },
  ];
}
