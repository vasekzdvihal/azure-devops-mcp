import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { registerAllTools } from '../../../src/mcp/registerTools.js';
import { FakeAdoClient } from '../../fakes/FakeAdoClient.js';

const FULL_TOOL_COUNT = 56;
const READ_ONLY_TOOL_COUNT = 23;

const FULL_ONLY_NAMES = [
  'create_pipeline',
  'delete_pipeline',
  'create_release_definition',
  'delete_release_definition',
  'delete_pull_request_comment',
  'delete_work_item_comment',
];

// Stub server: records every registerTool(name, config, handler) call. registerAllTools only
// calls this one method on the server (see src/mcp/registerTools.ts), so this is the whole shape
// it needs — mirrored from how test/unit/mcp/errorBoundary.test.ts exercises the handler wrapper
// without needing a real McpServer.
function makeStubServer() {
  const names: string[] = [];
  const stub = {
    registerTool: (name: string, _config: unknown, _handler: unknown) => {
      names.push(name);
    },
  };
  return { stub, names };
}

describe('registerAllTools', () => {
  it('full mode registers every read + write tool exactly once', () => {
    const { stub, names } = makeStubServer();
    // registerAllTools' server parameter is typed as the MCP SDK's McpServer class; a plain
    // stub does not structurally satisfy it (McpServer has private fields), so it's cast here.
    registerAllTools(stub as unknown as McpServer, new FakeAdoClient(), { readOnly: false });

    for (const name of FULL_ONLY_NAMES) {
      expect(names).toContain(name);
    }
    expect(names).toHaveLength(FULL_TOOL_COUNT);
    expect(new Set(names).size).toBe(names.length);
  });

  it('read-only mode registers only read tools, all of which also appear in full mode', () => {
    const { stub, names } = makeStubServer();
    registerAllTools(stub as unknown as McpServer, new FakeAdoClient(), { readOnly: true });

    for (const name of FULL_ONLY_NAMES) {
      expect(names).not.toContain(name);
    }
    expect(names).toHaveLength(READ_ONLY_TOOL_COUNT);

    const { stub: fullStub, names: fullNames } = makeStubServer();
    registerAllTools(fullStub as unknown as McpServer, new FakeAdoClient(), { readOnly: false });
    for (const name of names) {
      expect(fullNames).toContain(name);
    }
  });
});
