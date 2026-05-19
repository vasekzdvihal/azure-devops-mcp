import type { AdoClient } from "../../src/ado/client.js";
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
} from "../../src/ado/types.js";

interface PrKey {
  project: string;
  repository: string;
  pullRequestId: number;
}

function prKey(k: PrKey): string {
  return `${k.project} ${k.repository} ${k.pullRequestId}`;
}

export class FakeAdoClient implements AdoClient {
  // identity
  private whoamiResult?: Identity;
  private whoamiError?: Error;
  // projects/repos
  private projects?: TeamProjectReference[];
  private repos = new Map<string, GitRepository[]>(); // project → repos
  // PRs
  private prLists = new Map<string, GitPullRequest[]>(); // project|repo → PRs
  private prDetails = new Map<string, GitPullRequest>();
  private prChanges = new Map<string, GitPullRequestChange[]>();
  private prThreads = new Map<string, GitPullRequestCommentThread[]>();
  private prIterations = new Map<string, GitPullRequestIteration[]>();
  // file content: project|repo|path|sha → content
  private fileContents = new Map<string, string | null>();
  // generic error injection
  private errors = new Map<string, Error>();

  // ---- phase-2.1 lifecycle state ----
  private createdPrs: Array<{
    project: string;
    repository: string;
    pr: GitPullRequest;
  }> = [];
  private completedPrs: Array<{ key: string; mergeStrategy: GitPullRequestMergeStrategy }> = [];
  private abandonedPrs: string[] = [];
  private autoCompleteSet: Array<{
    key: string;
    setById: string;
    options: GitPullRequestCompletionOptions;
  }> = [];
  private nextCreatedPr?: GitPullRequest;
  private nextCompletedPr?: GitPullRequest;
  private nextAbandonedPr?: GitPullRequest;
  private nextAutoCompletedPr?: GitPullRequest;

  setNextCreatedPr(pr: GitPullRequest): void {
    this.nextCreatedPr = pr;
  }
  setNextCompletedPr(pr: GitPullRequest): void {
    this.nextCompletedPr = pr;
  }
  setNextAbandonedPr(pr: GitPullRequest): void {
    this.nextAbandonedPr = pr;
  }
  setNextAutoCompletedPr(pr: GitPullRequest): void {
    this.nextAutoCompletedPr = pr;
  }
  getCreatedPrs(): ReadonlyArray<{ project: string; repository: string; pr: GitPullRequest }> {
    return this.createdPrs;
  }
  getCompletedPrs(): ReadonlyArray<{ key: string; mergeStrategy: GitPullRequestMergeStrategy }> {
    return this.completedPrs;
  }
  getAbandonedPrs(): ReadonlyArray<string> {
    return this.abandonedPrs;
  }
  getAutoCompleteSets(): ReadonlyArray<{
    key: string;
    setById: string;
    options: GitPullRequestCompletionOptions;
  }> {
    return this.autoCompleteSet;
  }

  // ---- write-side state (Phase 2) ----
  // History of writes per PR — tests can inspect to verify what was sent.
  private createdThreads: Array<{ key: string; thread: GitPullRequestCommentThread }> = [];
  private createdComments: Array<{ key: string; threadId: number; comment: Comment }> = [];
  private threadStatusUpdates: Array<{ key: string; threadId: number; status: CommentThreadStatus }> = [];
  private voteUpdates: Array<{ key: string; reviewerId: string; vote: number }> = [];
  private prUpdates: Array<{ key: string; update: Partial<GitPullRequest> }> = [];
  private reviewerAdds: Array<{ key: string; reviewerIds: string[] }> = [];
  private reviewerRemoves: Array<{ key: string; reviewerId: string }> = [];

  // Configurable return values for the writes.
  private nextCreatedThread?: GitPullRequestCommentThread;
  private nextCreatedComment?: Comment;
  private nextUpdatedThread?: GitPullRequestCommentThread;
  private nextVoteResult?: IdentityRefWithVote;
  private nextUpdatedPr?: GitPullRequest;
  private nextAddedReviewers?: IdentityRefWithVote[];

