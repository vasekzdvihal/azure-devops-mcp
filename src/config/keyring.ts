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
  try {
    const password = entryFor(account).getPassword();
    if (password === null) {
      throw new PatNotFoundError(account);
    }
    return password;
  } catch (error) {
    // Keyring throws when no entry exists or returns null; we normalize to our typed error.
    if (error instanceof PatNotFoundError) {
      throw error;
    }
    throw new PatNotFoundError(account);
  }
}

export function deletePat(account: string): void {
  try {
    entryFor(account).deletePassword();
  } catch {
    // Idempotent: deleting a missing entry is fine.
  }
}

/**
 * The keyring "account" we use is the host of the configured baseUrl.
 * That way two ADO instances (e.g. on-prem + cloud) coexist without colliding.
 */
export function accountFromBaseUrl(baseUrl: string): string {
  return new URL(baseUrl).host;
}
