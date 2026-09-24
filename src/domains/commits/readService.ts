import type { AdoClient } from '../../ado/client.js';
import type { GitBranchStats, GitCommitRef } from '../../ado/types.js';
import type { RepoResolver } from '../pullRequests/repoResolution.js';
import { detectRepo } from '../../git/detectRepo.js';
import { resolveRepo } from '../pullRequests/repoResolution.js';

export { RepoContextError } from '../pullRequests/repoResolution.js';

export interface BranchSummary {
  name: string;
  lastCommitId?: string;
  aheadCount?: number;
  behindCount?: number;
  isBaseVersion?: boolean;
}

export interface FilteredBranches {
  branches: BranchSummary[];
  missing: string[];
}

export function shortBranch(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}

export interface CommitSummary {
  commitId: string;
  comment?: string;
  author?: { name?: string; email?: string; date?: string };
  committer?: { name?: string; email?: string; date?: string };
  changeCounts?: { Add?: number; Edit?: number; Delete?: number };
  url?: string;
}

export interface BranchComparison {
  base: string;
  target: string;
  /** Commits in `target` that are not in `base`. */
  aheadCount: number;
  /** Commits in `base` that are not in `target`. */
  behindCount: number;
  commonCommit?: string;
  changeCounts?: { Add?: number; Edit?: number; Delete?: number };
  commits?: CommitSummary[];
}

// ADO GitChange.changeType wire values (only the ones getCommitDiffs.changeCounts uses).
const CHANGE_TYPE_ADD = 1;
const CHANGE_TYPE_EDIT = 2;
const CHANGE_TYPE_DELETE = 16;

const CHANGE_TYPE_NAMES: Record<number, 'Add' | 'Edit' | 'Delete'> = {
  [CHANGE_TYPE_ADD]: 'Add',
  [CHANGE_TYPE_EDIT]: 'Edit',
  [CHANGE_TYPE_DELETE]: 'Delete',
};

const DEFAULT_COMPARE_COMMITS_TOP = 100;

export class CommitsReadService {
  constructor(
    private readonly client: AdoClient,
    private readonly resolver: RepoResolver = detectRepo,
  ) {}

  async listBranches(args: {
    project?: string;
    repository?: string;
    baseBranch?: string;
    names?: string[];
    nameContains?: string;
  }): Promise<BranchSummary[] | FilteredBranches> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const raw = await this.client.listBranches({
      project,
      repository,
      ...(args.baseBranch ? { baseBranch: shortBranch(args.baseBranch) } : {}),
    });
    let branches = raw.map(shapeBranch);
    if (args.nameContains) {
      const needle = args.nameContains.toLowerCase();
      branches = branches.filter(branch => branch.name.toLowerCase().includes(needle));
    }
    if (!args.names) {
      return branches;
    }
    const wanted = args.names.map(shortBranch);
    const byName = new Map(branches.map(branch => [branch.name, branch]));
    return {
      branches: wanted.flatMap(name => byName.get(name) ?? []),
      missing: wanted.filter(name => !byName.has(name)),
    };
  }

  async listCommits(args: {
    project?: string;
    repository?: string;
    branch?: string;
    notInBranch?: string;
    fromDate?: string;
    toDate?: string;
    author?: string;
    top?: number;
  }): Promise<CommitSummary[]> {
    if (args.notInBranch && !args.branch) {
      throw new Error('list_commits: `notInBranch` requires `branch` (commits in `branch` that are not in `notInBranch`).');
    }
    const { project, repository } = await resolveRepo(args, this.resolver);
    const commits = await this.client.listCommits({
      project,
      repository,
      branch: args.branch ? shortBranch(args.branch) : undefined,
      notInBranch: args.notInBranch ? shortBranch(args.notInBranch) : undefined,
      fromDate: args.fromDate,
      toDate: args.toDate,
      author: args.author,
      top: args.top,
    });
    return commits.map(shapeCommit);
  }

  async compareBranches(args: {
    project?: string;
    repository?: string;
    base: string;
    target: string;
    includeCommits?: boolean;
    top?: number;
  }): Promise<BranchComparison> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const base = shortBranch(args.base);
    const target = shortBranch(args.target);
    const diffs = await this.client.getCommitDiffs({ project, repository, base, target });
    const result: BranchComparison = {
      base,
      target,
      aheadCount: diffs.aheadCount ?? 0,
      behindCount: diffs.behindCount ?? 0,
      ...(diffs.commonCommit ? { commonCommit: diffs.commonCommit } : {}),
      ...(diffs.changeCounts ? { changeCounts: nameChangeCounts(diffs.changeCounts) } : {}),
    };
    if (args.includeCommits) {
      result.commits = await this.listCommits({
        project,
        repository,
        branch: target,
        notInBranch: base,
        top: args.top ?? DEFAULT_COMPARE_COMMITS_TOP,
      });
    }
    return result;
  }
}

function nameChangeCounts(counts: Record<number, number>): BranchComparison['changeCounts'] {
  const named: NonNullable<BranchComparison['changeCounts']> = {};
  for (const [key, value] of Object.entries(counts)) {
    const name = CHANGE_TYPE_NAMES[Number(key)];
    if (name) {
      named[name] = value;
    }
  }
  return named;
}

function shapeBranch(branch: GitBranchStats): BranchSummary {
  return {
    name: shortBranch(branch.name ?? ''),
    lastCommitId: branch.commit?.commitId,
    aheadCount: branch.aheadCount,
    behindCount: branch.behindCount,
    isBaseVersion: branch.isBaseVersion,
  };
}

function shapeCommit(commit: GitCommitRef): CommitSummary {
  return {
    commitId: commit.commitId ?? '',
    comment: commit.comment,
    author: commit.author
      ? {
          name: commit.author.name,
          email: commit.author.email,
          date: commit.author.date?.toISOString(),
        }
      : undefined,
    committer: commit.committer
      ? {
          name: commit.committer.name,
          email: commit.committer.email,
          date: commit.committer.date?.toISOString(),
        }
      : undefined,
    changeCounts: commit.changeCounts,
    url: commit.url,
  };
}
