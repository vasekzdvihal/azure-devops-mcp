import type { AdoClient } from '../../ado/client.js';
import type { RetentionLease } from '../../ado/types.js';

// Owner-id prefix → lease owner category. Provisional (Task 11 brief): these four prefixes are
// what ADO's documentation/behavior suggest, but they get verified against real lease data in
// Task 13. Unknown prefixes (including no prefix at all) map to 'other'.
const OWNER_PREFIXES = ['RM', 'Pipeline', 'Branch', 'User'] as const;

export type LeaseOwnerType = 'RM' | 'Pipeline' | 'Branch' | 'User' | 'other';

export interface LeaseSummary {
  leaseId: number;
  ownerId: string;
  ownerType: LeaseOwnerType;
  definitionId?: number;
  runId?: number;
  validUntil?: string;
  protectPipeline: boolean;
  createdOn?: string;
}

export interface BuildRetainer {
  releaseDefinitionId: number;
  name: string;
  artifactAlias: string;
  isPrimary: boolean;
}

// Reused by Task 12 (delete_build_lease) — keep this name and shape stable.
export function shapeLease(lease: RetentionLease): LeaseSummary {
  const ownerId = lease.ownerId ?? '';
  const prefix = ownerId.split(':')[0] ?? '';
  const ownerType = (OWNER_PREFIXES as readonly string[]).includes(prefix)
    ? (prefix as LeaseOwnerType)
    : 'other';
  return {
    leaseId: lease.leaseId ?? 0,
    ownerId,
    ownerType,
    definitionId: lease.definitionId,
    runId: lease.runId,
    validUntil: lease.validUntil?.toISOString(),
    protectPipeline: lease.protectPipeline ?? false,
    createdOn: lease.createdOn?.toISOString(),
  };
}

const BUILD_ARTIFACT_TYPE = 'Build';

export class RetentionReadService {
  constructor(private readonly client: AdoClient) {}

  async listBuildLeases(args: { project: string; buildId: number }): Promise<LeaseSummary[]> {
    const leases = await this.client.listBuildLeases(args);
    return leases.map(shapeLease);
  }

  async findBuildRetainers(args: {
    project: string;
    buildDefinitionId: number;
  }): Promise<BuildRetainer[]> {
    const defs = await this.client.listReleaseDefinitionsWithArtifacts({ project: args.project });
    const wanted = String(args.buildDefinitionId);
    return defs.flatMap(def =>
      (def.artifacts ?? [])
        .filter(artifact => artifact.type === BUILD_ARTIFACT_TYPE
          && artifact.definitionReference?.definition?.id === wanted)
        .map(artifact => ({
          releaseDefinitionId: def.id ?? 0,
          name: def.name ?? '',
          artifactAlias: artifact.alias ?? '',
          isPrimary: artifact.isPrimary ?? false,
        })),
    );
  }
}
