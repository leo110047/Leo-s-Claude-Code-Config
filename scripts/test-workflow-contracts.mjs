#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPromptSurfaceBudget,
  assertPromptSurfaceTotal,
  PROMPT_SURFACE_BUDGETS,
} from './lib/prompt-surface-budget.mjs';
import { listLegacyHostSkillArtifacts } from './lib/repo-test-environment.mjs';
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

assert.throws(
  () =>
    assertPromptSurfaceBudget(
      'oversized contract fixture',
      'x'.repeat(PROMPT_SURFACE_BUDGETS.workflowContractBytes + 1),
      PROMPT_SURFACE_BUDGETS.workflowContractBytes,
    ),
  /exceeds prompt surface budget/,
);
assert.throws(
  () =>
    assertPromptSurfaceTotal(
      'oversized runtime fixture',
      [
        {
          label: 'oversized runtime fixture',
          bytes: PROMPT_SURFACE_BUDGETS.installedRuntimeMarkdownTotalBytes + 1,
        },
      ],
      PROMPT_SURFACE_BUDGETS.installedRuntimeMarkdownTotalBytes,
    ),
  /exceeds prompt surface budget/,
);

const retiredArchitecturePaths = [
  'goldband-loop/scripts/gen-skill-docs.ts',
  'goldband-loop/scripts/skill-budget.ts',
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

const legacyGeneratedSkills = listLegacyHostSkillArtifacts(root);
assert.deepEqual(
  legacyGeneratedSkills,
  [],
  `legacy generated host skills remain:\n${legacyGeneratedSkills.join('\n')}`,
);

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
const retiredQuestionFormatPattern =
  /decision brief|ELI10|completeness score|each option|40 words|ONE AT A TIME|Do NOT batch|Never batch/i;
for (const [relativePath, content] of contracts) {
  assert.match(
    relativePath,
    /^goldband-loop\/generated\/workflow-contracts\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\.workflow\.md$/,
  );
  validateWorkflowContractContent(content, manifest.promptArchitecture, {
    relativePath,
  });
  assert.doesNotMatch(
    content,
    /manuals\/[a-z][a-z0-9-]*\.md/,
    `${relativePath} should not duplicate manifest-owned manual routing`,
  );
  assert.doesNotMatch(
    content,
    retiredQuestionFormatPattern,
    `${relativePath} reintroduced retired question-format boilerplate`,
  );
  const bytes = assertPromptSurfaceBudget(
    relativePath,
    content,
    PROMPT_SURFACE_BUDGETS.workflowContractBytes,
  );
  totalBytes += bytes;
}

assertPromptSurfaceTotal(
  'workflow contracts',
  [{ label: 'workflow contracts', bytes: totalBytes }],
  PROMPT_SURFACE_BUDGETS.workflowContractsTotalBytes,
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

assert.equal(
  manifest.promptArchitecture.interactionPolicy.askOnlyWhen,
  'Ask only when the answer can materially change the result and cannot be safely inferred from current evidence or user-stated preferences.',
);
assert.match(
  manifest.promptArchitecture.interactionPolicy.batching,
  /Batch related decisions/,
);
assert.match(
  manifest.promptArchitecture.interactionPolicy.formatOwner,
  /Tool schemas and UI/,
);

const rootSkill = fs.readFileSync(
  path.join(root, 'goldband-loop', 'SKILL.md'),
  'utf8',
);
assertPromptSurfaceBudget(
  'goldband-loop/SKILL.md',
  rootSkill,
  PROMPT_SURFACE_BUDGETS.rootRouterSkillBytes,
);
assert.match(rootSkill, /## Human decisions/);
assert.match(
  rootSkill,
  /Ask only when the answer can materially change the result/,
);
assert.match(rootSkill, /Batch related decisions/);
assert.match(rootSkill, /Tool schemas and UI own question shape/);
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
  assertPromptSurfaceBudget(
    manual.source,
    content,
    PROMPT_SURFACE_BUDGETS.manualBytes,
  );
}

const runtimePromptEntries = [
  promptSurfaceEntry('goldband-loop/SKILL.md'),
  promptSurfaceEntry('goldband-loop/ETHOS.md'),
  ...markdownEntries('goldband-loop/manuals', { recursive: false }),
  ...markdownEntries('goldband-loop/review', { recursive: false }),
  ...markdownEntries('goldband-loop/cross-review', { recursive: false }),
  ...markdownEntries('goldband-loop/generated/workflow-contracts', {
    recursive: true,
  }),
];

for (const entry of runtimePromptEntries) {
  if (entry.label.includes('/generated/workflow-contracts/')) continue;
  if (entry.label === 'goldband-loop/SKILL.md') continue;
  const budget = entry.label.includes('/manuals/')
    ? PROMPT_SURFACE_BUDGETS.manualBytes
    : PROMPT_SURFACE_BUDGETS.runtimeReferenceBytes;
  assertPromptSurfaceBudget(entry.label, entry.content, budget);
}

assertPromptSurfaceTotal(
  'installed Goldband runtime markdown prompt surface',
  runtimePromptEntries,
  PROMPT_SURFACE_BUDGETS.installedRuntimeMarkdownTotalBytes,
);

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

function promptSurfaceEntry(relativePath) {
  const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return {
    label: relativePath,
    content,
    bytes: Buffer.byteLength(content, 'utf8'),
  };
}

function markdownEntries(relativeDirectory, { recursive }) {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        entries.push(...markdownEntries(relativePath, { recursive }));
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      entries.push(promptSurfaceEntry(relativePath));
    }
  }
  return entries;
}
