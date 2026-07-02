#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_DIR = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(REPO_DIR, 'mcp', 'token-backed-servers.json');

function parseArgs(argv) {
  const options = {
    envFile: path.join(REPO_DIR, 'codex', 'local', 'mcp.env'),
    summary: false,
    printSmoke: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--summary') {
      options.summary = true;
    } else if (token === '--print-smoke') {
      options.printSmoke = true;
    } else if (token === '--mcp-env-file') {
      options.envFile = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }

  return options;
}

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  const result = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const entry = parseEnvLine(rawLine);
    if (entry) result[entry.key] = entry.value;
  }
  return result;
}

function parseEnvLine(rawLine) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) return null;
  const equalsIndex = line.indexOf('=');
  if (equalsIndex <= 0) return null;
  return {
    key: line.slice(0, equalsIndex).trim(),
    value: unquoteEnvValue(line.slice(equalsIndex + 1).trim()),
  };
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function hasUsableValue(value) {
  if (!value) {
    return false;
  }
  const normalized = String(value).trim();
  return (
    normalized.length > 0 &&
    !normalized.includes('${') &&
    normalized !== 'changeme'
  );
}

function envValue(name, localEnv) {
  return hasUsableValue(process.env[name])
    ? process.env[name]
    : (localEnv[name] ?? '');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const localEnv = parseEnvFile(options.envFile);

  const rows = registry.servers.map((server) => {
    const missing = server.requiredEnv.filter(
      (name) => !hasUsableValue(envValue(name, localEnv)),
    );
    return {
      name: server.name,
      requiredEnv: server.requiredEnv,
      missing,
      configured: missing.length === 0,
      inspectorCommand: server.inspectorCommand,
    };
  });

  if (options.summary) {
    const configured = rows.filter((row) => row.configured).length;
    const total = rows.length;
    const label =
      configured === total
        ? '[OK]'
        : configured > 0
          ? '[部分設定]'
          : '[未設定]';
    console.log(`  ${label} token-backed MCP env (${configured}/${total})`);
    return;
  }

  for (const row of rows) {
    const status = row.configured
      ? 'configured'
      : `missing ${row.missing.join(', ')}`;
    console.log(`${row.name}: ${status}`);
    if (options.printSmoke) {
      console.log(`  smoke: ${row.inspectorCommand}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
