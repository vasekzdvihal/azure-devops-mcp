import type { z } from 'zod';
import type { IdentityService } from './service.js';

export interface ToolDefinition {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodRawShape;
  };
  // The handler returns a JSON-serializable payload; the MCP layer wraps it.
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export function buildIdentityTools(svc: IdentityService): ToolDefinition[] {
  return [
    {
      name: 'whoami',
      config: {
        title: 'Who am I?',
        description:
          'Returns the Azure DevOps identity associated with the configured PAT. '
          + 'Use this to verify the connection or to learn the current user\'s id and display name.',
        inputSchema: {}, // no inputs
      },
      handler: async () => svc.whoami(),
    },
  ];
}
