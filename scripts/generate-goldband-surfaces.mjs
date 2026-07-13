#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverLegacyEntrypoints,
  discoverRuntimeBinaries,
} from './lib/goldband-source-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loopRoot = path.join(root, 'goldband-loop');
const manifestPath = path.join(root, 'goldband.manifest.json');
const check = process.argv.includes('--check');
const ALL_HOSTS = [
  'claude',
  'codex',
  'factory',
  'kiro',
  'opencode',
  'slate',
  'cursor',
  'openclaw',
  'hermes',
  'gbrain',
];
const CAPABILITY_INVOCATION_ROOTS = [
  'README.md',
  'README.en.md',
  'examples/CLAUDE.md',
  'commands',
  'plugin-assets/claude-code-plugin/commands',
  'codex/agents',
  'codex/hooks/hook-router.js',
  'codex/prompts/goldband.md',
  'hooks/scripts/lib/hook-router/lifecycle-policy.js',
  'hooks/scripts/lib/skill-activation/activation-rules.js',
  'plugin-assets/claude-code-plugin/hooks/scripts/lib/hook-router/lifecycle-policy.js',
  'plugin-assets/claude-code-plugin/hooks/scripts/lib/skill-activation/activation-rules.js',
  'goldband-loop/CONTRIBUTING.md',
  'goldband-loop/SKILL.md',
];
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

validateManifest(manifest);
validateCapabilityInvocations(manifest);

const capabilityActions = manifest.capabilities.flatMap((capability) =>
  capability.actions.map((action) => ({
    capability: capability.id,
    action: action.id,
    name: `${capability.id}/${action.id}`,
    description: action.description,
    sourceTemplate: action.source,
    runtime: action.runtime,
    riskLevel: action.risk,
    hostSupport: action.hostSupport ?? ALL_HOSTS,
  })),
);

const outputs = new Map([
  [
    'goldband-loop/generated/capability-actions.json',
    json({
      schemaVersion: manifest.schemaVersion,
      interface: '$goldband <capability> <action>',
      actions: capabilityActions,
    }),
  ],
  [
    'rules/manifest.json',
    json({
      schemaVersion: manifest.schemaVersion,
      groupSelectors: manifest.policyGroups,
      rules: manifest.policies.map(
        ({ enforcement: _enforcement, ...policy }) => policy,
      ),
    }),
  ],
  [
    'goldband-loop/inventory.json',
    json({
      schema: 2,
      runtimeRoot: manifest.distribution.runtimeRoot,
      visibleSkills: manifest.distribution.visibleSkills,
      internalClaudeSkills: manifest.distribution.internalClaudeSkills,
      capabilities: manifest.capabilities.map(
        ({
          triggers: _triggers,
          actions: capabilityActions,
          ...capability
        }) => ({
          ...capability,
          actions: capabilityActions.map(
            ({ source: _source, ...action }) => action,
          ),
        }),
      ),
      binaries: discoverRuntimeBinaries(loopRoot),
      forbiddenLegacyEntrypoints: discoverLegacyEntrypoints(loopRoot),
      forbiddenCommands: manifest.distribution.forbiddenCommands,
    }),
  ],
  [
    'goldband-loop/workflows/capability-registry.generated.ts',
    generatedRegistry(capabilityActions),
  ],
  [
    'hooks/scripts/lib/skill-activation/capability-routing.generated.json',
    json(activationRules(manifest.capabilities)),
  ],
  [
    'codex/hooks/capability-routing.generated.json',
    json(codexHints(manifest.capabilities)),
  ],
  [
    'goldband-loop/generated/capability-router.md',
    generatedRouter(manifest.capabilities),
  ],
  ['docs/generated/capabilities.md', generatedDocs(manifest)],
]);

