import { Entry } from "@napi-rs/keyring";

const SERVICE_NAME = "azure-devops-mcp";

export class PatNotFoundError extends Error {
  constructor(account: string) {
    super(`No PAT found in OS keyring for account "${account}". Run: npx -y @vasekzdvihal/azure-devops-mcp setup`);
    this.name = "PatNotFoundError";
  }
}

function entryFor(account: string): Entry {
  return new Entry(SERVICE_NAME, account);
}

export function setPat(account: string, pat: string): void {
  entryFor(account).setPassword(pat);
}

export function getPat(account: string): string {
  const password = entryFor(account).getPassword();
  if (password === null) throw new PatNotFoundError(account);
  return password;
}

export function deletePat(account: string): void {
  // Returns false when the entry didn't exist; we don't care.
  entryFor(account).deletePassword();
}

/**
 * The keyring "account" we use is the host of the configured baseUrl.
 * That way two ADO instances (e.g. on-prem + cloud) coexist without colliding.
 */
export function accountFromBaseUrl(baseUrl: string): string {
  return new URL(baseUrl).host;
}
