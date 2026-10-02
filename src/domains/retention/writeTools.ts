import type { ToolDefinition } from '../identity/tools.js';
import type { RetentionWriteService } from './writeService.js';
import { DeleteBuildLeaseInput } from './schemas.js';

export function buildRetentionWriteTools(svc: RetentionWriteService): ToolDefinition[] {
  return [
    {
      name: 'delete_build_lease',
      config: {
        title: 'Delete a retention lease from a build',
        description:
          '**Always confirm with the user before calling — retention may be what keeps this '
          + 'build for audit or compliance, and deletion is irreversible.** Removes one lease '
          + '(from list_build_leases) so the build can be cleaned up or its pipeline deleted. '
          + 'Refuses leases with protectPipeline: true unless force: true. Returns the deleted lease.',
        inputSchema: DeleteBuildLeaseInput,
      },
      handler: async args =>
        svc.deleteBuildLease(args as Parameters<typeof svc.deleteBuildLease>[0]),
    },
  ];
}
