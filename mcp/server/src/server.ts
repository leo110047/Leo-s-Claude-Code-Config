import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { runHealthCheck } from './health-check.js';
import { runPolicyCheck } from './policy-check.js';
import { runTelemetryQuery } from './telemetry-query.js';

export function createGoldbandMcpServer() {
  const server = new McpServer({
    name: 'goldband-mcp',
    version: '0.1.0',
  });
  registerPolicyTool(server);
  registerTelemetryTool(server);
  registerHealthTool(server);
  return server;
}

function registerPolicyTool(server: McpServer) {
  server.registerTool(
    'goldband_policy_check',
    {
      title: 'Goldband policy check',
      description:
        'Dry-runs Claude PreToolUse policy for a command or file edit without executing it.',
      inputSchema: {
        command: z.string().default(''),
        toolName: z.enum(['Bash', 'Write', 'Edit']).default('Bash'),
        host: z.enum(['claude']).default('claude'),
        filePath: z.string().optional(),
        content: z.string().optional(),
        sessionId: z.string().optional(),
      },
    },
    async (input) => runPolicyCheck(input),
  );
}

function registerTelemetryTool(server: McpServer) {
  server.registerTool(
    'goldband_telemetry_query',
    {
      title: 'Goldband telemetry query',
      description:
        'Reads hook-router usage telemetry and returns count aggregations.',
      inputSchema: {
        days: z.number().int().positive().max(365).default(30),
        eventType: z
          .enum(['all', 'hook-decision', 'workflow-entry', 'prompt-trigger'])
          .default('all'),
        groupBy: z.enum(['rule', 'skill']).default('rule'),
        limit: z.number().int().positive().max(100).default(20),
      },
    },
    async (input) => runTelemetryQuery(input),
  );
}

function registerHealthTool(server: McpServer) {
  server.registerTool(
    'goldband_health_check',
    {
      title: 'Goldband health check',
      description:
        'Runs a fixed read-only allowlist of goldband repo validation checks.',
      inputSchema: {},
    },
    async () => runHealthCheck(),
  );
}