  // ---- setup helpers (test-only, not part of AdoClient) ----
  setWhoamiResult(identity: Identity): void {
    this.whoamiResult = identity;
    this.whoamiError = undefined;
  }
  setWhoamiError(err: Error): void {
    this.whoamiError = err;
    this.whoamiResult = undefined;
  }
  setProjects(projects: TeamProjectReference[]): void {
    this.projects = projects;
  }
  setRepositories(project: string, repos: GitRepository[]): void {
    this.repos.set(project, repos);
  }
  setPullRequests(project: string, repository: string, prs: GitPullRequest[]): void {
    this.prLists.set(`${project} ${repository}`, prs);
  }
  setPullRequest(args: PrKey & { pr: GitPullRequest }): void {
    this.prDetails.set(prKey(args), args.pr);
  }
  setPullRequestChanges(args: PrKey & { changes: GitPullRequestChange[] }): void {
    this.prChanges.set(prKey(args), args.changes);
  }
  setPullRequestThreads(args: PrKey & { threads: GitPullRequestCommentThread[] }): void {
    this.prThreads.set(prKey(args), args.threads);
  }
  setPullRequestIterations(args: PrKey & { iterations: GitPullRequestIteration[] }): void {
    this.prIterations.set(prKey(args), args.iterations);
  }
  setFileContent(args: {
    project: string;
    repository: string;
    path: string;
    commitSha: string;
    content: string | null;
  }): void {
    this.fileContents.set(
      `${args.project} ${args.repository} ${args.path} ${args.commitSha}`,
      args.content,
    );
  }
  injectError(method: string, err: Error): void {
    this.errors.set(method, err);
  }

  // ---- write-side setup helpers ----
  setNextCreatedThread(thread: GitPullRequestCommentThread): void {
    this.nextCreatedThread = thread;
  }
  setNextCreatedComment(comment: Comment): void {
    this.nextCreatedComment = comment;
  }
  setNextUpdatedThread(thread: GitPullRequestCommentThread): void {
    this.nextUpdatedThread = thread;
  }
  setNextVoteResult(vote: IdentityRefWithVote): void {
    this.nextVoteResult = vote;
  }
  setNextUpdatedPr(pr: GitPullRequest): void {
    this.nextUpdatedPr = pr;
  }
  setNextAddedReviewers(reviewers: IdentityRefWithVote[]): void {
    this.nextAddedReviewers = reviewers;
  }

  // ---- write-side history accessors (for assertions) ----
  getCreatedThreads(): ReadonlyArray<{ key: string; thread: GitPullRequestCommentThread }> {
    return this.createdThreads;
  }
  getCreatedComments(): ReadonlyArray<{ key: string; threadId: number; comment: Comment }> {
    return this.createdComments;
  }
  getThreadStatusUpdates(): ReadonlyArray<{ key: string; threadId: number; status: CommentThreadStatus }> {
    return this.threadStatusUpdates;
  }
  getVoteUpdates(): ReadonlyArray<{ key: string; reviewerId: string; vote: number }> {
    return this.voteUpdates;
  }
  getPrUpdates(): ReadonlyArray<{ key: string; update: Partial<GitPullRequest> }> {
    return this.prUpdates;
  }
  getReviewerAdds(): ReadonlyArray<{ key: string; reviewerIds: string[] }> {
    return this.reviewerAdds;
  }
  getReviewerRemoves(): ReadonlyArray<{ key: string; reviewerId: string }> {
    return this.reviewerRemoves;
  }

  // ---- phase-3 state ----
  private releaseDefs = new Map<string, ReleaseDefinition[]>(); // project
  private releases = new Map<string, Release[]>(); // project
  private releaseDetails = new Map<string, Release>(); // `${project} ${releaseId}`
  private deployments = new Map<string, Deployment[]>(); // project
  private pipelines = new Map<string, BuildDefinition[]>(); // project
  private pipelineRuns = new Map<string, Build[]>(); // project
  private pipelineRunDetails = new Map<
    string,
    { build: Build; timeline: Timeline | null }
  >(); // `${project} ${runId}`
  private pipelineDefDetails = new Map<string, BuildDefinition>(); // `${project} ${definitionId}`
  private releaseDefDetails = new Map<string, ReleaseDefinition>(); // `${project} ${definitionId}`
  private branches = new Map<string, GitBranchStats[]>(); // `${project} ${repo}`
  private commits = new Map<string, GitCommitRef[]>(); // `${project} ${repo}`

