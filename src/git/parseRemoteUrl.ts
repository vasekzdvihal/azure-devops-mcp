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
export function parseRemoteUrl(url: string): ParsedRemote | null {
  if (!url) return null;

  // Normalize: strip trailing .git
  const normalized = url.replace(/\.git$/, "");

  return (
    parseAdoServicesHttps(normalized) ||
    parseLegacyVisualStudioHttps(normalized) ||
    parseAdoSshDevAzure(normalized) ||
    parseLegacyVsSsh(normalized) ||
    parseAdoServerHttpsOrSsh(normalized)
  );
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
