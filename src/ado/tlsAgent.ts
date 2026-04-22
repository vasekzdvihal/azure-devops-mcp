import https from "node:https";
import fs from "node:fs";
import tls from "node:tls";

/**
 * Returns an https.Agent honoring an optional extra CA bundle, or undefined when
 * no extra CA is needed (lets the SDK use its default agent and Node's system trust store).
 */
export function buildHttpsAgent(caBundlePath?: string): https.Agent | undefined {
  if (!caBundlePath) return undefined;
  const extraCa = fs.readFileSync(caBundlePath);
  // Append to system roots so private CAs work alongside public ones.
  const roots = [...tls.rootCertificates, extraCa.toString("utf8")];
  return new https.Agent({ ca: roots });
}
