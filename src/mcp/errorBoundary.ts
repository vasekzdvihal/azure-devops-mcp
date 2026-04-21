export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

export function toToolResult(handler: Handler): (args: Record<string, unknown>) => Promise<McpToolResult> {
  return async (args) => {
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
