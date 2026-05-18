// src/ado/sdkClient.ts
import * as azdev from "azure-devops-node-api";
import https from "node:https";
import type { AdoClient } from "./client.js";
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
  RunPipelineParameters,
  GitBranchStats,
  GitCommitRef,
  GitQueryCommitsCriteria,
} from "./types.js";
import type { IPipelinesApi } from "azure-devops-node-api/PipelinesApi.js";
import { GitVersionType } from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { AdoError, mapSdkError, AdoNotFoundError, AdoUnknownError } from "./errors.js";
import { buildHttpsAgent } from "./tlsAgent.js";

export interface SdkAdoClientOptions {
  baseUrl: string;
  pat: string;
  caBundlePath?: string;
}

export class SdkAdoClient implements AdoClient {
  private readonly api: azdev.WebApi;
  private pipelinesApi?: Promise<IPipelinesApi>;

  private getPipelines(): Promise<IPipelinesApi> {
    return (this.pipelinesApi ??= this.api.getPipelinesApi());
  }

  constructor(opts: SdkAdoClientOptions) {
    const handler = azdev.getPersonalAccessTokenHandler(opts.pat);

    // azure-devops-node-api uses Node's http(s) module under the hood. There is
    // no per-request hook to inject an extra CA, so when one is configured we
    // swap Node's global https agent. Both the setup wizard and the server only
    // talk to one ADO instance per process, so this is safe.
    const agent = buildHttpsAgent(opts.caBundlePath);
    if (agent) https.globalAgent = agent;

    // Default socket timeout in typed-rest-client is 3 minutes — way too long
    // for a CLI tool when a firewall silently drops packets. 15s is plenty for
    // any ADO API we call and surfaces a useful error fast.
    this.api = new azdev.WebApi(opts.baseUrl, handler, { socketTimeout: 15_000 });
  }

