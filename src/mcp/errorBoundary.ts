// Structural shape of the SDK's CallToolResult: content array + optional isError
// plus arbitrary metadata (_meta, etc.). The index signature lets TS accept this
// value wherever the SDK expects CallToolResult, without importing the SDK type here.
export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [x: string]: unknown;
}

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

// Accept an optional `extra` arg so the returned function matches the SDK's
// ToolCallback signature `(args, extra) => CallToolResult`. We don't use extra.
export function toToolResult(
  handler: Handler,
): (args: Record<string, unknown>, extra?: unknown) => Promise<McpToolResult> {
  return async (args, _extra) => {
    try {
      const value = await handler(args);
      return {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Stack trace goes to stderr for debugging; user-facing message stays clean.
      if (err instanceof Error && err.stack) {
        process.stderr.write(`[azure-devops-mcp] tool error: ${err.stack}\n`);
      } else {
        process.stderr.write(`[azure-devops-mcp] tool error: ${message}\n`);
      }
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  };
}
