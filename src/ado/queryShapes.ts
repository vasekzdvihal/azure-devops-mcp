// src/ado/queryShapes.ts
// Pure builders for the request shapes SdkAdoClient hands to the SDK. Extracted so the
// exact objects can be unit-tested — the fake AdoClient used by domain tests never sees
// these shapes, so a wrong field name here is invisible until it hits a real server.
import type {
  GitBaseVersionDescriptor,
  GitQueryCommitsCriteria,
  GitTargetVersionDescriptor,
  GitVersionDescriptor,
} from './types.js';
import { GitVersionType } from 'azure-devops-node-api/interfaces/GitInterfaces.js';

export interface BranchDiffDescriptors {
  base: GitBaseVersionDescriptor;
  target: GitTargetVersionDescriptor;
}

/**
 * Descriptors for `GitApi.getCommitDiffs`. The SDK types them as
 * `GitBaseVersionDescriptor` / `GitTargetVersionDescriptor`, which declare
 * `baseVersion*` / `targetVersion*` fields — but GitApi.getCommitDiffs only reads the
 * inherited `GitVersionDescriptor` fields (`.version`, `.versionType`, `.versionOptions`)
 * and maps them onto the `baseVersion*` / `targetVersion*` query params itself. Setting
 * the `baseVersion*` fields sends nothing, and ADO silently compares the default branch
 * with itself (0 ahead / 0 behind). Both types extend GitVersionDescriptor, so the
 * shape below type-checks without a cast.
 */
export function branchDiffDescriptors(base: string, target: string): BranchDiffDescriptors {
  return {
    base: { version: base, versionType: GitVersionType.Branch },
    target: { version: target, versionType: GitVersionType.Branch },
  };
}

export interface CommitQueryArgs {
  branch?: string;
  notInBranch?: string;
  fromDate?: string;
  toDate?: string;
  author?: string;
}

/**
 * Search criteria for `GitApi.getCommits`.
 *
 * Verified against a live ADO Server: with both `itemVersion` and `compareVersion` set,
 * ADO returns the commits reachable from `compareVersion` that are NOT reachable from
 * `itemVersion`. So "commits on `branch` not in `notInBranch`" means
 * `itemVersion = notInBranch`, `compareVersion = branch`. Without `notInBranch`, the plain
 * history of `branch` is `itemVersion = branch`.
 */
export function commitQueryCriteria(args: CommitQueryArgs): GitQueryCommitsCriteria {
  return {
    ...branchRangeCriteria(args.branch, args.notInBranch),
    ...(args.fromDate ? { fromDate: args.fromDate } : {}),
    ...(args.toDate ? { toDate: args.toDate } : {}),
    ...(args.author ? { author: args.author } : {}),
  };
}

function branchDescriptor(name: string): GitVersionDescriptor {
  return { version: name, versionType: GitVersionType.Branch };
}

function branchRangeCriteria(
  branch: string | undefined,
  notInBranch: string | undefined,
): Pick<GitQueryCommitsCriteria, 'compareVersion' | 'itemVersion'> {
  if (notInBranch) {
    return {
      itemVersion: branchDescriptor(notInBranch),
      ...(branch ? { compareVersion: branchDescriptor(branch) } : {}),
    };
  }
  return branch ? { itemVersion: branchDescriptor(branch) } : {};
}
