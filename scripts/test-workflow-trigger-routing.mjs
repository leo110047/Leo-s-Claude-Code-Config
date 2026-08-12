#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const testHome = fs.mkdtempSync(
  path.join(os.tmpdir(), 'goldband-trigger-routing-'),
);
const previousHome = process.env.HOME;

try {
  const skillRoot = path.join(testHome, '.claude', 'skills', 'goldband');
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '# test fixture\n');
  process.env.HOME = testHome;

  const { matchPrompt } = require(
    path.join(
      root,
      'hooks',
      'scripts',
      'lib',
      'skill-activation',
      'activation-rules.js',
    ),
  );
  const { evaluateInput } = require(
    path.join(root, 'codex', 'hooks', 'hook-router.js'),
  );

  const positiveCases = [
    ['Please review this diff.', ['review'], ['review']],
    [
      'Find the root cause of this failing test.',
      ['investigate'],
      ['investigate'],
    ],
    ['Run staging QA for the checkout flow.', ['qa'], ['qa']],
    ['Write an implementation plan for this migration.', ['plan'], ['plan']],
    ['Open browser and inspect the signed-in page.', ['browser'], ['browser']],
    ['Define the visual direction for this dashboard.', ['design'], ['design']],
    ['Enable read only mode for this work.', ['safety'], []],
    ['Restore context from the last session.', ['context'], ['context']],
    [
      'Recall knowledge about the installer contract.',
      ['knowledge'],
      ['knowledge'],
    ],
    ['Run a workflow benchmark for this change.', ['benchmark'], ['benchmark']],
    [
      'Generate document artifacts from these sources.',
      ['document'],
      ['document'],
    ],
    ['Check Goldband health.', ['system'], ['system']],
    ['Run iOS checks on the simulator.', ['ios'], ['ios']],
  ];
  const negativeCases = [
    'Explain the current implementation.',
    'Summarize the error field in this JSON schema.',
    'Explain how linear regression works.',
    'Design an E2E testing strategy.',
    'Tell me what this pull request changes.',
    'Merge pull request 42 after the checks pass.',
    'Discuss the project scope and strategy.',
    'Be careful when reading this file.',
    'Resume the explanation from the previous paragraph.',
    'What did the team learn from this discussion?',
    'Analyze the current performance characteristics.',
    'Read the documentation and answer my question.',
    'Check the system status of this application.',
    'Parse the cookie header locally.',
    'Explain the Browser API.',
    'Explain how Playwright fixtures work.',
    'Fix the JavaScript prototype chain.',
    'Compare the visual output with the expected screenshot.',
  ];

  for (const [prompt, claudeExpected, codexExpected] of positiveCases) {
    assert.deepEqual(
      claudeCapabilities(matchPrompt, prompt),
      claudeExpected,
      `Claude routing mismatch for "${prompt}"`,
    );
    assert.deepEqual(
      codexCapabilities(evaluateInput, prompt),
      codexExpected,
      `Codex routing mismatch for "${prompt}"`,
    );
  }

  for (const prompt of negativeCases) {
    assert.deepEqual(
      claudeCapabilities(matchPrompt, prompt),
      [],
      `Claude should not route generic discussion: "${prompt}"`,
    );
    assert.deepEqual(
      codexCapabilities(evaluateInput, prompt),
      [],
      `Codex should not route generic discussion: "${prompt}"`,
    );
  }

  console.log(
    `workflow trigger routing: ${positiveCases.length} positive and ${negativeCases.length} negative cases passed for Claude and Codex`,
  );
} finally {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  fs.rmSync(testHome, { recursive: true, force: true });
}

function claudeCapabilities(matchPrompt, prompt) {
  return matchPrompt(prompt)
    .map((match) => /^goldband:([^/]+)\//.exec(match.skill)?.[1] ?? null)
    .filter(Boolean)
    .sort();
}

function codexCapabilities(evaluateInput, prompt) {
  const output = evaluateInput({
    hook_event_name: 'UserPromptSubmit',
    prompt,
  });
  const context = output?.hookSpecificOutput?.additionalContext ?? '';
  return [
    ...context.matchAll(/\$goldband\s+([a-z][a-z0-9-]*)\s+[a-z][a-z0-9-]*/g),
  ]
    .map((match) => match[1])
    .sort();
}
