import type { ToolDefinition } from '../identity/tools.js';
import type { RepositoriesService } from './service.js';
import { z } from 'zod';

export function buildRepositoriesTools(svc: RepositoriesService): ToolDefinition[] {
  return [
    {
      name: 'list_repositories',
      config: {
        title: 'List git repositories in a project',
        description:
          'Lists all git repositories in the given Azure DevOps project. '
          + 'Use this to discover repository names and ids needed by the pull-request tools. '
          + 'Each repo includes defaultBranch (absent = never pushed to), size in bytes '
          + '(0 = empty), isDisabled and isInMaintenance.',
        inputSchema: {
          project: z.string().min(1).describe('The Azure DevOps project name.'),
        },
      },
      handler: async args =>
        svc.list({ project: args.project as string }),
    },
  ];
}
