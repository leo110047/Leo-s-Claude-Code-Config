import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const loopRoot = path.join(root, 'goldband-loop');
const loopPackage = readJson(path.join(loopRoot, 'package.json'));

const expectedScripts = {
  'lint:source': 'biome lint',
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

const workflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'validate.yml'),
  'utf8',
);
assert.match(
  workflow,
  /name: Check Goldband Loop source quality[\s\S]*?run: cd goldband-loop && bun run check:source/,
  'validate CI must run the Goldband Loop source gate after dependencies are installed',
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

console.log('ok - Goldband Loop owns lint, typecheck, and unused-export gates');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
