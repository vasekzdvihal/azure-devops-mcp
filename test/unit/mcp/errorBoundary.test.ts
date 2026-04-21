import { describe, it, expect } from "vitest";
import { toToolResult } from "../../../src/mcp/errorBoundary.js";
import { AdoAuthError } from "../../../src/ado/errors.js";

describe("toToolResult", () => {
  it("wraps a successful handler return as a JSON content block", async () => {
    const wrapped = toToolResult(async () => ({ ok: true, count: 3 }));
    const result = await wrapped({});
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true, count: 3 }, null, 2) }]);
  });

  it("converts thrown AdoError to an MCP error result with friendly message", async () => {
    const wrapped = toToolResult(async () => {
      throw new AdoAuthError("token expired");
    });
    const result = await wrapped({});
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toMatch(/Authentication failed/);
    expect(result.content[0].text).toMatch(/token expired/);
  });

  it("converts non-AdoError exceptions to a generic error result", async () => {
    const wrapped = toToolResult(async () => {
      throw new Error("oh no");
    });
    const result = await wrapped({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/oh no/);
  });

  it("handles thrown non-Error values", async () => {
    const wrapped = toToolResult(async () => {
      throw "string thrown";
    });
    const result = await wrapped({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/string thrown/);
  });
});