  // ---- phase-3 setup helpers ----
  setReleaseDefinitions(project: string, defs: ReleaseDefinition[]): void {
    this.releaseDefs.set(project, defs);
  }
  setReleases(project: string, releases: Release[]): void {
    this.releases.set(project, releases);
  }
  setRelease(project: string, releaseId: number, release: Release): void {
    this.releaseDetails.set(`${project} ${releaseId}`, release);
  }
  setDeployments(project: string, deployments: Deployment[]): void {
    this.deployments.set(project, deployments);
  }
  setPipelines(project: string, pipelines: BuildDefinition[]): void {
    this.pipelines.set(project, pipelines);
  }
  setPipelineRuns(project: string, runs: Build[]): void {
    this.pipelineRuns.set(project, runs);
  }
  setPipelineRun(
    project: string,
    runId: number,
    detail: { build: Build; timeline: Timeline | null },
  ): void {
    this.pipelineRunDetails.set(`${project} ${runId}`, detail);
  }
  setPipelineDefinition(project: string, definitionId: number, def: BuildDefinition): void {
    this.pipelineDefDetails.set(`${project} ${definitionId}`, def);
  }
  setReleaseDefinition(project: string, definitionId: number, def: ReleaseDefinition): void {
    this.releaseDefDetails.set(`${project} ${definitionId}`, def);
  }
  setBranches(project: string, repository: string, branches: GitBranchStats[]): void {
    this.branches.set(`${project} ${repository}`, branches);
  }
  setCommits(project: string, repository: string, commits: GitCommitRef[]): void {
    this.commits.set(`${project} ${repository}`, commits);
  }

  // ---- AdoClient impl ----
  private throwIfInjected(method: string): void {
    const e = this.errors.get(method);
    if (e) throw e;
  }

  async whoami(): Promise<Identity> {
    this.throwIfInjected("whoami");
    if (this.whoamiError) throw this.whoamiError;
    if (this.whoamiResult) return this.whoamiResult;
    throw new Error("FakeAdoClient.whoami: no result configured");
  }

  async listProjects(): Promise<TeamProjectReference[]> {
    this.throwIfInjected("listProjects");
    return this.projects ?? [];
  }

  async listRepositories(args: { project: string }): Promise<GitRepository[]> {
    this.throwIfInjected("listRepositories");
    return this.repos.get(args.project) ?? [];
  }

  async listPullRequests(args: {
    project: string;
    repository: string;
    status?: PullRequestStatus;
  }): Promise<GitPullRequest[]> {
    this.throwIfInjected("listPullRequests");
    return this.prLists.get(`${args.project} ${args.repository}`) ?? [];
  }

  async getPullRequest(args: PrKey): Promise<GitPullRequest> {
    this.throwIfInjected("getPullRequest");
    const pr = this.prDetails.get(prKey(args));
    if (!pr) throw new Error(`FakeAdoClient.getPullRequest: no PR configured for ${prKey(args)}`);
    return pr;
  }

  async listPullRequestChanges(args: PrKey): Promise<GitPullRequestChange[]> {
    this.throwIfInjected("listPullRequestChanges");
    return this.prChanges.get(prKey(args)) ?? [];
  }

  async getFileContent(args: {
    project: string;
    repository: string;
    path: string;
    commitSha: string;
  }): Promise<string | null> {
    this.throwIfInjected("getFileContent");
    const k = `${args.project} ${args.repository} ${args.path} ${args.commitSha}`;
    return this.fileContents.has(k) ? (this.fileContents.get(k) ?? null) : null;
  }

  async listPullRequestThreads(args: PrKey): Promise<GitPullRequestCommentThread[]> {
    this.throwIfInjected("listPullRequestThreads");
    return this.prThreads.get(prKey(args)) ?? [];
  }

  async listPullRequestIterations(args: PrKey): Promise<GitPullRequestIteration[]> {
    this.throwIfInjected("listPullRequestIterations");
    return this.prIterations.get(prKey(args)) ?? [];
  }

