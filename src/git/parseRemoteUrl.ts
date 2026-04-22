export interface ParsedRemote {
  project: string;
  repo: string;
}

/**
 * Parses an Azure DevOps git remote URL into project and repo names.
 * Returns null if the URL doesn't match any known ADO format.
 *
 * Supports HTTPS and SSH variants for both ADO Services (cloud) and
 * ADO Server (on-prem with or without /tfs/ collection prefix).
 */
// Hosts known to NOT be Azure DevOps. The on-prem regex matches purely
// structurally on `/_git/`, so without this guard a contrived non-ADO URL
// containing `/_git/` could be misclassified as ADO Server.
const NON_ADO_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "gitlab.com",
  "www.gitlab.com",
  "bitbucket.org",
  "www.bitbucket.org",
  "codeberg.org",
  "git.sr.ht",
]);

export function parseRemoteUrl(url: string): ParsedRemote | null {
  if (!url) return null;

  // Normalize: strip trailing .git, then trailing slashes (some tooling and
  // copy-pastes from a browser address bar add them; git itself doesn't).
  const normalized = url.replace(/\.git$/, "").replace(/\/+$/, "");

  if (isKnownNonAdoHost(normalized)) return null;

  return (
    parseAdoServicesHttps(normalized) ||
    parseLegacyVisualStudioHttps(normalized) ||
    parseAdoSshDevAzure(normalized) ||
    parseLegacyVsSsh(normalized) ||
    parseAdoServerHttpsOrSsh(normalized)
  );
}

function isKnownNonAdoHost(url: string): boolean {
  // Pull host out of either http(s)://host/... or user@host:... or ssh://host/...
  const m =
    url.match(/^(?:https?|ssh):\/\/([^/]+)/i) ||
    url.match(/^[^@]+@([^:]+):/);
  if (!m) return false;
  const host = m[1]!.toLowerCase().replace(/:\d+$/, "");
  return NON_ADO_HOSTS.has(host);
}

// https://dev.azure.com/{org}/{project}/_git/{repo}
function parseAdoServicesHttps(url: string): ParsedRemote | null {
  const m = url.match(/^https?:\/\/dev\.azure\.com\/[^/]+\/([^/]+)\/_git\/([^/]+)$/);
  return m ? { project: decode(m[1]!), repo: decode(m[2]!) } : null;
}

// https://{org}.visualstudio.com/{project}/_git/{repo}
function parseLegacyVisualStudioHttps(url: string): ParsedRemote | null {
  const m = url.match(/^https?:\/\/[^/]+\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)$/);
  return m ? { project: decode(m[1]!), repo: decode(m[2]!) } : null;
}

// git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
function parseAdoSshDevAzure(url: string): ParsedRemote | null {
  const m = url.match(/^git@ssh\.dev\.azure\.com:v3\/[^/]+\/([^/]+)\/([^/]+)$/);
  return m ? { project: decode(m[1]!), repo: decode(m[2]!) } : null;
}

// {org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}
function parseLegacyVsSsh(url: string): ParsedRemote | null {
  const m = url.match(/^[^@]+@vs-ssh\.visualstudio\.com:v3\/[^/]+\/([^/]+)\/([^/]+)$/);
  return m ? { project: decode(m[1]!), repo: decode(m[2]!) } : null;
}

// On-prem ADO Server: https or ssh, with or without /tfs/ collection prefix.
// The pattern is: <scheme>{host}[:port][/tfs]/{collection}/{project}/_git/{repo}
// The `_git/` literal is a strong ADO-only marker used to anchor the match.
function parseAdoServerHttpsOrSsh(url: string): ParsedRemote | null {
  const m = url.match(/(?:https?:\/\/|ssh:\/\/)[^/]+\/[^/]+(?:\/[^/]+)*?\/([^/]+)\/_git\/([^/]+)$/);
  return m ? { project: decode(m[1]!), repo: decode(m[2]!) } : null;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
