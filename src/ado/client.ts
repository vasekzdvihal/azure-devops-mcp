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
}
