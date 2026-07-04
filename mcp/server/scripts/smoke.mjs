#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, '..');

async function main() {
  const foreignGitRepo = createForeignGitRepo();
  const client = new Client({ name: 'goldband-mcp-smoke', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(serverRoot, 'dist', 'index.js')],
    cwd: foreignGitRepo,
    stderr: 'pipe',
  });

  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      'goldband_health_check',
      'goldband_policy_check',
      'goldband_telemetry_query',
    ]);

    const result = await client.callTool({
      name: 'goldband_policy_check',
      arguments: { command: 'npm run dev' },
    });
    assert.equal(result.structuredContent?.outcome, 'block');
    assert.deepEqual(result.structuredContent?.matchedRules, [
      'dev-server-blocker',
    ]);
    console.log(JSON.stringify({ tools: names, policyCheck: result }, null, 2));
  } finally {
    await client.close();
  }
}

function createForeignGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-mcp-cwd-'));
  const result = spawnSync('git', ['init'], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return dir;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
