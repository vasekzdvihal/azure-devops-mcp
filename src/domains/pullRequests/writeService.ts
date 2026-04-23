// src/domains/pullRequests/writeService.ts
import type { AdoClient } from "../../ado/client.js";
import type {
  CommentThreadStatus,
  GitPullRequest,
  GitPullRequestCommentThread,
  IdentityRefWithVote,
} from "../../ado/types.js";
import { detectRepo } from "../../git/detectRepo.js";
import { resolveRepo, type RepoResolver } from "./repoResolution.js";

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
  0: "unknown",
  1: "active",
  2: "fixed",
  3: "wontFix",
  4: "closed",
  5: "byDesign",
  6: "pending",
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
  10: "approve",
  5: "approveWithSuggestions",
  0: "reset",
  [-5]: "wait",
  [-10]: "reject",
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
    if (!me.id) throw new Error("whoami() returned identity without id");
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
      throw new Error("updatePullRequest requires at least one of title or description");
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
      added: added.map((r) => ({
        id: r.id,
        name: r.displayName,
        vote: r.vote ?? 0,
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
}

// --- shapers (pure) ---

function shapeThreadResult(t: GitPullRequestCommentThread): AddCommentResult {
  return {
    threadId: t.id ?? 0,
    status: THREAD_STATUS_FROM_ENUM[t.status ?? 0] ?? "unknown",
  };
}

function shapeVoteResult(r: IdentityRefWithVote, requestedVote: string): VoteResult {
  return {
    vote: VOTE_FROM_NUMBER[r.vote ?? 0] ?? requestedVote,
    reviewer: r.displayName,
    reviewerId: r.id,
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
