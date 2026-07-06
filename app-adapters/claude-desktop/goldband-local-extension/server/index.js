#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoDir = process.env.GOLDBAND_REPO_DIR;
if (!repoDir) {
  console.error('Claude Desktop extension: GOLDBAND_REPO_DIR is required.');
  process.exit(1);
}

const serverPath = path.resolve(repoDir, 'mcp/server/dist/index.js');
if (!fs.existsSync(serverPath)) {
  const serverError = [
    'Claude Desktop extension: expected built goldband MCP server at ',
    serverPath,
  ].join('');
  console.error(serverError);
  console.error(
    'Run npm --prefix mcp/server run build in the goldband checkout.',
  );
  process.exit(1);
}

const child = spawn(process.execPath, [serverPath], {
  cwd: repoDir,
  env: process.env,
  stdio: ['inherit', 'inherit', 'inherit'],
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