  async whoami(): Promise<Identity> {
    try {
      const conn = await this.api.connect();
      const user = conn.authenticatedUser;
      if (!user) throw new AdoUnknownError("connect() returned no authenticatedUser");
      return user;
    } catch (err) {
      // Re-throw any of our own typed errors untouched; only map raw SDK errors.
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async listProjects(): Promise<TeamProjectReference[]> {
    try {
      const core = await this.api.getCoreApi();
      const projects = await core.getProjects();
      return projects;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async listRepositories(args: { project: string }): Promise<GitRepository[]> {
    try {
      const git = await this.api.getGitApi();
      const repos = await git.getRepositories(args.project);
      return repos;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async listPullRequests(args: {
    project: string;
    repository: string;
    status?: PullRequestStatus;
    creatorId?: string;
    reviewerId?: string;
    targetRefName?: string;
    top?: number;
    skip?: number;
  }): Promise<GitPullRequest[]> {
    try {
      const git = await this.api.getGitApi();
      const prs = await git.getPullRequests(
        args.repository,
        {
          status: args.status,
          creatorId: args.creatorId,
          reviewerId: args.reviewerId,
          targetRefName: args.targetRefName,
        },
        args.project,
        undefined, // maxCommentLength
        args.skip,
        args.top,
      );
      return prs;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async getPullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequest> {
    try {
      const git = await this.api.getGitApi();
      // getPullRequest (as opposed to getPullRequestById) takes the repo too,
      // which is useful for tenancy in on-prem.
      const pr = await git.getPullRequest(args.repository, args.pullRequestId, args.project);
      if (!pr) throw new AdoNotFoundError(`PR ${args.pullRequestId} not found`);
      return pr;
    } catch (err) {
      // Re-throw any of our own typed errors untouched; only map raw SDK errors.
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async listPullRequestChanges(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequestChange[]> {
    try {
      const git = await this.api.getGitApi();
      // The "changes" API is keyed by iteration. Use the latest iteration so the
      // result represents the PR's current state.
      const iterations = await git.getPullRequestIterations(
        args.repository,
        args.pullRequestId,
        args.project,
      );
      if (iterations.length === 0) {
        return [];
      }
      const latest = iterations.reduce((a, b) => ((a.id ?? 0) > (b.id ?? 0) ? a : b));
      const changes = await git.getPullRequestIterationChanges(
        args.repository,
        args.pullRequestId,
        latest.id ?? 1,
        args.project,
      );
      return changes.changeEntries ?? [];
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async getFileContent(args: {
    project: string;
    repository: string;
    path: string;
    commitSha: string;
  }): Promise<string | null> {
    try {
      const git = await this.api.getGitApi();
      const item = await git.getItem(
        args.repository,
        args.path,
        args.project,
        undefined, // scopePath
        undefined, // recursionLevel
        undefined, // includeContentMetadata
        undefined, // latestProcessedChange
        undefined, // download
        { version: args.commitSha, versionType: GitVersionType.Commit },
        true, // includeContent
      );
      return item.content ?? null;
    } catch (err) {
      const mapped = mapSdkError(err);
      // 404 is a normal "file did not exist at this commit" signal (e.g. for the
      // base side of an added file). Translate to null so the diff service can
      // produce an "added" diff rather than throwing.
      if (mapped instanceof AdoNotFoundError) return null;
      throw mapped;
    }
  }

  async listPullRequestThreads(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequestCommentThread[]> {
    try {
      const git = await this.api.getGitApi();
      const threads = await git.getThreads(args.repository, args.pullRequestId, args.project);
      return threads;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async listPullRequestIterations(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequestIteration[]> {
    try {
      const git = await this.api.getGitApi();
      const iterations = await git.getPullRequestIterations(
        args.repository,
        args.pullRequestId,
        args.project,
      );
      return iterations;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async createPullRequestThread(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    content: string;
    filePath?: string;
    line?: number;
  }): Promise<GitPullRequestCommentThread> {
    try {
      const git = await this.api.getGitApi();
      const thread: GitPullRequestCommentThread = {
        comments: [{ content: args.content, commentType: 1 /* text */, parentCommentId: 0 }],
        status: 1 /* active */,
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
      const created = await git.createThread(thread, args.repository, args.pullRequestId, args.project);
      return created;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async addPullRequestComment(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    threadId: number;
    content: string;
  }): Promise<Comment> {
    try {
      const git = await this.api.getGitApi();
      const comment: Comment = { content: args.content, commentType: 1 /* text */, parentCommentId: 0 };
      const created = await git.createComment(
        comment,
        args.repository,
        args.pullRequestId,
        args.threadId,
        args.project,
      );
      return created;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async updatePullRequestThreadStatus(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    threadId: number;
    status: CommentThreadStatus;
  }): Promise<GitPullRequestCommentThread> {
    try {
      const git = await this.api.getGitApi();
      const update: GitPullRequestCommentThread = { status: args.status };
      const updated = await git.updateThread(
        update,
        args.repository,
        args.pullRequestId,
        args.threadId,
        args.project,
      );
      return updated;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async setPullRequestVote(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerId: string;
    vote: number;
  }): Promise<IdentityRefWithVote> {
    try {
      const git = await this.api.getGitApi();
      const reviewer: IdentityRefWithVote = { vote: args.vote };
      const updated = await git.createPullRequestReviewer(
        reviewer,
        args.repository,
        args.pullRequestId,
        args.reviewerId,
        args.project,
      );
      return updated;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async updatePullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    title?: string;
    description?: string;
    isDraft?: boolean;
  }): Promise<GitPullRequest> {
    try {
      const git = await this.api.getGitApi();
      const update: GitPullRequest = {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.isDraft !== undefined ? { isDraft: args.isDraft } : {}),
      };
      const updated = await git.updatePullRequest(
        update,
        args.repository,
        args.pullRequestId,
        args.project,
      );
      return updated;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async addPullRequestReviewers(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerIds: string[];
  }): Promise<IdentityRefWithVote[]> {
    try {
      const git = await this.api.getGitApi();
      const reviewers = args.reviewerIds.map((id) => ({ id }));
      const added = await git.createPullRequestReviewers(
        reviewers,
        args.repository,
        args.pullRequestId,
        args.project,
      );
      return added;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async removePullRequestReviewer(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    reviewerId: string;
  }): Promise<void> {
    try {
      const git = await this.api.getGitApi();
      await git.deletePullRequestReviewer(
        args.repository,
        args.pullRequestId,
        args.reviewerId,
        args.project,
      );
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
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
    try {
      const git = await this.api.getGitApi();
      const pr: GitPullRequest = {
        sourceRefName: args.sourceRefName,
        targetRefName: args.targetRefName,
        title: args.title,
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.isDraft !== undefined ? { isDraft: args.isDraft } : {}),
        ...(args.reviewerIds && args.reviewerIds.length > 0
          ? { reviewers: args.reviewerIds.map((id) => ({ id, vote: 0 })) }
          : {}),
      };
      const created = await git.createPullRequest(pr, args.repository, args.project);
      return created;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
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
    try {
      const git = await this.api.getGitApi();
      // ADO requires lastMergeSourceCommit to confirm the caller saw current state.
      // Fetch it if the caller didn't supply one — saves the LLM a get_pull_request hop.
      let sourceSha = args.lastMergeSourceCommitId;
      if (!sourceSha) {
        const current = await git.getPullRequest(
          args.repository,
          args.pullRequestId,
          args.project,
        );
        sourceSha = current.lastMergeSourceCommit?.commitId;
        if (!sourceSha) {
          throw new AdoUnknownError(
            `PR ${args.pullRequestId} has no lastMergeSourceCommit yet — merge processing may still be queued.`,
          );
        }
      }
      const update: GitPullRequest = {
        status: 3, // Completed
        lastMergeSourceCommit: { commitId: sourceSha },
        completionOptions: {
          mergeStrategy: args.mergeStrategy,
          ...(args.deleteSourceBranch !== undefined
            ? { deleteSourceBranch: args.deleteSourceBranch }
            : {}),
          ...(args.mergeCommitMessage !== undefined
            ? { mergeCommitMessage: args.mergeCommitMessage }
            : {}),
          ...(args.bypassPolicy !== undefined ? { bypassPolicy: args.bypassPolicy } : {}),
          ...(args.bypassReason !== undefined ? { bypassReason: args.bypassReason } : {}),
        },
      };
      const completed = await git.updatePullRequest(
        update,
        args.repository,
        args.pullRequestId,
        args.project,
      );
      return completed;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async abandonPullRequest(args: {
    project: string;
    repository: string;
    pullRequestId: number;
  }): Promise<GitPullRequest> {
    try {
      const git = await this.api.getGitApi();
      const update: GitPullRequest = { status: 2 /* Abandoned */ };
      const updated = await git.updatePullRequest(
        update,
        args.repository,
        args.pullRequestId,
        args.project,
      );
      return updated;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async setPullRequestAutoComplete(args: {
    project: string;
    repository: string;
    pullRequestId: number;
    autoCompleteSetById: string;
    completionOptions: GitPullRequestCompletionOptions;
  }): Promise<GitPullRequest> {
    try {
      const git = await this.api.getGitApi();
      const update: GitPullRequest = {
        autoCompleteSetBy: { id: args.autoCompleteSetById },
        completionOptions: args.completionOptions,
      };
      const updated = await git.updatePullRequest(
        update,
        args.repository,
        args.pullRequestId,
        args.project,
      );
      return updated;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  // -------- releases --------

  async listReleaseDefinitions(args: { project: string }): Promise<ReleaseDefinition[]> {
    try {
      const rel = await this.api.getReleaseApi();
      const defs = await rel.getReleaseDefinitions(args.project);
      return defs;
    } catch (err) {
      const mapped = mapSdkError(err);
      // A 404 on the first release endpoint hit in a project is almost
      // certainly "classic releases are not enabled on this collection"
      // rather than "project missing" — other tools against the same
      // project would have 404'd before reaching this code path.
      if (mapped instanceof AdoNotFoundError) {
        throw new AdoNotFoundError(
          "Release API unavailable — this collection may not have classic releases enabled, " +
            "or the project name is wrong. " +
            mapped.message.replace(/^.*Details:\s*/, "Details: "),
        );
      }
      throw mapped;
    }
  }

  async listReleases(args: {
    project: string;
    definitionId?: number;
    status?: ReleaseStatus;
    top?: number;
  }): Promise<Release[]> {
    try {
      const rel = await this.api.getReleaseApi();
      const releases = await rel.getReleases(
        args.project,
        args.definitionId,
        undefined, // definitionEnvironmentId
        undefined, // searchText
        undefined, // createdBy
        args.status,
        undefined, // environmentStatusFilter
        undefined, // minCreatedTime
        undefined, // maxCreatedTime
        undefined, // queryOrder
        args.top,
      );
      return releases;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async getRelease(args: { project: string; releaseId: number }): Promise<Release> {
    try {
      const rel = await this.api.getReleaseApi();
      const release = await rel.getRelease(args.project, args.releaseId);
      if (!release) throw new AdoNotFoundError(`Release ${args.releaseId} not found`);
      return release;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async getReleaseDefinition(args: {
    project: string;
    definitionId: number;
  }): Promise<ReleaseDefinition> {
    try {
      const rel = await this.api.getReleaseApi();
      const def = await rel.getReleaseDefinition(args.project, args.definitionId);
      if (!def)
        throw new AdoNotFoundError(`Release definition ${args.definitionId} not found`);
      return def;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async listDeployments(args: {
    project: string;
    definitionId?: number;
    deploymentStatus?: DeploymentStatus;
    top?: number;
  }): Promise<Deployment[]> {
    try {
      const rel = await this.api.getReleaseApi();
      const deployments = await rel.getDeployments(
        args.project,
        args.definitionId,
        undefined, // definitionEnvironmentId
        undefined, // createdBy
        undefined, // minModifiedTime
        undefined, // maxModifiedTime
        args.deploymentStatus,
        undefined, // operationStatus
        undefined, // latestAttemptsOnly
        undefined, // queryOrder
        args.top,
      );
      return deployments;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  // -------- pipelines (BuildApi) --------

  async listPipelines(args: {
    project: string;
    repositoryId?: string;
  }): Promise<BuildDefinition[]> {
    try {
      const build = await this.api.getBuildApi();
      // includeAllProperties=true returns BuildDefinition[] (with process + repository)
      // rather than the shallow BuildDefinitionReference[] default.
      const defs = await build.getDefinitions(
        args.project,
        undefined, // name
        args.repositoryId,
        undefined, // repositoryType
        undefined, // queryOrder
        undefined, // top
        undefined, // continuationToken
        undefined, // minMetricsTime
        undefined, // definitionIds
        undefined, // path
        undefined, // builtAfter
        undefined, // notBuiltAfter
        true, // includeAllProperties
      );
      return defs as BuildDefinition[];
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async listPipelineRuns(args: {
    project: string;
    pipelineId?: number;
    branch?: string;
    status?: BuildStatus;
    result?: BuildResult;
    top?: number;
  }): Promise<Build[]> {
    try {
      const build = await this.api.getBuildApi();
      const runs = await build.getBuilds(
        args.project,
        args.pipelineId !== undefined ? [args.pipelineId] : undefined,
        undefined, // queues
        undefined, // buildNumber
        undefined, // minTime
        undefined, // maxTime
        undefined, // requestedFor
        undefined, // reasonFilter
        args.status,
        args.result,
        undefined, // tagFilters
        undefined, // properties
        args.top,
        undefined, // continuationToken
        undefined, // maxBuildsPerDefinition
        undefined, // deletedFilter
        undefined, // queryOrder
        args.branch,
      );
      return runs;
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async getPipelineRun(args: {
    project: string;
    runId: number;
  }): Promise<{ build: Build; timeline: Timeline | null }> {
    try {
      const build = await this.api.getBuildApi();
      const b = await build.getBuild(args.project, args.runId);
      if (!b) throw new AdoNotFoundError(`Pipeline run ${args.runId} not found`);
      // Timeline can be null for very old runs that never started a plan.
      let timeline: Timeline | null = null;
      try {
        timeline = await build.getBuildTimeline(args.project, args.runId);
      } catch {
        timeline = null;
      }
      return { build: b, timeline };
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async getPipelineDefinition(args: {
    project: string;
    definitionId: number;
  }): Promise<BuildDefinition> {
    try {
      const build = await this.api.getBuildApi();
      const def = await build.getDefinition(args.project, args.definitionId);
      if (!def)
        throw new AdoNotFoundError(`Pipeline definition ${args.definitionId} not found`);
      return def;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async getBuild(args: { project: string; buildId: number }): Promise<Build> {
    try {
      const build = await this.api.getBuildApi();
      const b = await build.getBuild(args.project, args.buildId);
      if (!b) throw new AdoNotFoundError(`Build ${args.buildId} not found`);
      return b;
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  // -------- pipelines (PipelinesApi / BuildApi write ops) --------

  async queuePipelineRun(args: {
    project: string;
    pipelineId: number;
    branch?: string;
    templateParameters?: Record<string, string>;
    variables?: Record<string, { value: string; isSecret?: boolean }>;
  }): Promise<Run> {
    try {
      const pipelines = await this.getPipelines();
      const runParameters: RunPipelineParameters = {
        templateParameters: args.templateParameters,
        variables: args.variables,
        resources: args.branch
          ? { repositories: { self: { refName: args.branch } } }
          : undefined,
      };
      return await pipelines.runPipeline(runParameters, args.project, args.pipelineId);
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async cancelPipelineRun(args: { project: string; runId: number }): Promise<Build> {
    try {
      const build = await this.api.getBuildApi();
      return await build.updateBuild(
        { status: /* BuildStatus.Cancelling */ 4 } as Build,
        args.project,
        args.runId,
      );
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async addBuildTags(args: { project: string; runId: number; tags: string[] }): Promise<string[]> {
    try {
      const build = await this.api.getBuildApi();
      return await build.addBuildTags(args.tags, args.project, args.runId);
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async removeBuildTag(args: { project: string; runId: number; tag: string }): Promise<string[]> {
    try {
      const build = await this.api.getBuildApi();
      return await build.deleteBuildTag(args.project, args.runId, args.tag);
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async createRelease(args: {
    project: string;
    metadata: ReleaseStartMetadata;
  }): Promise<Release> {
    try {
      const rel = await this.api.getReleaseApi();
      return await rel.createRelease(args.metadata, args.project);
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async updateReleaseEnvironment(args: {
    project: string;
    releaseId: number;
    environmentId: number;
    update: ReleaseEnvironmentUpdateMetadata;
  }): Promise<unknown> {
    try {
      const rel = await this.api.getReleaseApi();
      return await rel.updateReleaseEnvironment(
        args.update,
        args.project,
        args.releaseId,
        args.environmentId,
      );
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async cancelRelease(args: {
    project: string;
    releaseId: number;
    comment?: string;
  }): Promise<Release> {
    try {
      const rel = await this.api.getReleaseApi();
      return await rel.updateRelease(
        { status: /* ReleaseStatus.Abandoned */ 4, comment: args.comment } as Release,
        args.project,
        args.releaseId,
      );
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async updateReleaseApproval(args: {
    project: string;
    approvalId: number;
    status: "approved" | "rejected";
    comment?: string;
  }): Promise<ReleaseApproval> {
    try {
      const rel = await this.api.getReleaseApi();
      // ApprovalStatus: Approved=2, Rejected=4
      const numericStatus = args.status === "approved" ? 2 : 4;
      return await rel.updateReleaseApproval(
        { status: numericStatus, comments: args.comment } as ReleaseApproval,
        args.project,
        args.approvalId,
      );
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  async listPendingApprovals(args: {
    project: string;
    releaseId?: number;
    assignedTo?: string;
  }): Promise<ReleaseApproval[]> {
    try {
      const rel = await this.api.getReleaseApi();
      const result = await rel.getApprovals(
        args.project,
        args.assignedTo,
        /* ApprovalStatus.Pending */ 1,
        args.releaseId ? [args.releaseId] : undefined,
      );
      // PagedList behaves array-like; coerce to a plain array for stable typing.
      return Array.from(result ?? []);
    } catch (err) {
      if (err instanceof AdoError) throw err;
      throw mapSdkError(err);
    }
  }

  // -------- commits & branches --------

  async listBranches(args: {
    project: string;
    repository: string;
  }): Promise<GitBranchStats[]> {
    try {
      const git = await this.api.getGitApi();
      const branches = await git.getBranches(args.repository, args.project);
      return branches;
    } catch (err) {
      throw mapSdkError(err);
    }
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
    try {
      const git = await this.api.getGitApi();
      const criteria: GitQueryCommitsCriteria = {
        ...(args.branch
          ? { itemVersion: { version: args.branch, versionType: 0 /* Branch */ } }
          : {}),
        ...(args.fromDate ? { fromDate: args.fromDate } : {}),
        ...(args.toDate ? { toDate: args.toDate } : {}),
        ...(args.author ? { author: args.author } : {}),
      };
      const commits = await git.getCommits(
        args.repository,
        criteria,
        args.project,
        undefined, // skip
        args.top,
      );
      return commits;
    } catch (err) {
      throw mapSdkError(err);
    }
  }
}
