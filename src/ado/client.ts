import type { Identity } from "./types.js";

/**
 * The AdoClient is the seam between our domain services and Azure DevOps.
 * Phase 0 exposes only whoami(). Phase 1 will extend this interface with
 * project/repo/PR methods.
 */
export interface AdoClient {
  /** Returns the identity the configured PAT belongs to. */
  whoami(): Promise<Identity>;
}
