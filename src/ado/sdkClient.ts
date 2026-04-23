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
} from "./types.js";
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
}
