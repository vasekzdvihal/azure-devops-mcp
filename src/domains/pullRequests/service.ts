import type { AdoClient } from "../../ado/client.js";
import type {
  GitPullRequest,
  GitPullRequestChange,
  GitPullRequestCommentThread,
  GitPullRequestIteration,
  PullRequestStatus,
} from "../../ado/types.js";
import { detectRepo } from "../../git/detectRepo.js";
import type { ParsedRemote } from "../../git/parseRemoteUrl.js";
import { shapeDiff } from "./diffShaper.js";

export class RepoContextError extends Error {
  constructor() {
    super(
      "Could not resolve project + repository. Either pass them explicitly " +
        "or run from inside an Azure DevOps git checkout (with `origin` set).",
    );
    this.name = "RepoContextError";
  }
}

export type RepoResolver = (cwd?: string) => Promise<ParsedRemote | null>;

const STATUS_FROM_ENUM: Record<number, string> = {
  0: "notSet",
  1: "active",
  2: "abandoned",
  3: "completed",
  4: "all",
};

const STATUS_TO_ENUM: Record<string, PullRequestStatus> = {
  notSet: 0,
  active: 1,
  abandoned: 2,
  completed: 3,
  all: 4,
};

const CHANGE_TYPE_FROM_ENUM: Record<number, string> = {
  0: "none",
  1: "add",
  2: "edit",
  4: "encoding",
  8: "rename",
  16: "delete",
  32: "undelete",
  64: "branch",
  128: "merge",
  256: "lock",
  512: "rollback",
  1024: "sourceRename",
  2048: "targetRename",
};

const COMMENT_STATUS_FROM_ENUM: Record<number, string> = {
  0: "unknown",
  1: "active",
  2: "fixed",
  3: "wontFix",
  4: "closed",
  5: "byDesign",
  6: "pending",
};

export interface PrSummary {
  id: number;
  title: string;
  status: string;
  author?: string;
  sourceBranch?: string;
  targetBranch?: string;
  createdAt?: string;
  url?: string;
}

export interface PrDetail extends PrSummary {
  description?: string;
  isDraft?: boolean;
  reviewers: Array<{ name?: string; vote: number }>;
  mergeStatus?: string;
}

export interface PrChange {
  path: string;
  changeType: string;
  originalPath?: string;
}

export interface PrCommentThread {
  threadId: number;
  status: string;
  filePath?: string;
  line?: number;
  comments: Array<{
    author?: string;
    content?: string;
    publishedDate?: string;
  }>;
}

export interface PrIterationSummary {
  id: number;
  description?: string;
  createdDate?: string;
}

export class PullRequestsService {
  constructor(
    private readonly client: AdoClient,
    private readonly resolveRepo: RepoResolver = detectRepo,
  ) {}

  // -------- repo resolution --------
  private async resolve(args: {
    project?: string;
    repository?: string;
  }): Promise<{ project: string; repository: string }> {
    if (args.project && args.repository) {
      return { project: args.project, repository: args.repository };
    }
    const detected = await this.resolveRepo();
    const project = args.project ?? detected?.project;
    const repository = args.repository ?? detected?.repo;
    if (!project || !repository) throw new RepoContextError();
    return { project, repository };
  }

  // -------- tools --------
  async list(args: {
    project?: string;
    repository?: string;
    status?: string;
    creatorId?: string;
    reviewerId?: string;
    targetRefName?: string;
    top?: number;
    skip?: number;
  }): Promise<PrSummary[]> {
    const { project, repository } = await this.resolve(args);
    const statusStr = args.status ?? "active";
    const status: PullRequestStatus | undefined = STATUS_TO_ENUM[statusStr];
    const prs = await this.client.listPullRequests({
      project,
      repository,
      status,
      creatorId: args.creatorId,
      reviewerId: args.reviewerId,
      targetRefName: args.targetRefName,
      top: args.top,
      skip: args.skip,
    });
    return prs.map(shapePrSummary);
  }

