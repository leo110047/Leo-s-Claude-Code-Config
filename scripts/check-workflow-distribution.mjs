#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import {
  declaredDispatchContract,
  inspectDistribution,
  workflowSourceInputManifest,
} from './lib/workflow-distribution-contract.mjs';

const [command, sourceRootArg, runtimeRootArg, markerFileArg, ruleFileArg] =
  process.argv.slice(2);
const sourceRoot = sourceRootArg ? path.resolve(sourceRootArg) : undefined;

if (command === 'source-digest' && sourceRoot && !runtimeRootArg) {
  process.stdout.write(`${workflowSourceInputManifest(sourceRoot).digest}\n`);
} else if (command === 'expected-probe' && sourceRoot && !runtimeRootArg) {
  const dispatch = declaredDispatchContract(sourceRoot);
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      dispatch: 'trusted-launcher',
      actions: dispatch.trustedLauncher,
    })}\n`,
  );
} else if (command === 'inspect' && sourceRoot && runtimeRootArg) {
  const expectedSideArtifacts =
    markerFileArg && ruleFileArg
      ? [
          {
            role: 'workflow-launcher-marker',
            path: path.resolve(markerFileArg),
          },
          { role: 'codex-execpolicy-rule', path: path.resolve(ruleFileArg) },
        ]
      : [];
  const result = inspectDistribution(
    path.resolve(runtimeRootArg),
    sourceRoot,
    expectedSideArtifacts,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 2;
} else {
  console.error(
    'usage: check-workflow-distribution.mjs source-digest|expected-probe <source-root> | inspect <source-root> <runtime-root> [marker-file rule-file]',
  );
  process.exitCode = 2;
}
