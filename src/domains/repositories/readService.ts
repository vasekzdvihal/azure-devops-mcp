import type { AdoClient } from '../../ado/client.js';
import type { GitRepository } from '../../ado/types.js';

export interface RepoSummary {
  id: string;
  name: string;
  defaultBranch?: string; // refs/heads/ prefix stripped for readability
  webUrl?: string;
  isDisabled?: boolean;
  isInMaintenance?: boolean;
  size?: number;
}

export class RepositoriesReadService {
  constructor(private readonly client: AdoClient) {}

  async list(args: { project: string }): Promise<RepoSummary[]> {
    const repos = await this.client.listRepositories(args);
    return repos.map(shape);
  }
}

function shape(repo: GitRepository): RepoSummary {
  const branch = repo.defaultBranch?.replace(/^refs\/heads\//, '');
  return {
    id: repo.id ?? '',
    name: repo.name ?? '',
    defaultBranch: branch,
    webUrl: repo.webUrl,
    isDisabled: repo.isDisabled,
    isInMaintenance: repo.isInMaintenance,
    size: repo.size,
  };
}