  async get(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
  }): Promise<PrDetail> {
    const { project, repository } = await this.resolve(args);
    const pr = await this.client.getPullRequest({
      project,
      repository,
      pullRequestId: args.pullRequestId,
    });
    return shapePrDetail(pr);
  }

  async listChanges(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
  }): Promise<PrChange[]> {
    const { project, repository } = await this.resolve(args);
    const changes = await this.client.listPullRequestChanges({
      project,
      repository,
      pullRequestId: args.pullRequestId,
    });
    return changes.map(shapeChange);
  }

  async getDiff(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    path: string;
    maxLines?: number;
  }): Promise<string> {
    const { project, repository } = await this.resolve(args);
    const pr = await this.client.getPullRequest({
      project,
      repository,
      pullRequestId: args.pullRequestId,
    });
    const baseSha = pr.lastMergeTargetCommit?.commitId;
    const targetSha = pr.lastMergeSourceCommit?.commitId;
    if (!baseSha || !targetSha) {
      throw new Error(
        `PR ${args.pullRequestId} has no merge SHAs yet (lastMergeTargetCommit / lastMergeSourceCommit). It may still be queued for processing.`,
      );
    }
    const [base, target] = await Promise.all([
      this.client.getFileContent({ project, repository, path: args.path, commitSha: baseSha }),
      this.client.getFileContent({ project, repository, path: args.path, commitSha: targetSha }),
    ]);
    return shapeDiff({ path: args.path, base, target, maxLines: args.maxLines });
  }

  async listComments(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
  }): Promise<PrCommentThread[]> {
    const { project, repository } = await this.resolve(args);
    const threads = await this.client.listPullRequestThreads({
      project,
      repository,
      pullRequestId: args.pullRequestId,
    });
    return threads.map(shapeThread);
  }

  async getIterations(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
  }): Promise<PrIterationSummary[]> {
    const { project, repository } = await this.resolve(args);
    const iterations = await this.client.listPullRequestIterations({
      project,
      repository,
      pullRequestId: args.pullRequestId,
    });
    return iterations.map(shapeIteration);
  }
}

// -------- shapers (pure) --------
function shapePrSummary(pr: GitPullRequest): PrSummary {
  return {
    id: pr.pullRequestId ?? 0,
    title: pr.title ?? "",
    status: STATUS_FROM_ENUM[pr.status ?? 0] ?? "unknown",
    author: pr.createdBy?.displayName,
    sourceBranch: pr.sourceRefName?.replace(/^refs\/heads\//, ""),
    targetBranch: pr.targetRefName?.replace(/^refs\/heads\//, ""),
    createdAt: pr.creationDate?.toISOString(),
    url: pr.url,
  };
}

function shapePrDetail(pr: GitPullRequest): PrDetail {
  return {
    ...shapePrSummary(pr),
    description: pr.description,
    isDraft: pr.isDraft,
    reviewers: (pr.reviewers ?? []).map((r) => ({
      name: r.displayName,
      vote: r.vote ?? 0,
    })),
    mergeStatus: pr.mergeStatus !== undefined ? String(pr.mergeStatus) : undefined,
  };
}

function shapeChange(c: GitPullRequestChange): PrChange {
  const ct =
    typeof c.changeType === "number" ? CHANGE_TYPE_FROM_ENUM[c.changeType] : undefined;
  return {
    path: c.item?.path ?? "",
    changeType: ct ?? "other",
    originalPath: c.originalPath,
  };
}

function shapeThread(t: GitPullRequestCommentThread): PrCommentThread {
  return {
    threadId: t.id ?? 0,
    status: COMMENT_STATUS_FROM_ENUM[t.status ?? 0] ?? "unknown",
    filePath: t.threadContext?.filePath,
    line: t.threadContext?.rightFileStart?.line,
    comments: (t.comments ?? []).map((c) => ({
      author: c.author?.displayName,
      content: c.content,
      publishedDate: c.publishedDate?.toISOString(),
    })),
  };
}

function shapeIteration(it: GitPullRequestIteration): PrIterationSummary {
  return {
    id: it.id ?? 0,
    description: it.description,
    createdDate: it.createdDate?.toISOString(),
  };
}
