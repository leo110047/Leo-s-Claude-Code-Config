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
const packagedClaudeCommandPath = path.join(
  repoDir,
  'plugin-assets',
  'claude-code-plugin',
  'commands',
  'goldband.md',
);
const staleDocs = ['CLAUDE.md', 'README.md', 'README.en.md', 'AGENTS.md'];

const claudeCommand = fs.readFileSync(claudeCommandPath, 'utf8');
const codexPrompt = fs.readFileSync(codexPromptPath, 'utf8');
const manifest = JSON.parse(
  fs.readFileSync(path.join(repoDir, 'goldband.manifest.json'), 'utf8'),
);

assert.equal(manifest.capabilityInterface, '$goldband <capability> <action>');
assert.equal(
  frontmatterField(claudeCommand, 'argument-hint'),
  '<capability> <action>',
);
assert.equal(
  frontmatterField(codexPrompt, 'argument-hint'),
  '<capability> <action>',
);

assert.equal(
  fs.readFileSync(packagedClaudeCommandPath, 'utf8'),
  claudeCommand,
  'packaged Claude command drifted from the root command',
);

for (const relativePath of staleDocs) {
  const content = fs.readFileSync(path.join(repoDir, relativePath), 'utf8');
  assert.doesNotMatch(
    content,
    /\/prompts:goldband/,
    `${relativePath} still references removed Codex custom prompt invocation`,
  );
}

function frontmatterField(markdown, key) {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatter, 'adapter must have YAML frontmatter');
  const field = frontmatter[1]
    .split('\n')
    .find((line) => line.startsWith(`${key}:`));
  assert.ok(field, `adapter frontmatter is missing ${key}`);
  return field.slice(key.length + 1).trim();
}

console.log('[OK] Goldband selector parity verified');
