import type {
  Identity,
  TeamProjectReference,
  GitRepository,
  GitPullRequest,
  GitPullRequestIteration,
  GitPullRequestCommentThread,
  GitPullRequestChange,
  PullRequestStatus,
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
}
