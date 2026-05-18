import type {
  Identity,
  TeamProjectReference,
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitPullRequestChange,
  PullRequestStatus,
  Comment,
  CommentThreadStatus,
  IdentityRefWithVote,
  GitPullRequestCompletionOptions,
  GitPullRequestMergeStrategy,
  Release,
  ReleaseDefinition,
  Deployment,
  DeploymentStatus,
  ReleaseStatus,
  ReleaseStartMetadata,
  ReleaseEnvironmentUpdateMetadata,
  ReleaseApproval,
  Build,
  BuildDefinition,
  Timeline,
  BuildStatus,
  BuildResult,
  Run,
  GitBranchStats,
  GitCommitRef,
} from "./types.js";

/**
 * The AdoClient is the seam between our domain services and Azure DevOps.
 * Implementations live in `sdkClient.ts` (production) and `test/fakes/FakeAdoClient.ts` (tests).
 * New methods are added here when a domain needs them.
 */
export interface AdoClient {
  // identity
  whoami(): Promise<Identity>;

  // projects & repos
  listProjects(): Promise<TeamProjectReference[]>;
  listRepositories(args: { project: string }): Promise<GitRepository[]>;

  // pull requests — discovery
  listPullRequests(args: {
    project: string;
    repository: string;
    status?: PullRequestStatus;
    creatorId?: string;
    reviewerId?: string;
    targetRefName?: string;
    top?: number;
    skip?: number;
  }): Promise<GitPullRequest[]>;

  getPullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequest>;

  // pull requests — changes & diff
  listPullRequestChanges(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequestChange[]>;

  /**
   * Fetches a file's content (as UTF-8 string) at a given commit. Used by the
   * PR diff service to fetch base + target content for a single file before
   * synthesizing a unified diff client-side.
   *
   * Returns null when the path doesn't exist at that commit (e.g. file added
   * in this PR — the base side returns null).
   */
  getFileContent(args: {
    project: string;
    repository: string;
    path: string;
    commitSha: string;
  }): Promise<string | null>;

  // pull requests — comments & iterations
  listPullRequestThreads(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequestCommentThread[]>;

  listPullRequestIterations(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequestIteration[]>;

  // pull request writes — comments
  createPullRequestThread(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    content: string;
    filePath?: string;
    line?: number;
  }): Promise<GitPullRequestCommentThread>;

  addPullRequestComment(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    threadId: number;
    content: string;
  }): Promise<Comment>;

  updatePullRequestThreadStatus(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    threadId: number;
    status: CommentThreadStatus;
  }): Promise<GitPullRequestCommentThread>;

  // pull request writes — vote
  setPullRequestVote(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerId: string;
    vote: number; // 10 / 5 / 0 / -5 / -10 — see writeService for mapping
  }): Promise<IdentityRefWithVote>;

  // pull request writes — metadata
  updatePullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    title?: string;
    description?: string;
    isDraft?: boolean;
  }): Promise<GitPullRequest>;

  // pull request writes — reviewers
  addPullRequestReviewers(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerIds: string[];
  }): Promise<IdentityRefWithVote[]>;

  removePullRequestReviewer(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerId: string;
  }): Promise<void>;

  // pull request lifecycle (Phase 2.1)
  createPullRequest(args: {
    project: string;
    repository: string;
    sourceRefName: string; // "refs/heads/<branch>"
    targetRefName: string;
    title: string;
    description?: string;
    isDraft?: boolean;
    reviewerIds?: string[];
  }): Promise<GitPullRequest>;

  completePullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    mergeStrategy: GitPullRequestMergeStrategy;
    deleteSourceBranch?: boolean;
    mergeCommitMessage?: string;
    bypassPolicy?: boolean;
    bypassReason?: string;
    /**
     * The merge source commit SHA (required by ADO to confirm caller saw current state).
     * The service fetches this if the caller didn't pass it explicitly.
     */
    lastMergeSourceCommitId?: string;
  }): Promise<GitPullRequest>;

  abandonPullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequest>;

  setPullRequestAutoComplete(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    autoCompleteSetById: string; // identity id whose name shows on the auto-complete badge
    completionOptions: GitPullRequestCompletionOptions;
  }): Promise<GitPullRequest>;

  // releases (classic Release pipelines)
  listReleaseDefinitions(args: { project: string }): Promise<ReleaseDefinition[]>;

  listReleases(args: {
    project: string;
    definitionId?: number;
    status?: ReleaseStatus;
    top?: number;
  }): Promise<Release[]>;

  getRelease(args: { project: string; releaseId: number }): Promise<Release>;

  getReleaseDefinition(args: {
    project: string;
    definitionId: number;
  }): Promise<ReleaseDefinition>;

  listDeployments(args: {
    project: string;
    definitionId?: number;
    deploymentStatus?: DeploymentStatus;
    top?: number;
  }): Promise<Deployment[]>;

  // pipelines (classic-build + YAML, both via BuildApi)
  listPipelines(args: {
    project: string;
    repositoryId?: string;
  }): Promise<BuildDefinition[]>;

  listPipelineRuns(args: {
    project: string;
    pipelineId?: number;
    branch?: string;
    status?: BuildStatus;
    result?: BuildResult;
    top?: number;
  }): Promise<Build[]>;

  getPipelineRun(args: {
    project: string;
    runId: number;
  }): Promise<{ build: Build; timeline: Timeline | null }>;

  getPipelineDefinition(args: {
    project: string;
    definitionId: number;
  }): Promise<BuildDefinition>;

  getBuild(args: { project: string; buildId: number }): Promise<Build>;

  // commits & branches
  listBranches(args: {
    project: string;
    repository: string;
  }): Promise<GitBranchStats[]>;

  listCommits(args: {
    project: string;
    repository: string;
    branch?: string;
    fromDate?: string;
    toDate?: string;
    author?: string;
    top?: number;
  }): Promise<GitCommitRef[]>;

  // pipeline writes (Phase 4.1)
  queuePipelineRun(args: {
    project: string;
    pipelineId: number;
    branch?: string;
    templateParameters?: Record<string, string>;
    variables?: Record<string, { value: string; isSecret?: boolean }>;
  }): Promise<Run>;

  cancelPipelineRun(args: { project: string; runId: number }): Promise<Build>;

  addBuildTags(args: { project: string; runId: number; tags: string[] }): Promise<string[]>;
  removeBuildTag(args: { project: string; runId: number; tag: string }): Promise<string[]>;

  // release writes (Phase 4.1)
  createRelease(args: {
    project: string;
    metadata: ReleaseStartMetadata;
  }): Promise<Release>;

  updateReleaseEnvironment(args: {
    project: string;
    releaseId: number;
    environmentId: number;
    update: ReleaseEnvironmentUpdateMetadata;
  }): Promise<unknown>;

  cancelRelease(args: {
    project: string;
    releaseId: number;
    comment?: string;
  }): Promise<Release>;

  updateReleaseApproval(args: {
    project: string;
    approvalId: number;
    status: "approved" | "rejected";
    comment?: string;
  }): Promise<ReleaseApproval>;

  // release reads (Phase 4.1)
  listPendingApprovals(args: {
    project: string;
    releaseId?: number;
    assignedTo?: string;
  }): Promise<ReleaseApproval[]>;
}
