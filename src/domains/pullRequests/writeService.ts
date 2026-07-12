// src/domains/pullRequests/writeService.ts
import type { AdoClient } from '../../ado/client.js';
import type {
  CommentThreadStatus,
  GitPullRequest,
  GitPullRequestCommentThread,
  GitPullRequestMergeStrategy,
  IdentityRefWithVote,
} from '../../ado/types.js';
import type { RepoResolver } from './repoResolution.js';
import { detectRepo } from '../../git/detectRepo.js';
import { resolveRepo } from './repoResolution.js';

const MERGE_STRATEGY_TO_ENUM: Record<string, GitPullRequestMergeStrategy> = {
  noFastForward: 1,
  squash: 2,
  rebase: 3,
  rebaseMerge: 4,
};

// PullRequestStatus enum from ADO (Phase 1 readService also has this map).
const PR_STATUS_FROM_ENUM: Record<number, string> = {
  0: 'notSet',
  1: 'active',
  2: 'abandoned',
  3: 'completed',
  4: 'all',
};

function ensureRefsHeads(branch: string): string {
  return branch.startsWith('refs/') ? branch : `refs/heads/${branch}`;
}

// --- enum mappings (mirrors readService's reverse maps) ---

const THREAD_STATUS_TO_ENUM: Record<string, CommentThreadStatus> = {
  active: 1,
  fixed: 2,
  wontFix: 3,
  closed: 4,
  byDesign: 5,
  pending: 6,
};

const THREAD_STATUS_FROM_ENUM: Record<number, string> = {
  0: 'unknown',
  1: 'active',
  2: 'fixed',
  3: 'wontFix',
  4: 'closed',
  5: 'byDesign',
  6: 'pending',
};

// ADO vote values (numeric, no enum in the SDK's PullRequestVote interface).
// 10 = approve, 5 = approve with suggestions, 0 = no vote / reset, -5 = wait, -10 = reject.
const VOTE_TO_NUMBER: Record<string, number> = {
  approve: 10,
  approveWithSuggestions: 5,
  wait: -5,
  reject: -10,
  reset: 0,
};

const VOTE_FROM_NUMBER: Record<number, string> = {
  10: 'approve',
  5: 'approveWithSuggestions',
  0: 'reset',
  [-5]: 'wait',
  [-10]: 'reject',
};

// --- response shapes ---

export interface AddCommentResult {
  threadId: number;
  status: string;
}

export interface UpdateThreadStatusResult {
  threadId: number;
  status: string;
}

export interface VoteResult {
  vote: string;
  reviewer?: string;
  reviewerId?: string;
}

export interface UpdatePrResult {
  pullRequestId: number;
  title?: string;
  description?: string;
  isDraft?: boolean;
}

export interface AddReviewersResult {
  added: Array<{ id?: string; name?: string; vote: number }>;
}

// --- service ---

export class PullRequestsWriteService {
  constructor(
    private readonly client: AdoClient,
    private readonly resolver: RepoResolver = detectRepo,
  ) {}

