/**
 * Returns true when the operator has restricted the server to read-only tools
 * (`AZURE_DEVOPS_READ_ONLY=true` in the MCP server config's env block).
 *
 * Phase 1 ships only read tools, so this is currently a no-op signal. It exists
 * so that Phase 2 (write tools) can gate registration without changing the
 * registerAllTools signature.
 *
 * Truthy values: "true", "1", "yes", "on" (case-insensitive).
 */
export function isReadOnly(): boolean {
  const v = (process.env["AZURE_DEVOPS_READ_ONLY"] ?? "").toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}
