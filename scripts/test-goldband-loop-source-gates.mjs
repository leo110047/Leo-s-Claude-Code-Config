import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const loopRoot = path.join(root, 'goldband-loop');
const loopPackage = readJson(path.join(loopRoot, 'package.json'));

const expectedScripts = {
  'lint:source': 'biome lint',
  'lint:complexity': 'check-source-complexity.ts',
  typecheck: 'tsc --noEmit',
  'lint:exports': 'knip',
};

for (const [scriptName, command] of Object.entries(expectedScripts)) {
  assert.match(
    loopPackage.scripts?.[scriptName] ?? '',
    new RegExp(escapeRegExp(command)),
    `goldband-loop/package.json must define ${scriptName} with ${command}`,
  );
}

const aggregate = loopPackage.scripts?.['check:source'] ?? '';
for (const scriptName of Object.keys(expectedScripts)) {
  assert.match(
    aggregate,
    new RegExp(`bun run ${escapeRegExp(scriptName)}`),
    `check:source must run ${scriptName}`,
  );
}

const configFiles = ['biome.json', 'tsconfig.json', 'knip.json'];
for (const configFile of configFiles) {
  const configPath = path.join(loopRoot, configFile);
  assert.ok(fs.existsSync(configPath), `${configFile} must exist`);
  const config = readJson(configPath);
  assert.match(
    JSON.stringify(config),
    /generated/,
    `${configFile} must explicitly exclude generated output`,
  );
}

const biomeConfig = readJson(path.join(loopRoot, 'biome.json'));
assert.equal(
  biomeConfig.linter?.rules?.complexity?.noExcessiveLinesPerFunction?.options
    ?.maxLines,
  50,
  'Goldband Loop must retain the 50-line function contract',
);
assert.equal(
  biomeConfig.linter?.rules?.complexity?.noExcessiveCognitiveComplexity?.options
    ?.maxAllowedComplexity,
  12,
  'Goldband Loop must retain the cognitive-complexity contract',
);
assert.equal(
  biomeConfig.linter?.rules?.complexity?.useMaxParams?.options?.max,
  4,
  'Goldband Loop must retain the four-parameter contract',
);
assert.ok(
  fs.existsSync(
    path.join(loopRoot, 'config', 'source-complexity-baseline.json'),
  ),
  'Goldband Loop must commit its monotonic complexity baseline',
);

const complexityGate = fs.readFileSync(
  path.join(loopRoot, 'scripts', 'check-source-complexity.ts'),
  'utf8',
);
assert.match(
  complexityGate,
  /baselineTransitionFailures[\s\S]*?candidate baseline exceeds predecessor/,
  'complexity gate must compare the candidate baseline with its predecessor',
);
assert.match(
  complexityGate,
  /GITHUB_BASE_REF[\s\S]*?merge-base/,
  'complexity gate must resolve the GitHub merge-base authority',
);
assert.match(
  complexityGate,
  /git[\s\S]*?log[\s\S]*?BASELINE_REPOSITORY_PATH/,
  'local complexity checks must trace the last baseline-changing commit',
);

const workflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'validate.yml'),
  'utf8',
);
assert.match(
  workflow,
  /name: Check Goldband Loop source quality[\s\S]*?run: cd goldband-loop && bun run check:source/,
  'validate CI must run the Goldband Loop source gate after dependencies are installed',
);
assert.match(
  workflow,
  /config-contracts:[\s\S]*?actions\/checkout@v4[\s\S]*?fetch-depth: 0[\s\S]*?name: Check Goldband Loop source quality/,
  'source-quality CI must fetch predecessor history for the monotonic baseline',
);
assert.match(
  workflow,
  /name: Check Goldband Loop source quality[\s\S]*?GOLDBAND_COMPLEXITY_BASE_REF: \$\{\{ github\.event\.before \}\}/,
  'push CI must bind complexity comparison to the pre-push SHA',
);

const rootFileSelector = fs.readFileSync(
  path.join(root, 'scripts', 'lib', 'code-style', 'files.mjs'),
  'utf8',
);
assert.match(
  rootFileSelector,
  /Goldband Loop[\s\S]*?bun run check:source/,
  'the root exclusion must point to the actual Goldband Loop source gate',
);

console.log(
  'ok - Goldband Loop owns lint, complexity debt, typecheck, and unused-export gates',
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
