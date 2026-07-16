#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeLegacyHostSkillArtifacts } from './lib/repo-test-environment.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const removed = removeLegacyHostSkillArtifacts(ROOT);
if (removed.length === 0) {
  console.log(
    '[cleanup:legacy-host-artifacts] no retired generated host skills found',
  );
} else {
  for (const relativePath of removed) {
    console.log(`[cleanup:legacy-host-artifacts] removed ${relativePath}`);
  }
}
