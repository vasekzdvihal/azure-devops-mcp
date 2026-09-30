import type { ToolDefinition } from '../identity/tools.js';
import type { CommitsWriteService } from './writeService.js';
import { CreateBranchInput } from './schemas.js';

export function buildCommitsWriteTools(svc: CommitsWriteService): ToolDefinition[] {
  return [
    {
      name: 'create_branch',
      config: {
        title: 'Create a branch',
        description:
          'Creates a new branch pointing at `from` (a branch name or a 40-char commit sha) '
          + 'without cloning. Fails if the branch already exists or a policy blocks it. Project '
          + 'and repository auto-detect from cwd if omitted. There is intentionally no '
          + 'delete-branch tool.',
        inputSchema: CreateBranchInput,
      },
      handler: async args =>
        svc.createBranch(args as Parameters<typeof svc.createBranch>[0]),
    },
  ];
}
