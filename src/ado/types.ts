// Re-exports of azure-devops-node-api types we expose at the AdoClient seam.
// Keeping a single import surface here means downstream files don't import from
// "azure-devops-node-api/interfaces/...".
export type { Identity } from "azure-devops-node-api/interfaces/IdentitiesInterfaces.js";
export type { ConnectionData } from "azure-devops-node-api/interfaces/LocationsInterfaces.js";
export type { TeamProjectReference } from "azure-devops-node-api/interfaces/CoreInterfaces.js";
export type { IdentityRef } from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";
export type {
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitItem,
  GitPullRequestChange,
  PullRequestStatus,
  Comment,
  CommentThreadStatus,
  IdentityRefWithVote,
  GitPullRequestCompletionOptions,
  GitPullRequestMergeStrategy,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";

// Release (classic release pipelines)
export type {
  Release,
  ReleaseDefinition,
  Deployment,
  ReleaseEnvironment,
  Artifact,
  DeploymentStatus,
  ReleaseStatus,
  ReleaseStartMetadata,
  ReleaseEnvironmentUpdateMetadata,
  ReleaseApproval,
  ApprovalStatus,
  ConfigurationVariableValue,
} from "azure-devops-node-api/interfaces/ReleaseInterfaces.js";

// Build (classic build + YAML pipelines)
export type {
  Build,
  BuildDefinition,
  BuildDefinitionReference,
  BuildDefinitionVariable,
  Timeline,
  TimelineRecord,
  BuildStatus,
  BuildResult,
} from "azure-devops-node-api/interfaces/BuildInterfaces.js";

// Pipelines (YAML runs via PipelinesApi)
export type {
  Run,
  RunPipelineParameters,
} from "azure-devops-node-api/interfaces/PipelinesInterfaces.js";

// Git commits & branches
export type {
  GitBranchStats,
  GitCommitRef,
  GitQueryCommitsCriteria,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";

// Work items (WorkItemTrackingApi)
export type {
  WorkItem,
  WorkItemReference,
  WorkItemRelation,
  WorkItemQueryResult,
  WorkItemStateColor,
  WorkItemType,
  Comment as WorkItemComment,
  CommentList,
} from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";
// WorkItemExpand is used as a *value* (expand: WorkItemExpand.All), so it's a
// runtime export, not a type-only one.
export { WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";

// JSON Patch (used to mutate work items) + the generic resource ref returned by
// getPullRequestWorkItemRefs.
export type {
  JsonPatchOperation,
  ResourceRef,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";
export { Operation } from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";