let stale = false;
for (const [relativePath, content] of outputs) {
  const target = path.join(root, relativePath);
  const current = fs.existsSync(target)
    ? fs.readFileSync(target, 'utf8')
    : null;
  if (current === content) continue;
  stale = true;
  if (check) {
    console.error(`STALE ${relativePath}`);
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  console.log(`GENERATED ${relativePath}`);
}

if (check && stale) process.exit(1);
if (check) console.log('Goldband generated surfaces are current.');

function validateManifest(value) {
  if (value.schemaVersion !== 1) throw new Error('unsupported manifest schema');
  const seen = new Set();
  for (const capability of value.capabilities ?? []) {
    validateCapability(capability);
    for (const action of capability.actions) {
      validateAction(capability.id, action, seen);
    }
  }
}

function validateCapabilityInvocations(value) {
  const validActions = new Set(
    value.capabilities.flatMap((capability) =>
      capability.actions.map((action) => `${capability.id}/${action.id}`),
    ),
  );
  const invalid = CAPABILITY_INVOCATION_ROOTS.flatMap((entry) =>
    invocationFiles(path.join(root, entry)),
  ).flatMap((file) => invalidInvocations(file, validActions));

  if (invalid.length > 0) {
    throw new Error(
      `invalid Goldband capability invocation; expected $goldband <capability> <action>:\n${invalid.join('\n')}`,
    );
  }
}

function invalidInvocations(file, validActions) {
  const content = fs.readFileSync(file, 'utf8');
  const pattern =
    /(?:\$|\/)goldband(?:[ \t]+([a-z][a-z0-9-]*))?(?:[ \t]+([a-z][a-z0-9-]*))?/gi;
  return [...content.matchAll(pattern)]
    .filter((match) => match[1])
    .filter((match) => {
      if (!match[2]) return true;
      return !validActions.has(
        `${match[1].toLowerCase()}/${match[2].toLowerCase()}`,
      );
    })
    .map((match) => {
      const line = content.slice(0, match.index).split('\n').length;
      return `${path.relative(root, file)}:${line}: ${JSON.stringify(match[0])}`;
    });
}

function invocationFiles(entry) {
  if (!fs.existsSync(entry)) return [];
  const stat = fs.statSync(entry);
  if (stat.isFile()) return [entry];
  return fs
    .readdirSync(entry, { withFileTypes: true })
    .flatMap((child) => invocationFiles(path.join(entry, child.name)));
}

function validateCapability(capability) {
  if (!/^[a-z][a-z0-9-]*$/.test(capability.id)) {
    throw new Error(`invalid capability: ${capability.id}`);
  }
  if (
    !capability.actions?.some(
      (action) => action.id === capability.defaultAction,
    )
  ) {
    throw new Error(`${capability.id}: defaultAction is not declared`);
  }
}

function validateAction(capabilityId, action, seen) {
  const name = `${capabilityId}/${action.id}`;
  if (seen.has(name)) throw new Error(`duplicate action: ${name}`);
  seen.add(name);
  const source = path.resolve(root, 'goldband-loop', action.source);
  if (!fs.existsSync(source))
    throw new Error(`${name}: missing source ${action.source}`);
}

function generatedRegistry(entries) {
  return (
    `// AUTO-GENERATED from goldband.manifest.json. Do not edit.\n` +
    `import type { HostName, RiskLevel } from './types';\n\n` +
    `export type CapabilityActionRecord = {\n  capability: string;\n  action: string;\n  name: string;\n  description: string;\n  sourceTemplate: string;\n  runtime: 'typed' | 'compatibility' | 'registered-only';\n  riskLevel: RiskLevel;\n  hostSupport: HostName[];\n};\n\n` +
    `export const CAPABILITY_ACTIONS: CapabilityActionRecord[] = ${JSON.stringify(
      entries,
      null,
      2,
    )};\n`
  );
}

function activationRules(capabilities) {
  return capabilities.map((capability) => ({
    skill: `goldband:${capability.id}/${capability.defaultAction}`,
    priority: ['review', 'investigate', 'qa'].includes(capability.id)
      ? 'high'
      : 'medium',
    hint: `Use $goldband ${capability.id} ${capability.defaultAction} when this capability matches the task.`,
    keywords: capability.triggers,
  }));
}

function codexHints(capabilities) {
  return capabilities.map((capability) => ({
    name: capability.id,
    triggers: capability.triggers,
    message: `Goldband capability available: $goldband ${capability.id} ${capability.defaultAction}. Use it only when it materially matches the requested outcome.`,
  }));
}

function generatedRouter(capabilities) {
  const menu = capabilities
    .map(
      (capability) =>
        `- \`$goldband ${capability.id} ${capability.defaultAction}\` — ${capability.description}`,
    )
    .join('\n');
  return `<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->\n${menu}\n`;
}

function generatedDocs(value) {
  const rows = capabilityActions
    .map(
      (action) =>
        `| \`${action.capability}\` | \`${action.action}\` | ${action.description} | \`${action.runtime}\` | \`${action.riskLevel}\` |`,
    )
    .join('\n');
  return `<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->\n# Goldband capabilities\n\nFormal interface: \`${value.capabilityInterface}\`. Old workflow names are not aliases.\n\n| Capability | Action | Outcome | Runtime | Risk |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## Prompt/runtime boundary\n\n- Prompt contract: ${value.promptArchitecture.contract.join(', ')}.\n- Model owns: ${value.promptArchitecture.modelOwns.join(', ')}.\n- Runtime owns: ${value.promptArchitecture.runtimeOwns.join(', ')}.\n`;
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
