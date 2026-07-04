#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGoldbandMcpServer } from './server.js';

async function main() {
  const server = createGoldbandMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack : String(error);
  console.error(message);
  process.exit(1);
});