  async addComment(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    content: string;
    filePath?: string;
    line?: number;
  }): Promise<AddCommentResult> {
    // filePath and line must be set together — otherwise the caller likely
    // intended a line-anchored comment but it would silently become a general
    // PR comment. Catch the mistake at the service boundary.
    if ((args.filePath && !args.line) || (!args.filePath && args.line)) {
      throw new Error(
        'add_pull_request_comment: filePath and line must be provided together. '
        + 'Pass both for a line-anchored comment, or neither for a general PR comment.',
      );
    }
    const { project, repository } = await resolveRepo(args, this.resolver);
    const thread = await this.client.createPullRequestThread({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      content: args.content,
      ...(args.filePath ? { filePath: args.filePath } : {}),
      ...(args.line ? { line: args.line } : {}),
    });
    return shapeThreadResult(thread);
  }

  async replyToThread(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    threadId: number;
    content: string;
  }): Promise<{ commentId?: number }> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const comment = await this.client.addPullRequestComment({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      threadId: args.threadId,
      content: args.content,
    });
    return { commentId: comment.id };
  }

  async updateThreadStatus(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    threadId: number;
    status: string;
  }): Promise<UpdateThreadStatusResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const enumValue = THREAD_STATUS_TO_ENUM[args.status];
    if (enumValue === undefined) {
      throw new Error(`Unknown thread status: ${args.status}`);
    }
    const updated = await this.client.updatePullRequestThreadStatus({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      threadId: args.threadId,
      status: enumValue,
    });
    return shapeThreadResult(updated);
  }

  async vote(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    vote: string;
  }): Promise<VoteResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const voteNumber = VOTE_TO_NUMBER[args.vote];
    if (voteNumber === undefined) {
      throw new Error(`Unknown vote value: ${args.vote}`);
    }
    const me = await this.client.whoami();
    if (!me.id) {
      throw new Error('whoami() returned identity without id');
    }
    const updated = await this.client.setPullRequestVote({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      reviewerId: me.id,
      vote: voteNumber,
    });
    return shapeVoteResult(updated, args.vote);
  }

  async updatePullRequest(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    title?: string;
    description?: string;
  }): Promise<UpdatePrResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    if (args.title === undefined && args.description === undefined) {
      throw new Error('updatePullRequest requires at least one of title or description');
    }
    const updated = await this.client.updatePullRequest({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
    });
    return shapePrResult(updated);
  }

  async setDraftState(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    isDraft: boolean;
  }): Promise<UpdatePrResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const updated = await this.client.updatePullRequest({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      isDraft: args.isDraft,
    });
    return shapePrResult(updated);
  }

  async addReviewers(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    reviewerIds: string[];
  }): Promise<AddReviewersResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const added = await this.client.addPullRequestReviewers({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      reviewerIds: args.reviewerIds,
    });
    return {
      added: added.map(reviewer => ({
        id: reviewer.id,
        name: reviewer.displayName,
        vote: reviewer.vote ?? 0,
      })),
    };
  }

  async removeReviewer(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    reviewerId: string;
  }): Promise<{ removed: string }> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    await this.client.removePullRequestReviewer({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      reviewerId: args.reviewerId,
    });
    return { removed: args.reviewerId };
  }

  // --- lifecycle (Phase 2.1) ---

  async createPr(args: {
    project?: string;
    repository?: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description?: string;
    isDraft?: boolean;
    reviewerIds?: string[];
  }): Promise<{
    pullRequestId: number;
    title?: string;
    sourceBranch?: string;
    targetBranch?: string;
    isDraft?: boolean;
    url?: string;
  }> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const created = await this.client.createPullRequest({
      project,
      repository,
      sourceRefName: ensureRefsHeads(args.sourceBranch),
      targetRefName: ensureRefsHeads(args.targetBranch),
      title: args.title,
      description: args.description,
      isDraft: args.isDraft,
      reviewerIds: args.reviewerIds,
    });
    return {
      pullRequestId: created.pullRequestId ?? 0,
      title: created.title,
      sourceBranch: created.sourceRefName?.replace(/^refs\/heads\//, ''),
      targetBranch: created.targetRefName?.replace(/^refs\/heads\//, ''),
      isDraft: created.isDraft,
      url: created.url,
    };
  }

  async completePr(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    mergeStrategy: string;
    deleteSourceBranch?: boolean;
    mergeCommitMessage?: string;
    bypassPolicy?: boolean;
    bypassReason?: string;
  }): Promise<{ pullRequestId: number; status: string }> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const strategy = MERGE_STRATEGY_TO_ENUM[args.mergeStrategy];
    if (!strategy) {
      throw new Error(`Unknown merge strategy '${args.mergeStrategy}'`);
    }
    const completed = await this.client.completePullRequest({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      mergeStrategy: strategy,
      deleteSourceBranch: args.deleteSourceBranch,
      mergeCommitMessage: args.mergeCommitMessage,
      bypassPolicy: args.bypassPolicy,
      bypassReason: args.bypassReason,
    });
    return {
      pullRequestId: completed.pullRequestId ?? args.pullRequestId,
      status: PR_STATUS_FROM_ENUM[completed.status ?? 0] ?? 'unknown',
    };
  }

  async abandonPr(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
  }): Promise<{ pullRequestId: number; status: string }> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const updated = await this.client.abandonPullRequest({
      project,
      repository,
      pullRequestId: args.pullRequestId,
    });
    return {
      pullRequestId: updated.pullRequestId ?? args.pullRequestId,
      status: PR_STATUS_FROM_ENUM[updated.status ?? 0] ?? 'unknown',
    };
  }

  async setAutoComplete(args: {
    project?: string;
    repository?: string;
    pullRequestId: number;
    mergeStrategy: string;
    deleteSourceBranch?: boolean;
    mergeCommitMessage?: string;
  }): Promise<{ pullRequestId: number; autoCompleteSetById?: string }> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const strategy = MERGE_STRATEGY_TO_ENUM[args.mergeStrategy];
    if (!strategy) {
      throw new Error(`Unknown merge strategy '${args.mergeStrategy}'`);
    }
    // Use the configured PAT's identity as the auto-complete owner — mirrors what
    // the ADO web UI does when a user clicks "Set auto-complete".
    const me = await this.client.whoami();
    if (!me.id) {
      throw new Error('Cannot set auto-complete — whoami returned no identity id.');
    }
    const updated = await this.client.setPullRequestAutoComplete({
      project,
      repository,
      pullRequestId: args.pullRequestId,
      autoCompleteSetById: me.id,
      completionOptions: {
        mergeStrategy: strategy,
        ...(args.deleteSourceBranch !== undefined
          ? { deleteSourceBranch: args.deleteSourceBranch }
          : {}),
        ...(args.mergeCommitMessage !== undefined
          ? { mergeCommitMessage: args.mergeCommitMessage }
          : {}),
      },
    });
    return {
      pullRequestId: updated.pullRequestId ?? args.pullRequestId,
      autoCompleteSetById: updated.autoCompleteSetBy?.id,
    };
  }
}

// --- shapers (pure) ---

function shapeThreadResult(thread: GitPullRequestCommentThread): AddCommentResult {
  return {
    threadId: thread.id ?? 0,
    status: THREAD_STATUS_FROM_ENUM[thread.status ?? 0] ?? 'unknown',
  };
}

function shapeVoteResult(reviewer: IdentityRefWithVote, _requestedVote: string): VoteResult {
  // Echo back what ADO actually stored, not what the user asked for.
  // If ADO returned an unknown numeric value we surface "unknown" rather than
  // pretending the requested vote was applied.
  return {
    vote: VOTE_FROM_NUMBER[reviewer.vote ?? 0] ?? 'unknown',
    reviewer: reviewer.displayName,
    reviewerId: reviewer.id,
  };
}

function shapePrResult(pr: GitPullRequest): UpdatePrResult {
  return {
    pullRequestId: pr.pullRequestId ?? 0,
    title: pr.title,
    description: pr.description,
    isDraft: pr.isDraft,
  };
}
