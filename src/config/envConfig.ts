import type { Config } from './schema.js';
import process from 'node:process';
import { ConfigSchema } from './schema.js';

export const ENV_BASE_URL = 'AZURE_DEVOPS_BASE_URL';
export const ENV_KIND = 'AZURE_DEVOPS_KIND';
export const ENV_PAT = 'AZURE_DEVOPS_PAT';
export const ENV_CA_BUNDLE = 'AZURE_DEVOPS_CA_BUNDLE';

const REQUIRED_VARS = [ENV_BASE_URL, ENV_KIND, ENV_PAT] as const;

export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvConfigError';
  }
}

export interface ResolvedEnvConfig {
  config: Config;
  pat: string;
}

/**
 * Env vars are a complete, exclusive config source: when any AZURE_DEVOPS_*
 * config var is set, all required ones must be — we never merge with the
 * config file or keyring, so a stray file can't redirect an env PAT to a
 * different host. Empty strings count as unset (docker-compose passes
 * `VAR: ${UNSET_HOST_VAR}` through as an empty string).
 *
 * Returns null when no config vars are set — callers fall back to the
 * setup-wizard config file + OS keyring.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ResolvedEnvConfig | null {
  const read = (name: string): string | undefined => {
    const value = env[name];
    return value === undefined || value === '' ? undefined : value;
  };

  const caBundlePath = read(ENV_CA_BUNDLE);
  if (REQUIRED_VARS.every(name => read(name) === undefined) && caBundlePath === undefined) {
    return null;
  }

  const missing = REQUIRED_VARS.filter(name => read(name) === undefined);
  if (missing.length > 0) {
    throw new EnvConfigError(
      `Incomplete AZURE_DEVOPS_* env config — missing: ${missing.join(', ')}. `
      + `Set ${ENV_BASE_URL}, ${ENV_KIND} (server|services) and ${ENV_PAT} together, or unset them all to use the setup-wizard config.`,
    );
  }

  const parsed = ConfigSchema.safeParse({
    baseUrl: read(ENV_BASE_URL),
    kind: read(ENV_KIND),
    caBundlePath,
  });
  if (!parsed.success) {
    const varNameFor: Record<string, string> = {
      baseUrl: ENV_BASE_URL,
      kind: ENV_KIND,
      caBundlePath: ENV_CA_BUNDLE,
    };
    const details = parsed.error.issues
      .map(issue => `${varNameFor[String(issue.path[0])] ?? String(issue.path[0])}: ${issue.message}`)
      .join('; ');
    throw new EnvConfigError(`Invalid AZURE_DEVOPS_* env config — ${details}`);
  }

  // read() returned a value for every required var above, so the PAT is set.
  return { config: parsed.data, pat: read(ENV_PAT) as string };
}
