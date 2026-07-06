#!/usr/bin/env node

import {
  buildAppSupportArtifacts,
  diffAppSupportArtifacts,
  writeAppSupportArtifacts,
} from './lib/app-support-distribution.mjs';

const checkOnly = process.argv.includes('--check');
const artifacts = buildAppSupportArtifacts();

if (checkOnly) {
  const diffs = diffAppSupportArtifacts(artifacts);
  if (diffs.length > 0) {
    console.error('App support artifacts are out of date:');
    for (const filePath of diffs) {
      console.error(`  - ${filePath}`);
    }
    console.error('Run: node scripts/sync-app-support-assets.mjs');
    process.exit(1);
  }
  console.log('[OK] app support artifacts are current');
} else {
  writeAppSupportArtifacts(artifacts);
  console.log('[OK] app support artifacts synced');
}
