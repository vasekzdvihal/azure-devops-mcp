import type { AdoClient } from '../../ado/client.js';
import type { RetentionLease } from '../../ado/types.js';
import type { LeaseSummary } from './readService.js';
import { shapeLease } from './readService.js';

interface LeasePair {
  raw: RetentionLease;
  shaped: LeaseSummary;
}

export class RetentionWriteService {
  constructor(private readonly client: AdoClient) {}

  async deleteBuildLease(args: {
    project: string;
    buildId: number;
    leaseId: number;
    force?: boolean;
  }): Promise<{ deleted: true; lease: LeaseSummary }> {
    const rawLeases = await this.client.listBuildLeases({ project: args.project, buildId: args.buildId });
    const pairs: LeasePair[] = rawLeases.map(raw => ({ raw, shaped: shapeLease(raw) }));
    const match = pairs.find(pair => pair.shaped.leaseId === args.leaseId);
    if (!match) {
      throw new Error(
        `delete_build_lease: lease ${args.leaseId} is not on build ${args.buildId} `
        + `(leases there: ${pairs.map(pair => pair.shaped.leaseId).join(', ') || 'none'}).`,
      );
    }
    const { raw: rawLease, shaped: lease } = match;
    if (lease.leaseId === 0) {
      throw new Error(
        `delete_build_lease: the matched lease on build ${args.buildId} has no id returned by `
        + 'Azure DevOps and cannot be deleted safely.',
      );
    }
    // Fail closed: an ADO lease with protectPipeline omitted is treated the same as `true` — only
    // an explicit `protectPipeline: false` skips the force requirement. shapeLease defaults a
    // missing protectPipeline to `false` for read-side display, so that shaped value is not safe
    // to gate deletion on; decide from the raw SDK lease instead.
    const requiresForce = rawLease.protectPipeline !== false;
    if (requiresForce && !args.force) {
      throw new Error(
        `delete_build_lease: lease ${lease.leaseId} protects the pipeline (owner ${lease.ownerId}). `
        + 'Confirm with the user, then retry with force: true.',
      );
    }
    await this.client.deleteRetentionLeases({ project: args.project, leaseIds: [lease.leaseId] });
    return { deleted: true, lease };
  }
}
