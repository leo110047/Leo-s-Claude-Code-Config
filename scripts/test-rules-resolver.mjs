#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const resolver = require('../hooks/scripts/lib/rules-resolver.js');

function copyRulesFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-rules-'));
  fs.cpSync(path.resolve('rules'), dir, { recursive: true });
  return dir;
}

function testManifestGroupsOwnRuleMembership() {
  const rulesDir = copyRulesFixture();
  const manifestFile = path.join(rulesDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const security = manifest.rules.find((rule) => rule.id === 'security');
  const escalation = manifest.rules.find((rule) => rule.id === 'escalation');
  const securitySelector = manifest.groupSelectors.find(
    (selector) => selector.group === 'security',
  );
  security.groups = ['unused-security'];
  escalation.groups = ['security'];
  securitySelector.scopePattern = 'custom-manifest-trigger';
  manifest.groupSelectors.push({
    group: 'unused-security',
    scopePattern: 'never-selected',
  });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

  const bundle = resolver.resolveRules({
    repoRoot: process.cwd(),
    rulesDir,
    phase: 'review',
    scope: 'custom-manifest-trigger',
  });
  assert.equal(bundle.ruleIds.includes('security'), false);
  assert.equal(bundle.ruleIds.includes('escalation'), true);
}

function testReviewSnapshotIsStableAndRefreshable() {
  const rulesDir = copyRulesFixture();
  const snapshot = resolver.createRulesSnapshot({
    repoRoot: process.cwd(),
    rulesDir,
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.manifest), true);
  assert.equal(Object.isFrozen(snapshot.manifest.groupSelectors), true);
  assert.equal(Object.isFrozen(snapshot.rulesById), true);
  const first = resolver.resolveRules({
    snapshot,
    phase: 'review',
    scope: 'auth',
  });
  fs.appendFileSync(
    path.join(rulesDir, 'architecture-boundaries.md'),
    '\nSnapshot refresh marker.\n',
  );
  const stable = resolver.resolveRules({
    snapshot,
    phase: 'review',
    scope: 'auth',
  });
  const refreshed = resolver.resolveRules({
    repoRoot: process.cwd(),
    rulesDir,
    phase: 'review',
    scope: 'auth',
  });

  assert.equal(stable.contentHash, first.contentHash);
  assert.notEqual(refreshed.contentHash, first.contentHash);
}

function testChangeScopeAppliesBeforeReview() {
  const rulesDir = copyRulesFixture();
  for (const phase of ['plan', 'implementation', 'review']) {
    const bundle = resolver.resolveRules({
      repoRoot: process.cwd(),
      rulesDir,
      phase,
    });
    assert.equal(
      bundle.ruleIds.includes('change-scope'),
      true,
      `change-scope must apply during ${phase}`,
    );
  }
}

testManifestGroupsOwnRuleMembership();
testReviewSnapshotIsStableAndRefreshable();
testChangeScopeAppliesBeforeReview();

console.log('[OK] Rules resolver tests passed');
