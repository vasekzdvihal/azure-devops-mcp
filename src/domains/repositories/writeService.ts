import type { AdoClient } from '../../ado/client.js';
import { findRepositoryByName } from '../../ado/repositories.js';

export interface SetDefaultBranchResult {
  repository: string;
  previous?: string;
  current: string;
}

export class RepositoriesWriteService {
  constructor(private readonly client: AdoClient) {}

  async setDefaultBranch(args: {
    project: string;
    repository: string;
    branch: string;
  }): Promise<SetDefaultBranchResult> {
    const repos = await this.client.listRepositories({ project: args.project });
    const repo = findRepositoryByName(repos, args.repository);
    if (!repo?.id) {
      throw new Error(`set_default_branch: repository '${args.repository}' not found in project '${args.project}'.`);
    }
    const branch = args.branch.replace(/^refs\/heads\//, '');
    const exists = await this.client.getBranch({ project: args.project, repository: repo.id, branch });
    if (!exists) {
      throw new Error(`set_default_branch: branch '${branch}' does not exist in ${repo.name}; create it first (create_branch).`);
    }
    const updated = await this.client.updateRepositoryDefaultBranch({
      project: args.project,
      repositoryId: repo.id,
      defaultBranch: `refs/heads/${branch}`,
    });
    return {
      repository: repo.name ?? args.repository,
      previous: repo.defaultBranch?.replace(/^refs\/heads\//, ''),
      current: (updated.defaultBranch ?? `refs/heads/${branch}`).replace(/^refs\/heads\//, ''),
    };
  }
}
