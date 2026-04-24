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
} from "azure-devops-node-api/interfaces/ReleaseInterfaces.js";

// Build (classic build + YAML pipelines)
export type {
  Build,
  BuildDefinitionReference,
  Timeline,
  TimelineRecord,
  BuildStatus,
  BuildResult,
} from "azure-devops-node-api/interfaces/BuildInterfaces.js";

// Git commits & branches
export type {
  GitBranchStats,
  GitCommitRef,
  GitQueryCommitsCriteria,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