  async createPullRequestThread(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    content: string;
    filePath?: string;
    line?: number;
  }): Promise<GitPullRequestCommentThread> {
    this.throwIfInjected("createPullRequestThread");
    const thread: GitPullRequestCommentThread = {
      id: 999,
      comments: [{ content: args.content, commentType: 1 }],
      status: 1,
      ...(args.filePath && args.line
        ? {
            threadContext: {
              filePath: args.filePath,
              rightFileStart: { line: args.line, offset: 1 },
              rightFileEnd: { line: args.line, offset: 1 },
            },
          }
        : {}),
    };
    this.createdThreads.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      thread,
    });
    return this.nextCreatedThread ?? thread;
  }

  async addPullRequestComment(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    threadId: number;
    content: string;
  }): Promise<Comment> {
    this.throwIfInjected("addPullRequestComment");
    const comment: Comment = { id: 999, content: args.content, commentType: 1 };
    this.createdComments.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      threadId: args.threadId,
      comment,
    });
    return this.nextCreatedComment ?? comment;
  }

  async updatePullRequestThreadStatus(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    threadId: number;
    status: CommentThreadStatus;
  }): Promise<GitPullRequestCommentThread> {
    this.throwIfInjected("updatePullRequestThreadStatus");
    this.threadStatusUpdates.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      threadId: args.threadId,
      status: args.status,
    });
    return this.nextUpdatedThread ?? { id: args.threadId, status: args.status };
  }

  async setPullRequestVote(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerId: string;
    vote: number;
  }): Promise<IdentityRefWithVote> {
    this.throwIfInjected("setPullRequestVote");
    this.voteUpdates.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      reviewerId: args.reviewerId,
      vote: args.vote,
    });
    return this.nextVoteResult ?? { id: args.reviewerId, vote: args.vote };
  }

  async updatePullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    title?: string;
    description?: string;
    isDraft?: boolean;
  }): Promise<GitPullRequest> {
    this.throwIfInjected("updatePullRequest");
    const update: Partial<GitPullRequest> = {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.isDraft !== undefined ? { isDraft: args.isDraft } : {}),
    };
    this.prUpdates.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      update,
    });
    return this.nextUpdatedPr ?? { pullRequestId: args.pullRequestId, ...update };
  }

  async addPullRequestReviewers(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerIds: string[];
  }): Promise<IdentityRefWithVote[]> {
    this.throwIfInjected("addPullRequestReviewers");
    this.reviewerAdds.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      reviewerIds: args.reviewerIds,
    });
    return this.nextAddedReviewers ?? args.reviewerIds.map((id) => ({ id, vote: 0 }));
  }

  async removePullRequestReviewer(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerId: string;
  }): Promise<void> {
    this.throwIfInjected("removePullRequestReviewer");
    this.reviewerRemoves.push({
      key: prKey({ project: args.project, repository: args.repository, pullRequestId: args.pullRequestId }),
      reviewerId: args.reviewerId,
    });
  }

  async listReleaseDefinitions(args: { project: string }): Promise<ReleaseDefinition[]> {
    this.throwIfInjected("listReleaseDefinitions");
    return this.releaseDefs.get(args.project) ?? [];
  }

  async listReleases(args: {
    project: string;
    definitionId?: number;
    status?: ReleaseStatus;
    top?: number;
  }): Promise<Release[]> {
    this.throwIfInjected("listReleases");
    return this.releases.get(args.project) ?? [];
  }

  async getRelease(args: { project: string; releaseId: number }): Promise<Release> {
    this.throwIfInjected("getRelease");
    const r = this.releaseDetails.get(`${args.project} ${args.releaseId}`);
    if (!r)
      throw new Error(
        `FakeAdoClient.getRelease: no release configured for ${args.project} ${args.releaseId}`,
      );
    return r;
  }

  async getReleaseDefinition(args: {
    project: string;
    definitionId: number;
  }): Promise<ReleaseDefinition> {
    this.throwIfInjected("getReleaseDefinition");
    const d = this.releaseDefDetails.get(`${args.project} ${args.definitionId}`);
    if (!d)
      throw new Error(
        `FakeAdoClient.getReleaseDefinition: no definition configured for ${args.project} ${args.definitionId}`,
      );
    return d;
  }

  async listDeployments(args: {
    project: string;
    definitionId?: number;
    deploymentStatus?: DeploymentStatus;
    top?: number;
  }): Promise<Deployment[]> {
    this.throwIfInjected("listDeployments");
    return this.deployments.get(args.project) ?? [];
  }

  async listPipelines(args: {
    project: string;
    repositoryId?: string;
  }): Promise<BuildDefinition[]> {
    this.throwIfInjected("listPipelines");
    return this.pipelines.get(args.project) ?? [];
  }

  async listPipelineRuns(args: {
    project: string;
    pipelineId?: number;
    branch?: string;
    status?: BuildStatus;
    result?: BuildResult;
    top?: number;
  }): Promise<Build[]> {
    this.throwIfInjected("listPipelineRuns");
    return this.pipelineRuns.get(args.project) ?? [];
  }

  async getPipelineRun(args: {
    project: string;
    runId: number;
  }): Promise<{ build: Build; timeline: Timeline | null }> {
    this.throwIfInjected("getPipelineRun");
    const d = this.pipelineRunDetails.get(`${args.project} ${args.runId}`);
    if (!d)
      throw new Error(
        `FakeAdoClient.getPipelineRun: no run configured for ${args.project} ${args.runId}`,
      );
    return d;
  }

  async getPipelineDefinition(args: {
    project: string;
    definitionId: number;
  }): Promise<BuildDefinition> {
    this.throwIfInjected("getPipelineDefinition");
    const d = this.pipelineDefDetails.get(`${args.project} ${args.definitionId}`);
    if (!d)
      throw new Error(
        `FakeAdoClient.getPipelineDefinition: no definition configured for ${args.project} ${args.definitionId}`,
      );
    return d;
  }

  private nextBuild?: Build;

  setNextBuild(build: Build): void {
    this.nextBuild = build;
  }

  async getBuild(args: { project: string; buildId: number }): Promise<Build> {
    this.throwIfInjected("getBuild");
    if (!this.nextBuild)
      throw new Error(`FakeAdoClient.getBuild: no build configured (setNextBuild not called)`);
    const b = this.nextBuild;
    this.nextBuild = undefined;
    return b;
  }

  async listBranches(args: {
    project: string;
    repository: string;
  }): Promise<GitBranchStats[]> {
    this.throwIfInjected("listBranches");
    return this.branches.get(`${args.project} ${args.repository}`) ?? [];
  }

  async listCommits(args: {
    project: string;
    repository: string;
    branch?: string;
    fromDate?: string;
    toDate?: string;
    author?: string;
    top?: number;
  }): Promise<GitCommitRef[]> {
    this.throwIfInjected("listCommits");
    return this.commits.get(`${args.project} ${args.repository}`) ?? [];
  }

  async createPullRequest(args: {
    project: string;
    repository: string;
    sourceRefName: string;
    targetRefName: string;
    title: string;
    description?: string;
    isDraft?: boolean;
    reviewerIds?: string[];
  }): Promise<GitPullRequest> {
    this.throwIfInjected("createPullRequest");
    const pr: GitPullRequest = {
      sourceRefName: args.sourceRefName,
      targetRefName: args.targetRefName,
      title: args.title,
      description: args.description,
      isDraft: args.isDraft,
      reviewers: args.reviewerIds?.map((id) => ({ id, vote: 0 })),
    };
    this.createdPrs.push({ project: args.project, repository: args.repository, pr });
    return this.nextCreatedPr ?? { ...pr, pullRequestId: 9999 };
  }

  async completePullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    mergeStrategy: GitPullRequestMergeStrategy;
    deleteSourceBranch?: boolean;
    mergeCommitMessage?: string;
    bypassPolicy?: boolean;
    bypassReason?: string;
    lastMergeSourceCommitId?: string;
  }): Promise<GitPullRequest> {
    this.throwIfInjected("completePullRequest");
    this.completedPrs.push({
      key: prKey({
        project: args.project,
        repository: args.repository,
        pullRequestId: args.pullRequestId,
      }),
      mergeStrategy: args.mergeStrategy,
    });
    return this.nextCompletedPr ?? { pullRequestId: args.pullRequestId, status: 3 };
  }

  async abandonPullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequest> {
    this.throwIfInjected("abandonPullRequest");
    this.abandonedPrs.push(
      prKey({
        project: args.project,
        repository: args.repository,
        pullRequestId: args.pullRequestId,
      }),
    );
    return this.nextAbandonedPr ?? { pullRequestId: args.pullRequestId, status: 2 };
  }

  async setPullRequestAutoComplete(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    autoCompleteSetById: string;
    completionOptions: GitPullRequestCompletionOptions;
  }): Promise<GitPullRequest> {
    this.throwIfInjected("setPullRequestAutoComplete");
    this.autoCompleteSet.push({
      key: prKey({
        project: args.project,
        repository: args.repository,
        pullRequestId: args.pullRequestId,
      }),
      setById: args.autoCompleteSetById,
      options: args.completionOptions,
    });
    return (
      this.nextAutoCompletedPr ?? {
        pullRequestId: args.pullRequestId,
        autoCompleteSetBy: { id: args.autoCompleteSetById },
      }
    );
  }

  // ---- phase-4.1 pipeline write state ----
  private queuedRuns: Array<{
    project: string;
    pipelineId: number;
    branch?: string;
    templateParameters?: Record<string, string>;
    variables?: Record<string, { value: string; isSecret?: boolean }>;
  }> = [];
  private nextQueuedRun?: Run;

  private cancelledRuns: Array<{ project: string; runId: number }> = [];
  private nextCancelledRun?: Build;

  private addedTags: Array<{ project: string; runId: number; tags: string[] }> = [];
  private removedTags: Array<{ project: string; runId: number; tag: string }> = [];
  private nextTagsState?: string[];

  setNextQueuedRun(run: Run): void {
    this.nextQueuedRun = run;
  }
  getQueuedRuns() {
    return this.queuedRuns;
  }

  setNextCancelledRun(build: Build): void {
    this.nextCancelledRun = build;
  }
  getCancelledRuns() {
    return this.cancelledRuns;
  }

  setNextTagsState(tags: string[]): void {
    this.nextTagsState = tags;
  }
  getAddedTags() {
    return this.addedTags;
  }
  getRemovedTags() {
    return this.removedTags;
  }

  async queuePipelineRun(args: {
    project: string;
    pipelineId: number;
    branch?: string;
    templateParameters?: Record<string, string>;
    variables?: Record<string, { value: string; isSecret?: boolean }>;
  }): Promise<Run> {
    this.throwIfInjected("queuePipelineRun");
    this.queuedRuns.push(args);
    if (!this.nextQueuedRun) {
      throw new Error("FakeAdoClient: setNextQueuedRun not called");
    }
    return this.nextQueuedRun;
  }

  async cancelPipelineRun(args: { project: string; runId: number }): Promise<Build> {
    this.throwIfInjected("cancelPipelineRun");
    this.cancelledRuns.push(args);
    if (!this.nextCancelledRun) {
      throw new Error("FakeAdoClient: setNextCancelledRun not called");
    }
    return this.nextCancelledRun;
  }

  async addBuildTags(args: { project: string; runId: number; tags: string[] }): Promise<string[]> {
    this.throwIfInjected("addBuildTags");
    this.addedTags.push(args);
    return this.nextTagsState ?? args.tags;
  }

  async removeBuildTag(args: { project: string; runId: number; tag: string }): Promise<string[]> {
    this.throwIfInjected("removeBuildTag");
    this.removedTags.push(args);
    return this.nextTagsState ?? [];
  }

  // ---- phase-4.1 release write state ----
  private createdReleases: Array<{ project: string; metadata: ReleaseStartMetadata }> = [];
  private nextCreatedRelease?: Release;

  private deployedEnvironments: Array<{
    project: string;
    releaseId: number;
    environmentId: number;
    update: ReleaseEnvironmentUpdateMetadata;
  }> = [];

  private cancelledReleases: Array<{ project: string; releaseId: number; comment?: string }> = [];
  private nextCancelledRelease?: Release;

  private approvedGates: Array<{
    project: string;
    approvalId: number;
    status: "approved" | "rejected";
    comment?: string;
  }> = [];
  private nextUpdatedApproval?: ReleaseApproval;

  setNextCreatedRelease(release: Release): void {
    this.nextCreatedRelease = release;
  }
  getCreatedReleases() {
    return this.createdReleases;
  }

  getDeployedEnvironments() {
    return this.deployedEnvironments;
  }

  setNextCancelledRelease(release: Release): void {
    this.nextCancelledRelease = release;
  }
  getCancelledReleases() {
    return this.cancelledReleases;
  }

  setNextUpdatedApproval(approval: ReleaseApproval): void {
    this.nextUpdatedApproval = approval;
  }
  getApprovedGates() {
    return this.approvedGates;
  }

  async createRelease(args: { project: string; metadata: ReleaseStartMetadata }): Promise<Release> {
    this.throwIfInjected("createRelease");
    this.createdReleases.push(args);
    if (!this.nextCreatedRelease) {
      throw new Error("FakeAdoClient: setNextCreatedRelease not called");
    }
    return this.nextCreatedRelease;
  }

  async updateReleaseEnvironment(args: {
    project: string;
    releaseId: number;
    environmentId: number;
    update: ReleaseEnvironmentUpdateMetadata;
  }): Promise<unknown> {
    this.throwIfInjected("updateReleaseEnvironment");
    this.deployedEnvironments.push(args);
    return {};
  }

  async cancelRelease(args: {
    project: string;
    releaseId: number;
    comment?: string;
  }): Promise<Release> {
    this.throwIfInjected("cancelRelease");
    this.cancelledReleases.push(args);
    if (!this.nextCancelledRelease) {
      throw new Error("FakeAdoClient: setNextCancelledRelease not called");
    }
    return this.nextCancelledRelease;
  }

  async updateReleaseApproval(args: {
    project: string;
    approvalId: number;
    status: "approved" | "rejected";
    comment?: string;
  }): Promise<ReleaseApproval> {
    this.throwIfInjected("updateReleaseApproval");
    this.approvedGates.push(args);
    if (!this.nextUpdatedApproval) {
      throw new Error("FakeAdoClient: setNextUpdatedApproval not called");
    }
    return this.nextUpdatedApproval;
  }

  // ---- phase-4.1 release read state ----
  private pendingApprovalsByKey = new Map<string, ReleaseApproval[]>();
  private pendingApprovalsCalls: Array<{
    project: string;
    releaseId?: number;
    assignedTo?: string;
  }> = [];

  setPendingApprovals(args: { project: string; releaseId?: number }, approvals: ReleaseApproval[]): void {
    this.pendingApprovalsByKey.set(`${args.project}|${args.releaseId ?? "*"}`, approvals);
  }

  getPendingApprovalsCalls() {
    return this.pendingApprovalsCalls;
  }

  async listPendingApprovals(args: {
    project: string;
    releaseId?: number;
    assignedTo?: string;
  }): Promise<ReleaseApproval[]> {
    this.throwIfInjected("listPendingApprovals");
    this.pendingApprovalsCalls.push(args);
    return (
      this.pendingApprovalsByKey.get(`${args.project}|${args.releaseId ?? "*"}`) ??
      this.pendingApprovalsByKey.get(`${args.project}|*`) ??
      []
    );
  }

  // ---- phase-4.2 pipeline write state ----
  private retriedStages: Array<{
    project: string;
    runId: number;
    stageName: string;
    forceRetryAllJobs?: boolean;
  }> = [];

  private pipelineDefUpdates: Array<{
    project: string;
    definitionId: number;
    definition: BuildDefinition;
  }> = [];
  private nextUpdatedPipelineDef?: BuildDefinition;

  getRetriedStages() {
    return this.retriedStages;
  }

  setNextUpdatedPipelineDef(def: BuildDefinition): void {
    this.nextUpdatedPipelineDef = def;
  }
  getPipelineDefUpdates() {
    return this.pipelineDefUpdates;
  }

  async retryBuildStage(args: {
    project: string;
    runId: number;
    stageName: string;
    forceRetryAllJobs?: boolean;
  }): Promise<void> {
    this.throwIfInjected("retryBuildStage");
    this.retriedStages.push(args);
  }

  async updatePipelineDefinition(args: {
    project: string;
    definitionId: number;
    definition: BuildDefinition;
  }): Promise<BuildDefinition> {
    this.throwIfInjected("updatePipelineDefinition");
    this.pipelineDefUpdates.push(args);
    return this.nextUpdatedPipelineDef ?? args.definition;
  }

  // ---- phase-4.2 release write state ----
  private releaseDefUpdates: Array<{
    project: string;
    definition: ReleaseDefinition;
  }> = [];
  private nextUpdatedReleaseDef?: ReleaseDefinition;

  setNextUpdatedReleaseDef(def: ReleaseDefinition): void {
    this.nextUpdatedReleaseDef = def;
  }
  getReleaseDefUpdates() {
    return this.releaseDefUpdates;
  }

  async updateReleaseDefinition(args: {
    project: string;
    definition: ReleaseDefinition;
  }): Promise<ReleaseDefinition> {
    this.throwIfInjected("updateReleaseDefinition");
    this.releaseDefUpdates.push(args);
    return this.nextUpdatedReleaseDef ?? args.definition;
  }
}
