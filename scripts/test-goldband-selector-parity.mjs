#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const claudeCommandPath = path.join(repoDir, 'commands', 'goldband.md');
const codexPromptPath = path.join(repoDir, 'codex', 'prompts', 'goldband.md');

const claudeCommand = fs.readFileSync(claudeCommandPath, 'utf8');
const codexPrompt = fs.readFileSync(codexPromptPath, 'utf8');

assert.match(claudeCommand, /Prefer `~\/\.claude\/skills\/goldband`/);
assert.match(codexPrompt, /Prefer `~\/\.codex\/skills\/goldband`/);
assert.match(claudeCommand, /\/goldband review/);
assert.match(codexPrompt, /\/prompts:goldband review/);

function sharedSelectorContract(markdown) {
  const start = markdown.indexOf('2. Read available workflows from:');
  assert.notEqual(start, -1, 'selector must include shared workflow discovery');
  return markdown
    .slice(start)
    .replace(/\bcommand\b/g, 'selector')
    .replace(/\bprompt\b/g, 'selector');
}

assert.equal(
  sharedSelectorContract(claudeCommand),
  sharedSelectorContract(codexPrompt),
  'Claude /goldband and Codex /prompts:goldband selector contracts drifted',
);

console.log('[OK] Goldband selector parity verified');
