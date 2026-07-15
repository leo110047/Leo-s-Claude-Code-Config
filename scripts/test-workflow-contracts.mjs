#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWorkflowContracts,
  validatePromptArchitecture,
  validateSharedPromptContent,
  validateWorkflowContractContent,
} from './lib/workflow-contracts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'goldband.manifest.json'), 'utf8'),
);

const verifyConfig = fs.readFileSync(
  path.join(root, 'commands', 'verify-config.md'),
  'utf8',
);
const pluginVerifyConfig = fs.readFileSync(
  path.join(
    root,
    'plugin-assets',
    'claude-code-plugin',
    'commands',
    'verify-config.md',
  ),
  'utf8',
);
assert.equal(
  pluginVerifyConfig,
  verifyConfig,
  'plugin verify-config command is not synchronized with its source',
);
assert.doesNotMatch(
  verifyConfig,
  /(?:investigate|review|qa|careful|freeze)\/SKILL\.md/,
  'verify-config still requires retired per-workflow SKILL.md files',
);
for (const installedContract of [
  'workflows/investigate/code.workflow.md',
  'workflows/review/code.workflow.md',
  'workflows/qa/app.workflow.md',
]) {
  assert.match(
    verifyConfig,
    new RegExp(installedContract.replaceAll('.', '\\.')),
  );
}

validatePromptArchitecture(manifest);

const retiredArchitecturePaths = [
  'goldband-loop/scripts/gen-skill-docs.ts',
  'goldband-loop/scripts/resolvers',
  'goldband-loop/model-overlays',
  'goldband-loop/scripts/skill-check.ts',
  'goldband-loop/scripts/discover-skills.ts',
];
assert.deepEqual(
  retiredArchitecturePaths.filter((relativePath) =>
    fs.existsSync(path.join(root, relativePath)),
  ),
  [],
  'retired workflow prompt architecture was reintroduced',
);

for (const capability of manifest.capabilities) {
  for (const action of capability.actions) {
    assert.equal(
      Object.hasOwn(action, 'source'),
      false,
      `${capability.id}/${action.id} still declares legacy source`,
    );
  }
}

const legacyPromptFiles = fs
  .readdirSync(path.join(root, 'goldband-loop'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .flatMap((entry) =>
    ['SKILL.md', 'SKILL.md.tmpl']
      .map((name) => path.join('goldband-loop', entry.name, name))
      .filter((relativePath) => fs.existsSync(path.join(root, relativePath))),
  );
assert.deepEqual(
  legacyPromptFiles,
  [],
  `legacy per-workflow prompt files remain:\n${legacyPromptFiles.join('\n')}`,
);

for (const hostRoot of ['.agents', '.factory', '.opencode']) {
  const skillsRoot = path.join(root, 'goldband-loop', hostRoot, 'skills');
  if (!fs.existsSync(skillsRoot)) continue;
  const legacyGeneratedSkills = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith('goldband-'),
    )
    .map((entry) => path.join('goldband-loop', hostRoot, 'skills', entry.name));
  assert.deepEqual(
    legacyGeneratedSkills,
    [],
    `legacy generated host skills remain:\n${legacyGeneratedSkills.join('\n')}`,
  );
}

const missingContract = structuredClone(manifest);
delete missingContract.capabilities[0].promptContract;
assert.throws(
  () => validatePromptArchitecture(missingContract),
  /promptContract is required/,
);

const contracts = buildWorkflowContracts(manifest);
const actionCount = manifest.capabilities.reduce(
  (count, capability) => count + capability.actions.length,
  0,
);

assert.equal(contracts.size, actionCount);

const generatedContractRoot = path.join(
  root,
  'goldband-loop',
  'generated',
  'workflow-contracts',
);
const actualContractPaths = [];
for (const capability of fs.readdirSync(generatedContractRoot, {
  withFileTypes: true,
})) {
  if (!capability.isDirectory()) continue;
  for (const entry of fs.readdirSync(
    path.join(generatedContractRoot, capability.name),
    { withFileTypes: true },
  )) {
    if (entry.isFile()) {
      actualContractPaths.push(
        path.posix.join(
          'goldband-loop/generated/workflow-contracts',
          capability.name,
          entry.name,
        ),
      );
    }
  }
}
assert.deepEqual(
  actualContractPaths.sort(),
  [...contracts.keys()].sort(),
  'generated workflow contract inventory is stale',
);

let totalBytes = 0;
for (const [relativePath, content] of contracts) {
  assert.match(
    relativePath,
    /^goldband-loop\/generated\/workflow-contracts\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\.workflow\.md$/,
  );
  validateWorkflowContractContent(content, manifest.promptArchitecture, {
    relativePath,
  });
  const bytes = Buffer.byteLength(content);
  assert.ok(bytes <= 2_048, `${relativePath} exceeds 2 KiB: ${bytes}`);
  totalBytes += bytes;
}

assert.ok(
  totalBytes <= 64 * 1_024,
  `workflow contracts exceed 64 KiB: ${totalBytes}`,
);

const review = contracts.get(
  'goldband-loop/generated/workflow-contracts/review/code.workflow.md',
);
assert.ok(review);
assert.match(review, /review\/shared-rubric\.md/);
assert.match(review, /Review only/);

const release = contracts.get(
  'goldband-loop/generated/workflow-contracts/release/land.workflow.md',
);
assert.ok(release);
assert.match(release, /explicit approval/i);

const reportOnly = contracts.get(
  'goldband-loop/generated/workflow-contracts/qa/report-only.workflow.md',
);
assert.ok(reportOnly);
assert.match(reportOnly, /Do not modify/i);
assert.throws(
  () =>
    validateWorkflowContractContent(
      `${review}\n## Preamble (run first)\n`,
      manifest.promptArchitecture,
      { relativePath: 'fixture' },
    ),
  /universal-preamble/,
);

for (const manual of manifest.manuals) {
  const content = fs.readFileSync(
    path.join(root, 'goldband-loop', manual.source),
    'utf8',
  );
  validateSharedPromptContent(content, manifest.promptArchitecture, {
    relativePath: manual.source,
  });
  assert.ok(
    Buffer.byteLength(content) <= 4_096,
    `${manual.source} exceeds 4 KiB`,
  );
}

for (const relativeDirectory of ['goldband-loop', 'goldband-loop/docs']) {
  const directory = path.join(root, relativeDirectory);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = path.join(directory, entry.name);
    const content = fs.readFileSync(filePath, 'utf8');
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+\/SKILL\.md)\)/g)) {
      assert.ok(
        fs.existsSync(path.resolve(path.dirname(filePath), match[1])),
        `${path.relative(root, filePath)} links to missing ${match[1]}`,
      );
    }
  }
}

console.log(
  `[OK] ${contracts.size} thin workflow contracts validated (${totalBytes} bytes)`,
);
