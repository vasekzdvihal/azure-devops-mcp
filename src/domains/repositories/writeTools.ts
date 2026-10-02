import type { ToolDefinition } from '../identity/tools.js';
import type { RepositoriesWriteService } from './writeService.js';
import { z } from 'zod';

export function buildRepositoriesWriteTools(svc: RepositoriesWriteService): ToolDefinition[] {
  return [
    {
      name: 'set_default_branch',
      config: {
        title: 'Set a repository\'s default branch',
        description:
          '**Always confirm with the user before calling — this changes the default branch for '
          + 'everyone using the repository (new PR targets, clone checkout).** Sets the default '
          + 'branch of one repository. The branch must already exist. Returns previous and current values.',
        inputSchema: {
          project: z.string().min(1).describe('The Azure DevOps project name.'),
          repository: z.string().min(1).describe('The repository name.'),
          branch: z.string().min(1).describe(
            'The branch to make the default (short name or full refs/heads/ ref). Must already exist.',
          ),
        },
      },
      handler: async args =>
        svc.setDefaultBranch(args as Parameters<typeof svc.setDefaultBranch>[0]),
    },
  ];
}
