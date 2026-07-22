const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MANIFEST_FILE = 'manifest.json';
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalRepoRoot(cwd = process.cwd()) {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Rules resolution requires a git repository: ${cwd}`);
  }
  return fs.realpathSync(result.stdout.trim());
}

function candidateRulesDirs(options = {}) {
  const home = os.homedir();
  return [
    options.rulesDir,
    process.env.GOLDBAND_RULES_DIR,
    path.join(options.repoRoot || '', 'rules'),
    path.join(home, '.claude', 'rules'),
    path.join(home, '.codex', 'rules'),
    // Works for source, packaged plugin, and ~/.claude/hooks installs.
    path.resolve(__dirname, '..', '..', '..', 'rules'),
  ].filter(Boolean);
}

function resolveRulesDir(options = {}) {
  for (const candidate of candidateRulesDirs(options)) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, MANIFEST_FILE))) return resolved;
  }
  throw new Error(
    `Goldband Rules manifest not found. Checked: ${candidateRulesDirs(options).join(', ')}`,
  );
}

function parseManifestFile(rulesDir) {
  let parsed;
  try {
    parsed = JSON.parse(
      fs.readFileSync(path.join(rulesDir, MANIFEST_FILE), 'utf8'),
    );
  } catch (error) {
    throw new Error(`invalid Rules manifest: ${error.message}`);
  }
  if (
    parsed.schemaVersion !== 1 ||
    !Array.isArray(parsed.rules) ||
    !Array.isArray(parsed.groupSelectors)
  ) {
    throw new Error(
      'invalid Rules manifest contract: schemaVersion=1, groupSelectors[], and rules[] are required',
    );
  }
  return parsed;
}

function validateGroupSelectors(selectors) {
  const groups = new Set();
  for (const selector of selectors) {
    validateGroupSelector(selector);
    if (groups.has(selector.group)) {
      throw new Error(`duplicate Rules group selector: ${selector.group}`);
    }
    groups.add(selector.group);
  }
  return groups;
}

function validateGroupSelector(selector) {
  if (!selector || typeof selector.group !== 'string') {
    throw new Error('invalid Rules group selector: group is required');
  }
  const hasPattern =
    typeof selector.scopePattern === 'string' && selector.scopePattern;
  if (selector.always !== true && !hasPattern) {
    throw new Error(
      `invalid Rules group selector ${selector.group}: always=true or scopePattern is required`,
    );
  }
  if (selector.phases && !Array.isArray(selector.phases)) {
    throw new Error(`invalid Rules group selector phases: ${selector.group}`);
  }
  if (
    selector.match !== undefined &&
    !['all', 'paths', 'scope'].includes(selector.match)
  ) {
    throw new Error(`invalid Rules group selector match: ${selector.group}`);
  }
  if (!hasPattern) return;
  try {
    new RegExp(selector.scopePattern, 'i');
  } catch (error) {
    throw new Error(
      `invalid Rules group selector pattern ${selector.group}: ${error.message}`,
    );
  }
}

function validateManifestEntries(rules) {
  const ids = new Set();
  const files = new Set();
  for (const rule of rules) {
    if (!rule || typeof rule.id !== 'string' || typeof rule.file !== 'string') {
      throw new Error('invalid Rules manifest entry: id and file are required');
    }
    if (ids.has(rule.id) || files.has(rule.file)) {
      throw new Error(
        `duplicate Rules manifest entry: ${rule.id}/${rule.file}`,
      );
    }
    if (!Array.isArray(rule.phases) || !Array.isArray(rule.groups)) {
      throw new Error(`invalid Rules metadata for ${rule.id}`);
    }
    ids.add(rule.id);
    files.add(rule.file);
  }
  return files;
}

function readManifest(rulesDir) {
  const parsed = parseManifestFile(rulesDir);
  const files = validateManifestEntries(parsed.rules);
  const groups = validateGroupSelectors(parsed.groupSelectors);
  for (const rule of parsed.rules) {
    for (const group of rule.groups) {
      if (!groups.has(group)) {
        throw new Error(`Rule ${rule.id} uses unknown group: ${group}`);
      }
    }
  }
  const sourceFiles = fs
    .readdirSync(rulesDir)
    .filter((file) => file.endsWith('.md'))
    .sort();
  const registeredFiles = [...files].sort();
  if (JSON.stringify(sourceFiles) !== JSON.stringify(registeredFiles)) {
    throw new Error(
      `Rules manifest coverage mismatch: source=${sourceFiles.join(',')} manifest=${registeredFiles.join(',')}`,
    );
  }
  return deepFreeze(parsed);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function scopeText(options = {}) {
  return [
    ...(options.paths || []),
    options.command || '',
    options.scope || '',
  ].join('\n');
}

function selectedRuleIds(manifest, options = {}) {
  const phase = options.phase || 'review';
  const selectedGroups = new Set();
  for (const selector of manifest.groupSelectors) {
    if (selector.phases && !selector.phases.includes(phase)) continue;
    const text = selectorScopeText(selector, options);
    if (
      selector.always === true ||
      new RegExp(selector.scopePattern, 'i').test(text)
    ) {
      selectedGroups.add(selector.group);
    }
  }
  return manifest.rules
    .filter(
      (rule) =>
        rule.phases.includes(phase) &&
        rule.groups.some((group) => selectedGroups.has(group)),
    )
    .map((rule) => rule.id);
}

function selectorScopeText(selector, options) {
  if (selector.match === 'paths') return (options.paths || []).join('\n');
  if (selector.match === 'scope') {
    return [options.command || '', options.scope || ''].join('\n');
  }
  return scopeText(options);
}

function createRulesSnapshot(options = {}) {
  const repoRoot = options.repoRoot
    ? fs.realpathSync(options.repoRoot)
    : canonicalRepoRoot(options.cwd);
  const rulesDir = resolveRulesDir({ ...options, repoRoot });
  const manifest = readManifest(rulesDir);
  const rulesById = {};
  for (const metadata of manifest.rules) {
    const sourceFile = path.join(rulesDir, metadata.file);
    let content;
    try {
      content = fs.readFileSync(sourceFile, 'utf8');
    } catch (error) {
      throw new Error(
        `cannot read Rule ${metadata.id} at ${sourceFile}: ${error.message}`,
      );
    }
    if (!content.trim()) {
      throw new Error(`Rule ${metadata.id} is empty: ${sourceFile}`);
    }
    rulesById[metadata.id] = Object.freeze({
      id: metadata.id,
      sourceFile,
      content,
      contentHash: sha256(content),
    });
  }
  return Object.freeze({
    repoRoot,
    rulesDir,
    manifest,
    rulesById: Object.freeze(rulesById),
  });
}

function resolveRules(options = {}) {
  const snapshot = options.snapshot || createRulesSnapshot(options);
  if (!snapshot.rulesById || !snapshot.manifest) {
    throw new Error('invalid Rules snapshot');
  }
  const ids = options.ruleIds || selectedRuleIds(snapshot.manifest, options);
  const rules = ids.map((id) => {
    const rule = snapshot.rulesById[id];
    if (!rule) throw new Error(`unknown Rule ID: ${id}`);
    return rule;
  });
  const contentHash = sha256(
    rules.map((rule) => `${rule.id}\0${rule.contentHash}`).join('\n'),
  );
  return {
    repoRoot: snapshot.repoRoot,
    rulesDir: snapshot.rulesDir,
    rules,
    ruleIds: rules.map((rule) => rule.id),
    contentHash,
  };
}

function formatRulesBundle(bundle) {
  return bundle.rules
    .map((rule) =>
      [
        `RULE_ID: ${rule.id}`,
        `POLICY_SOURCE: ${rule.sourceFile}`,
        `CONTENT_HASH: ${rule.contentHash}`,
        rule.content.trim(),
      ].join('\n'),
    )
    .join('\n\n---\n\n');
}

module.exports = {
  canonicalRepoRoot,
  createRulesSnapshot,
  formatRulesBundle,
  resolveRules,
  sha256,
};
