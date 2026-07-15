#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCapabilityInvocations } from './lib/capability-invocations.mjs';
import {
  discoverLegacyEntrypoints,
  discoverRuntimeBinaries,
} from './lib/goldband-source-inventory.mjs';
import {
  buildWorkflowContracts,
  validatePromptArchitecture,
  workflowContractPath,
} from './lib/workflow-contracts.mjs';

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
  'hooks/scripts/lib/skill-activation/activation-rules.js',
  'plugin-assets/claude-code-plugin/hooks/scripts/lib/skill-activation/activation-rules.js',
  'goldband-loop/CONTRIBUTING.md',
  'goldband-loop/SKILL.md',
];
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

validateManifest(manifest);
validateCapabilityInvocations({
  root,
  invocationRoots: CAPABILITY_INVOCATION_ROOTS,
  capabilities: manifest.capabilities,
});

const capabilityActions = manifest.capabilities.flatMap((capability) =>
  capability.actions.map((action) => ({
    capability: capability.id,
    action: action.id,
    name: `${capability.id}/${action.id}`,
    description: action.description,
    contractPath: workflowContractPath(capability.id, action.id).replace(
      /^goldband-loop\//,
      '',
    ),
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
      promptArchitecture: manifest.promptArchitecture,
      manuals: manifest.manuals,
      actions: capabilityActions,
    }),
  ],
  [
    'goldband-loop/generated/manual-routing.md',
    generatedManualRouting(manifest.manuals),
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
          promptContract: _promptContract,
          actions: capabilityActions,
          ...capability
        }) => ({
          ...capability,
          actions: capabilityActions.map(
            ({ promptContract: _actionPromptContract, ...action }) => action,
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
  [
    'goldband-loop/SKILL.md',
    generatedRootSkill(manifest.capabilities, manifest.manuals),
  ],
  ['docs/generated/capabilities.md', generatedDocs(manifest)],
]);

for (const [relativePath, content] of buildWorkflowContracts(manifest)) {
  outputs.set(relativePath, content);
}

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
  validatePromptArchitecture(value);
  for (const manual of value.manuals) {
    const source = path.resolve(loopRoot, manual.source);
    if (!fs.existsSync(source)) {
      throw new Error(`missing manual source: ${manual.source}`);
    }
  }
  const seen = new Set();
  for (const capability of value.capabilities ?? []) {
    validateCapability(capability);
    for (const action of capability.actions) {
      validateAction(capability.id, action, seen);
    }
  }
}

function generatedManualRouting(manuals) {
  const lines = manuals.map(
    (manual) =>
      `- Read \`manuals/${manual.id}.md\` only for ${manual.loadFor
        .map((selector) => `\`${selector}\``)
        .join(', ')}.`,
  );
  return `<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->\n${lines.join('\n')}\n`;
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
}

function generatedRegistry(entries) {
  return (
    `// AUTO-GENERATED from goldband.manifest.json. Do not edit.\n` +
    `import type { HostName, RiskLevel } from './types';\n\n` +
    `export type CapabilityActionRecord = {\n  capability: string;\n  action: string;\n  name: string;\n  description: string;\n  contractPath: string;\n  runtime: 'typed' | 'compatibility' | 'registered-only';\n  riskLevel: RiskLevel;\n  hostSupport: HostName[];\n};\n\n` +
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

function generatedRootSkill(capabilities, manuals) {
  const templatePath = path.join(loopRoot, 'SKILL.md.tmpl');
  const template = fs.readFileSync(templatePath, 'utf8');
  const content = template
    .replace('{{CAPABILITY_ROUTER}}', generatedRouter(capabilities).trim())
    .replace(
      '{{INTERACTION_POLICY}}',
      generatedInteractionPolicy(
        manifest.promptArchitecture.interactionPolicy,
      ).trim(),
    )
    .replace(
      '{{CAPABILITY_MANUAL_ROUTING}}',
      generatedManualRouting(manuals).trim(),
    );
  const unresolved = [...content.matchAll(/\{\{[A-Z][A-Z0-9_]*\}\}/g)].map(
    (match) => match[0],
  );
  if (unresolved.length > 0) {
    throw new Error(
      `unresolved root skill placeholders: ${unresolved.join(', ')}`,
    );
  }
  return content.replace(
    '\n---\n\n# Goldband capability router',
    '\n---\n<!-- AUTO-GENERATED from SKILL.md.tmpl and goldband.manifest.json. Do not edit. -->\n\n# Goldband capability router',
  );
}

function generatedDocs(value) {
  const rows = capabilityActions
    .map(
      (action) =>
        `| \`${action.capability}\` | \`${action.action}\` | ${action.description} | \`${action.runtime}\` | \`${action.riskLevel}\` |`,
    )
    .join('\n');
  return `<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->\n# Goldband capabilities\n\nFormal interface: \`${value.capabilityInterface}\`. Old workflow names are not aliases.\n\n| Capability | Action | Outcome | Runtime | Risk |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## Prompt/runtime boundary\n\n- Prompt contract: ${value.promptArchitecture.contract.join(', ')}.\n- Model owns: ${value.promptArchitecture.modelOwns.join(', ')}.\n- Runtime owns: ${value.promptArchitecture.runtimeOwns.join(', ')}.\n- Installed workflow documents are thin contracts generated from manifest-owned \`promptContract\` fields. Per-workflow \`SKILL.md\` and \`SKILL.md.tmpl\` prompt surfaces are not part of the architecture.\n\n${generatedInteractionPolicy(value.promptArchitecture.interactionPolicy)}\n`;
}

function generatedInteractionPolicy(policy) {
  return `## Human decisions\n\n- ${policy.askOnlyWhen}\n- ${policy.batching}\n- ${policy.formatOwner}\n- Avoid prompt-owned formats: ${policy.avoidPromptFormats.join(', ')}.`;
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
