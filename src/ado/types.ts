// Build (classic build + YAML pipelines)
export type {
  Build,
  BuildDefinition,
  BuildDefinitionReference,
  BuildDefinitionVariable,
  BuildResult,
  BuildStatus,
  Timeline,
  TimelineRecord,
} from 'azure-devops-node-api/interfaces/BuildInterfaces.js';
export type { IdentityRef } from 'azure-devops-node-api/interfaces/common/VSSInterfaces.js';
// JSON Patch (used to mutate work items).
export type { JsonPatchOperation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces.js';
export { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces.js';
export type { TeamProjectReference } from 'azure-devops-node-api/interfaces/CoreInterfaces.js';

export type {
  Comment,
  CommentThreadStatus,
  GitItem,
  GitPullRequest,
  GitPullRequestChange,
  GitPullRequestCommentThread,
  GitPullRequestCompletionOptions,
  GitPullRequestIteration,
  GitPullRequestMergeStrategy,
  GitRepository,
  IdentityRefWithVote,
  PullRequestStatus,
} from 'azure-devops-node-api/interfaces/GitInterfaces.js';

// Git commits & branches
export type {
  GitBranchStats,
  GitCommitRef,
  GitQueryCommitsCriteria,
} from 'azure-devops-node-api/interfaces/GitInterfaces.js';

// Re-exports of azure-devops-node-api types we expose at the AdoClient seam.
// Keeping a single import surface here means downstream files don't import from
// "azure-devops-node-api/interfaces/...".
export type { Identity } from 'azure-devops-node-api/interfaces/IdentitiesInterfaces.js';

export type { ConnectionData } from 'azure-devops-node-api/interfaces/LocationsInterfaces.js';

// Pipelines (YAML runs via PipelinesApi)
export type {
  Run,
  RunPipelineParameters,
} from 'azure-devops-node-api/interfaces/PipelinesInterfaces.js';
// Release (classic release pipelines)
export type {
  ApprovalStatus,
  Artifact,
  ConfigurationVariableValue,
  Deployment,
  DeploymentStatus,
  EnvironmentStatus,
  Release,
  ReleaseApproval,
  ReleaseDefinition,
  ReleaseDefinitionEnvironment,
  ReleaseEnvironment,
  ReleaseEnvironmentUpdateMetadata,
  ReleaseStartMetadata,
  ReleaseStatus,
} from 'azure-devops-node-api/interfaces/ReleaseInterfaces.js';

// Work items (WorkItemTrackingApi)
export type {
  WorkItem,
  Comment as WorkItemComment,
} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js';
// WorkItemExpand is used as a *value* (expand: WorkItemExpand.All), so it's a
// runtime export, not a type-only one.
export { WorkItemExpand } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js';
