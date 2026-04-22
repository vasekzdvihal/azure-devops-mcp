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
}
