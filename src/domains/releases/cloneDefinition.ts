import type { ReleaseDefinition, ReleaseDefinitionEnvironment } from '../../ado/types.js';
import { ReleaseDefinitionSource } from '../../ado/types.js';

/**
 * Prepare a fetched release definition for POST as a *new* definition.
 *
 * Rules (see spec §"Clone-strip rules"): server-owned identity/audit fields are removed at
 * the top level; every environment/approval/gate id is reset to 0 (matching the REST 7.1
 * "Definitions - Create" sample); `deployStep`, `badgeUrl`, `currentRelease` are dropped;
 * `environmentTriggers` are emptied because they reference the *source* definition's
 * environment ids. Everything else — deploy phases, tasks, queue ids, approvals, conditions,
 * artifacts, triggers, variables — is preserved verbatim. Returns a new object; the input is
 * not mutated.
 */
export function stripForClone(def: ReleaseDefinition): ReleaseDefinition {
  // Structured clone keeps Dates/nested objects intact and guarantees no aliasing with input.
  const copy = structuredClone(def) as ReleaseDefinition & Record<string, unknown>;

  delete copy.id;
  delete copy.revision;
  delete copy.url;
  delete copy._links;
  delete copy.createdBy;
  delete copy.createdOn;
  delete copy.modifiedBy;
  delete copy.modifiedOn;
  delete copy.lastRelease;
  delete copy.isDeleted;
  delete copy.comment;
  copy.source = ReleaseDefinitionSource.RestApi;

  copy.environments = (copy.environments ?? []).map(stripEnvironment);
  return copy;
}

function stripEnvironment(env: ReleaseDefinitionEnvironment): ReleaseDefinitionEnvironment {
  const out = { ...env } as ReleaseDefinitionEnvironment & Record<string, unknown>;

  out.id = 0;
  delete out.badgeUrl;
  delete out.currentRelease;
  delete out.deployStep;
  out.environmentTriggers = [];

  if (out.preDeployApprovals?.approvals) {
    out.preDeployApprovals = {
      ...out.preDeployApprovals,
      approvals: out.preDeployApprovals.approvals.map(approval => ({ ...approval, id: 0 })),
    };
  }
  if (out.postDeployApprovals?.approvals) {
    out.postDeployApprovals = {
      ...out.postDeployApprovals,
      approvals: out.postDeployApprovals.approvals.map(approval => ({ ...approval, id: 0 })),
    };
  }
  if (out.preDeploymentGates) {
    out.preDeploymentGates = { ...out.preDeploymentGates, id: 0 };
  }
  if (out.postDeploymentGates) {
    out.postDeploymentGates = { ...out.postDeploymentGates, id: 0 };
  }

  return out;
}
