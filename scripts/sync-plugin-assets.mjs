#!/usr/bin/env node

import {
  buildPluginArtifacts,
  diffArtifacts,
  writeArtifacts,
} from './lib/plugin-distribution.mjs';

const checkOnly = process.argv.includes('--check');
const artifacts = buildPluginArtifacts();

if (checkOnly) {
  const diffs = diffArtifacts(artifacts);
  if (diffs.length > 0) {
    console.error('Plugin distribution artifacts are out of date:');
    for (const filePath of diffs) {
      console.error(`  - ${filePath}`);
    }
    console.error('Run: node scripts/sync-plugin-assets.mjs');
    process.exit(1);
  }
  console.log('[OK] plugin distribution artifacts are current');
} else {
  writeArtifacts(artifacts);
  console.log('[OK] plugin distribution artifacts synced');
}
