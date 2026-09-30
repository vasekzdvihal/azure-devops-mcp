import type { ToolDefinition } from '../identity/tools.js';
import type { RetentionReadService } from './readService.js';
import { FindBuildRetainersInput, ListBuildLeasesInput } from './schemas.js';

export function buildRetentionReadTools(svc: RetentionReadService): ToolDefinition[] {
  return [
    {
      name: 'list_build_leases',
      config: {
        title: 'List retention leases on a build',
        description:
          'Lists the retention leases on a build — why it cannot be deleted. ownerType: RM (a '
          + 'classic release), Pipeline (pipeline retention), Branch (branch retention policy), '
          + 'User (manual "retain"), other. protectPipeline: true also blocks deleting the '
          + 'pipeline definition. Remove a lease with delete_build_lease.',
        inputSchema: ListBuildLeasesInput,
      },
      handler: async args => svc.listBuildLeases(args as Parameters<typeof svc.listBuildLeases>[0]),
    },
    {
      name: 'find_build_retainers',
      config: {
        title: 'Find classic release definitions retaining a build definition',
        description:
          'Finds classic release definitions that still use a build definition as a Build '
          + 'artifact — they keep its builds retained. Scans every release definition in the '
          + 'project.',
        inputSchema: FindBuildRetainersInput,
      },
      handler: async args =>
        svc.findBuildRetainers(args as Parameters<typeof svc.findBuildRetainers>[0]),
    },
  ];
}
