import type { ToolDefinition } from '../identity/tools.js';
import type { CommitsReadService } from './readService.js';
import { ListBranchesInput, ListCommitsInput } from './schemas.js';

export function buildCommitsReadTools(svc: CommitsReadService): ToolDefinition[] {
  return [
    {
      name: 'list_branches',
      config: {
        title: 'List branches in a repository',
        description:
          'Lists branches in an Azure DevOps git repository, each with the last commit id and '
          + 'ahead/behind counts vs the base version. If `project` and `repository` are omitted, '
          + 'they are auto-detected from the current working directory\'s git remote.',
        inputSchema: ListBranchesInput,
      },
      handler: async args =>
        svc.listBranches(args as Parameters<typeof svc.listBranches>[0]),
    },
    {
      name: 'list_commits',
      config: {
        title: 'List commits in a branch',
        description:
          'Lists commits with optional filters: branch (name, e.g. \'main\'), fromDate/toDate '
          + '(ISO-8601), author (name or email substring). Use this to answer \'what changed on '
          + 'X since last Monday?\'. Project and repository auto-detect from cwd if omitted.',
        inputSchema: ListCommitsInput,
      },
      handler: async args =>
        svc.listCommits(args as Parameters<typeof svc.listCommits>[0]),
    },
  ];
}
