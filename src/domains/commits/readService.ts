import type { AdoClient } from "../../ado/client.js";
import type { GitBranchStats, GitCommitRef } from "../../ado/types.js";
import { detectRepo } from "../../git/detectRepo.js";
import {
  resolveRepo,
  type RepoResolver,
} from "../pullRequests/repoResolution.js";

export { RepoContextError } from "../pullRequests/repoResolution.js";

export interface BranchSummary {
  name: string;
  lastCommitId?: string;
  aheadCount?: number;
  behindCount?: number;
  isBaseVersion?: boolean;
}

export interface CommitSummary {
  commitId: string;
  comment?: string;
  author?: { name?: string; email?: string; date?: string };
  committer?: { name?: string; email?: string; date?: string };
  changeCounts?: { Add?: number; Edit?: number; Delete?: number };
  url?: string;
}

export class CommitsReadService {
  constructor(
    private readonly client: AdoClient,
    private readonly resolver: RepoResolver = detectRepo,
  ) {}

  async listBranches(args: {
    project?: string;
    repository?: string;
  }): Promise<BranchSummary[]> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const branches = await this.client.listBranches({ project, repository });
    return branches.map(shapeBranch);
  }

  async listCommits(args: {
    project?: string;
    repository?: string;
    branch?: string;
    fromDate?: string;
    toDate?: string;
    author?: string;
    top?: number;
  }): Promise<CommitSummary[]> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const commits = await this.client.listCommits({
      project,
      repository,
      branch: args.branch,
      fromDate: args.fromDate,
      toDate: args.toDate,
      author: args.author,
      top: args.top,
    });
    return commits.map(shapeCommit);
  }
}

function shapeBranch(b: GitBranchStats): BranchSummary {
  return {
    name: b.name ?? "",
    lastCommitId: b.commit?.commitId,
    aheadCount: b.aheadCount,
    behindCount: b.behindCount,
    isBaseVersion: b.isBaseVersion,
  };
}

function shapeCommit(c: GitCommitRef): CommitSummary {
  return {
    commitId: c.commitId ?? "",
    comment: c.comment,
    author: c.author
      ? {
          name: c.author.name,
          email: c.author.email,
          date: c.author.date?.toISOString(),
        }
      : undefined,
    committer: c.committer
      ? {
          name: c.committer.name,
          email: c.committer.email,
          date: c.committer.date?.toISOString(),
        }
      : undefined,
    changeCounts: c.changeCounts,
    url: c.url,
  };
}
