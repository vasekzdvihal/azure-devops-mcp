import type { AdoClient } from '../../ado/client.js';
import type { LeaseSummary } from './readService.js';
import { shapeLease } from './readService.js';

export class RetentionWriteService {
  constructor(private readonly client: AdoClient) {}

  async deleteBuildLease(args: {
    project: string;
    buildId: number;
    leaseId: number;
    force?: boolean;
  }): Promise<{ deleted: true; lease: LeaseSummary }> {
    const leases = (await this.client.listBuildLeases({ project: args.project, buildId: args.buildId }))
      .map(shapeLease);
    const lease = leases.find(candidate => candidate.leaseId === args.leaseId);
    if (!lease) {
      throw new Error(
        `delete_build_lease: lease ${args.leaseId} is not on build ${args.buildId} `
        + `(leases there: ${leases.map(candidate => candidate.leaseId).join(', ') || 'none'}).`,
      );
    }
    if (lease.leaseId === 0) {
      throw new Error(
        `delete_build_lease: the matched lease on build ${args.buildId} has no real ADO lease id `
        + '(shapeLease defaulted it to 0); refusing to delete lease id 0.',
      );
    }
    if (lease.protectPipeline && !args.force) {
      throw new Error(
        `delete_build_lease: lease ${lease.leaseId} protects the pipeline (owner ${lease.ownerId}). `
        + 'Confirm with the user, then retry with force: true.',
      );
    }
    await this.client.deleteRetentionLeases({ project: args.project, leaseIds: [lease.leaseId] });
    return { deleted: true, lease };
  }
}
