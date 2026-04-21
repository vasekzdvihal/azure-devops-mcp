// Re-exports of azure-devops-node-api types we expose at the AdoClient seam.
// Keeping a single import surface here means downstream files don't import from
// "azure-devops-node-api/interfaces/...".
export type { Identity } from "azure-devops-node-api/interfaces/IdentitiesInterfaces.js";
export type { ConnectionData } from "azure-devops-node-api/interfaces/LocationsInterfaces.js";
