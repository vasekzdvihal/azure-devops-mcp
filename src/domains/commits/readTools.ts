import type { ToolDefinition } from '../identity/tools.js';
import type { CommitsReadService } from './readService.js';
import { CompareBranchesInput, ListBranchesInput, ListCommitsInput } from './schemas.js';

export function buildCommitsReadTools(svc: CommitsReadService): ToolDefinition[] {
  return [
    {
      name: 'list_branches',
      config: {
        title: 'List branches in a repository',
        description:
          'Lists branches in an Azure DevOps git repository, each with the last commit id and '
          + 'ahead/behind counts vs the default branch, or vs `baseBranch` when given. Use `names` '
          + 'to check specific branches (e.g. main/staging/develop) without listing every branch — '
          + 'the result then includes `missing`. If `project` and `repository` are omitted, they '
          + 'are auto-detected from the current working directory\'s git remote.',
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
          + 'X since last Monday?\'. Project and repository auto-detect from cwd if omitted.'
          + ' Use `notInBranch` for a commit range. Each commit includes author.name and '
          + 'author.email (use the email for identity lookups, e.g. Slack users.lookupByEmail).',
        inputSchema: ListCommitsInput,
      },
      handler: async args =>
        svc.listCommits(args as Parameters<typeof svc.listCommits>[0]),
    },
    {
      name: 'compare_branches',
      config: {
        title: 'Compare two branches',
        description:
          'Compares two branches: aheadCount = commits in `target` not in `base`, behindCount = '
          + 'commits in `base` not in `target`, plus the merge base and file change counts. '
          + 'aheadCount 0 means merging target into base brings nothing. Set includeCommits to '
          + 'also list those commits with author name + email. Project and repository auto-detect '
          + 'from cwd if omitted.',
        inputSchema: CompareBranchesInput,
      },
      handler: async args =>
        svc.compareBranches(args as Parameters<typeof svc.compareBranches>[0]),
    },
  ];
}
