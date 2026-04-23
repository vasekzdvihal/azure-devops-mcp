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
}
