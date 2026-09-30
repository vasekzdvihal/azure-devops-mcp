import type { AdoClient } from '../../ado/client.js';
import type { RepoResolver } from '../pullRequests/repoResolution.js';
import { GitRefUpdateStatus } from '../../ado/types.js';
import { detectRepo } from '../../git/detectRepo.js';
import { resolveRepo } from '../pullRequests/repoResolution.js';
import { shortBranch } from './readService.js';

const SHA_LENGTH = 40;
const ZERO_SHA = '0'.repeat(SHA_LENGTH);
const SHA_RE = /^[0-9a-f]{40}$/i;

export interface CreateBranchResult {
  name: string;
  objectId: string;
}

export class CommitsWriteService {
  constructor(
    private readonly client: AdoClient,
    private readonly resolver: RepoResolver = detectRepo,
  ) {}

  async createBranch(args: { project?: string; repository?: string; name: string; from: string }): Promise<CreateBranchResult> {
    const { project, repository } = await resolveRepo(args, this.resolver);
    const name = shortBranch(args.name);
    const sha = SHA_RE.test(args.from) ? args.from.toLowerCase() : await this.headOf(project, repository, args.from);
    const [result] = await this.client.updateRefs({
      project,
      repository,
      updates: [{ name: `refs/heads/${name}`, oldObjectId: ZERO_SHA, newObjectId: sha }],
    });
    if (!result?.success) {
      const status = result?.updateStatus;
      const label = status === undefined ? 'unknown' : lowerFirst(GitRefUpdateStatus[status] ?? String(status));
      // Plain Error, not AdoConflictError: that class's message says "state changed, re-fetch",
      // which is wrong for an existing branch or a policy rejection.
      throw new Error(
        `create_branch: Azure DevOps rejected creating '${name}' (${label})${result?.customMessage ? `: ${result.customMessage}` : ''}.`,
      );
    }
    return { name, objectId: sha };
  }

  private async headOf(project: string, repository: string, from: string): Promise<string> {
    const branch = await this.client.getBranch({ project, repository, branch: shortBranch(from) });
    const sha = branch?.commit?.commitId;
    if (!sha) {
      throw new Error(`create_branch: source branch '${shortBranch(from)}' not found in ${repository}.`);
    }
    return sha;
  }
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
