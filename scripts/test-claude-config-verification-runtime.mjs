#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  checkWorkflowInstall,
} = require('../skills/global/claude-config-verification/scripts/verify-claude-config-runtime.js');
const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'goldband-config-runtime-'),
);

process.on('exit', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sourceDir = path.join(tmpDir, 'source');
const actions = [
  {
    capability: 'review',
    action: 'code',
    hostSupport: ['claude', 'codex'],
  },
  {
    capability: 'qa',
    action: 'app',
    hostSupport: ['claude'],
  },
];
fs.mkdirSync(path.join(sourceDir, 'generated'), { recursive: true });
fs.writeFileSync(
  path.join(sourceDir, 'generated', 'capability-actions.json'),
  `${JSON.stringify({ schemaVersion: 1, actions })}\n`,
);

for (const host of ['claude', 'codex']) {
  const runtimeDir = path.join(tmpDir, `.${host}`, 'skills', 'goldband');
  fs.mkdirSync(path.join(runtimeDir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(runtimeDir, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(runtimeDir, 'review'), { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, '.installed-source'),
    `${sourceDir}\n`,
  );
  fs.writeFileSync(path.join(runtimeDir, 'SKILL.md'), 'fixture\n');
  fs.writeFileSync(path.join(runtimeDir, 'lib', 'knowledge.ts'), 'fixture\n');
  fs.writeFileSync(
    path.join(runtimeDir, 'review', 'checklist.md'),
    'fixture\n',
  );

  for (const action of actions.filter((item) =>
    item.hostSupport.includes(host),
  )) {
    const workflow = path.join(
      runtimeDir,
      'workflows',
      action.capability,
      `${action.action}.workflow.md`,
    );
    fs.mkdirSync(path.dirname(workflow), { recursive: true });
    fs.writeFileSync(workflow, 'fixture\n');
  }
}
fs.writeFileSync(
  path.join(
    tmpDir,
    '.claude',
    'skills',
    'goldband',
    'bin',
    'goldband-repo-mode',
  ),
  'fixture\n',
);
fs.writeFileSync(
  path.join(
    tmpDir,
    '.claude',
    'skills',
    'goldband',
    'bin',
    'goldband-knowledge',
  ),
  'fixture\n',
);
fs.writeFileSync(
  path.join(tmpDir, '.codex', 'skills', 'goldband', 'bin', 'goldband-config'),
  'fixture\n',
);
const healthy = checkWorkflowInstall(tmpDir, tmpDir);
assert.equal(
  healthy.claudeChecks.every((check) => check.ok),
  true,
);
assert.equal(
  healthy.codexChecks.every((check) => check.ok),
  true,
);

fs.rmSync(
  path.join(
    tmpDir,
    '.claude',
    'skills',
    'goldband',
    'workflows',
    'qa',
    'app.workflow.md',
  ),
);
const stale = checkWorkflowInstall(tmpDir, tmpDir);
assert.equal(
  stale.claudeChecks.find(
    (check) => check.file === path.join('workflows', 'qa', 'app.workflow.md'),
  )?.ok,
  false,
);

const restoredQaWorkflow = path.join(
  tmpDir,
  '.claude',
  'skills',
  'goldband',
  'workflows',
  'qa',
  'app.workflow.md',
);
fs.mkdirSync(path.dirname(restoredQaWorkflow), { recursive: true });
fs.writeFileSync(restoredQaWorkflow, 'fixture\n');

for (const host of ['claude', 'codex']) {
  fs.rmSync(
    path.join(tmpDir, `.${host}`, 'skills', 'goldband', '.installed-source'),
  );
}
const directSetup = checkWorkflowInstall(tmpDir, sourceDir);
assert.equal(
  directSetup.claudeChecks.some((check) => check.file === '.installed-source'),
  false,
);
assert.equal(
  directSetup.claudeChecks.every((check) => check.ok),
  true,
);
assert.equal(
  directSetup.codexChecks.every((check) => check.ok),
  true,
);

fs.mkdirSync(path.join(tmpDir, '.codex', 'skills', 'goldband-generated'));
const legacyCodex = checkWorkflowInstall(tmpDir, tmpDir);
assert.equal(
  legacyCodex.codexChecks.find((check) =>
    check.file.startsWith('legacy top-level'),
  )?.ok,
  false,
);

console.log('[OK] config verifier follows the installed workflow contract');
