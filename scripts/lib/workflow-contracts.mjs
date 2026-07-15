import path from 'node:path';

const REQUIRED_CONTRACT_FIELDS = [
  'goal',
  'relevant-context',
  'hard-boundaries',
  'verification',
];

const REQUIRED_PROHIBITIONS = [
  'universal-preamble',
  'embedded-browser-manual',
  'per-workflow-tool-script',
  'duplicated-routing-table',
];

const REQUIRED_INTERACTION_POLICY_FIELDS = [
  'askOnlyWhen',
  'batching',
  'formatOwner',
  'avoidPromptFormats',
];

const PROHIBITED_PATTERNS = {
  'universal-preamble': [
    /## Preamble \(run first\)/i,
    /## AskUserQuestion Format/i,
    /## Context Recovery/i,
    /## Model-Specific Behavioral Patch/i,
    /## Continuous Checkpoint Mode/i,
  ],
  'embedded-browser-manual': [
    /## Full Command List/i,
    /## Snapshot Flags/i,
    /## Core QA Patterns/i,
  ],
  'per-workflow-tool-script': [/```(?:bash|sh|zsh)\b/i],
  'duplicated-routing-table': [/## Capability menu/i],
};

export function validatePromptArchitecture(manifest) {
  const architecture = manifest.promptArchitecture;
  if (!architecture || typeof architecture !== 'object') {
    throw new Error('promptArchitecture is required');
  }
  assertExactSet(
    'promptArchitecture.contract',
    architecture.contract,
    REQUIRED_CONTRACT_FIELDS,
  );
  assertExactSet(
    'promptArchitecture.prohibitedSharedBoilerplate',
    architecture.prohibitedSharedBoilerplate,
    REQUIRED_PROHIBITIONS,
  );
  validateInteractionPolicy(architecture.interactionPolicy);

  validateCapabilityPromptContracts(manifest.capabilities ?? []);
  validateManuals(manifest.manuals ?? []);
}

function validateInteractionPolicy(policy) {
  if (!policy || typeof policy !== 'object') {
    throw new Error('promptArchitecture.interactionPolicy is required');
  }
  for (const field of REQUIRED_INTERACTION_POLICY_FIELDS) {
    if (!(field in policy)) {
      throw new Error(
        `promptArchitecture.interactionPolicy.${field} is required`,
      );
    }
  }
  for (const field of ['askOnlyWhen', 'batching', 'formatOwner']) {
    if (typeof policy[field] !== 'string' || policy[field].trim() === '') {
      throw new Error(
        `promptArchitecture.interactionPolicy.${field} must be a non-empty string`,
      );
    }
  }
  if (
    !Array.isArray(policy.avoidPromptFormats) ||
    policy.avoidPromptFormats.length === 0 ||
    policy.avoidPromptFormats.some(
      (item) => typeof item !== 'string' || item.trim() === '',
    )
  ) {
    throw new Error(
      'promptArchitecture.interactionPolicy.avoidPromptFormats must be a non-empty string array',
    );
  }
}

function validateCapabilityPromptContracts(capabilities) {
  for (const capability of capabilities) {
    validatePromptContract(
      capability.promptContract,
      `capability ${capability.id}`,
    );
    for (const action of capability.actions ?? []) {
      if (action.promptContract) {
        validatePromptContract(
          action.promptContract,
          `action ${capability.id}/${action.id}`,
          { allowPartial: true },
        );
      }
    }
  }
}

function validateManuals(manuals) {
  const manualIds = new Set();
  for (const manual of manuals) {
    if (!/^[a-z][a-z0-9-]*$/.test(manual.id ?? '')) {
      throw new Error(`invalid manual id: ${manual.id}`);
    }
    if (manualIds.has(manual.id)) {
      throw new Error(`duplicate manual id: ${manual.id}`);
    }
    manualIds.add(manual.id);
    if (
      !manual.source ||
      !Array.isArray(manual.loadFor) ||
      manual.loadFor.length === 0
    ) {
      throw new Error(`manual ${manual.id} requires source and loadFor`);
    }
  }
}

export function buildWorkflowContracts(manifest) {
  validatePromptArchitecture(manifest);
  const outputs = new Map();
  for (const capability of manifest.capabilities) {
    for (const action of capability.actions) {
      const relativePath = workflowContractPath(capability.id, action.id);
      const content = renderWorkflowContract(capability, action);
      validateWorkflowContractContent(content, manifest.promptArchitecture, {
        relativePath,
      });
      outputs.set(relativePath, content);
    }
  }
  return outputs;
}

export function workflowContractPath(capability, action) {
  return path.posix.join(
    'goldband-loop',
    'generated',
    'workflow-contracts',
    capability,
    `${action}.workflow.md`,
  );
}

export function validateWorkflowContractContent(
  content,
  architecture,
  { relativePath = 'workflow contract' } = {},
) {
  for (const heading of [
    'Goal',
    'Relevant context',
    'Hard boundaries',
    'Verification',
  ]) {
    if (!content.includes(`## ${heading}`)) {
      throw new Error(`${relativePath}: missing ## ${heading}`);
    }
  }
  validateSharedPromptContent(content, architecture, { relativePath });
}

export function validateSharedPromptContent(
  content,
  architecture,
  { relativePath = 'shared prompt' } = {},
) {
  for (const prohibition of architecture.prohibitedSharedBoilerplate) {
    for (const pattern of PROHIBITED_PATTERNS[prohibition] ?? []) {
      if (pattern.test(content)) {
        throw new Error(`${relativePath}: contains ${prohibition}`);
      }
    }
  }
}

function renderWorkflowContract(capability, action) {
  const contract = mergePromptContracts(
    capability.promptContract,
    action.promptContract,
  );
  return `<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband ${capability.id} ${action.id}

## Goal

${action.description}

## Relevant context

${renderList(contract.relevantContext)}

## Hard boundaries

${renderList(contract.hardBoundaries)}

## Verification

${renderList(contract.verification)}
`;
}

function mergePromptContracts(base, override = {}) {
  return {
    relevantContext: unique([
      ...(base.relevantContext ?? []),
      ...(override.relevantContext ?? []),
    ]),
    hardBoundaries: unique([
      ...(base.hardBoundaries ?? []),
      ...(override.hardBoundaries ?? []),
    ]),
    verification: unique([
      ...(base.verification ?? []),
      ...(override.verification ?? []),
    ]),
  };
}

function validatePromptContract(
  contract,
  owner,
  { allowPartial = false } = {},
) {
  if (!contract || typeof contract !== 'object') {
    throw new Error(`${owner}: promptContract is required`);
  }
  for (const field of ['relevantContext', 'hardBoundaries', 'verification']) {
    const value = contract[field];
    if (allowPartial && value === undefined) continue;
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(
        `${owner}: promptContract.${field} must be a non-empty array`,
      );
    }
    if (value.some((item) => typeof item !== 'string' || item.trim() === '')) {
      throw new Error(
        `${owner}: promptContract.${field} contains an invalid item`,
      );
    }
  }
}

function renderList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

function unique(items) {
  return [...new Set(items)];
}

function assertExactSet(label, actual, expected) {
  if (!Array.isArray(actual)) throw new Error(`${label} must be an array`);
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}
