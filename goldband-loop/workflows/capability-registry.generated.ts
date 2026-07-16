// AUTO-GENERATED from goldband.manifest.json. Do not edit.
import type { HostName, RiskLevel, RuntimeActionContract } from './types';

export type CapabilityActionRecord = {
  capability: string;
  action: string;
  name: string;
  description: string;
  contractPath: string;
  runtime: 'typed' | 'compatibility' | 'registered-only';
  lifecycle: 'public' | 'experimental';
  runtimeOwner: string | null;
  runtimeContract: RuntimeActionContract | null;
  riskLevel: RiskLevel;
  hostSupport: HostName[];
};

export const CAPABILITY_ACTIONS: CapabilityActionRecord[] = [
  {
    "capability": "review",
    "action": "code",
    "name": "review/code",
    "description": "Review a code diff.",
    "contractPath": "generated/workflow-contracts/review/code.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "review-runtime",
    "runtimeContract": null,
    "riskLevel": "medium",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "review",
    "action": "security",
    "name": "review/security",
    "description": "Review security and trust boundaries.",
    "contractPath": "generated/workflow-contracts/review/security.workflow.md",
    "runtime": "compatibility",
    "lifecycle": "public",
    "runtimeOwner": "prompt-contract-dispatch",
    "runtimeContract": null,
    "riskLevel": "medium",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "investigate",
    "action": "code",
    "name": "investigate/code",
    "description": "Investigate code or runtime behavior.",
    "contractPath": "generated/workflow-contracts/investigate/code.workflow.md",
    "runtime": "compatibility",
    "lifecycle": "public",
    "runtimeOwner": "prompt-contract-dispatch",
    "runtimeContract": null,
    "riskLevel": "medium",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "qa",
    "action": "app",
    "name": "qa/app",
    "description": "Run product QA and record evidence.",
    "contractPath": "generated/workflow-contracts/qa/app.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "qa-runtime",
    "runtimeContract": null,
    "riskLevel": "medium",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "release",
    "action": "land",
    "name": "release/land",
    "description": "Merge, deploy, and verify.",
    "contractPath": "generated/workflow-contracts/release/land.workflow.md",
    "runtime": "registered-only",
    "lifecycle": "experimental",
    "runtimeOwner": null,
    "runtimeContract": null,
    "riskLevel": "high",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "release",
    "action": "setup",
    "name": "release/setup",
    "description": "Configure deployment.",
    "contractPath": "generated/workflow-contracts/release/setup.workflow.md",
    "runtime": "registered-only",
    "lifecycle": "experimental",
    "runtimeOwner": null,
    "runtimeContract": null,
    "riskLevel": "high",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "plan",
    "action": "create",
    "name": "plan/create",
    "description": "Create an implementation plan.",
    "contractPath": "generated/workflow-contracts/plan/create.workflow.md",
    "runtime": "compatibility",
    "lifecycle": "public",
    "runtimeOwner": "prompt-contract-dispatch",
    "runtimeContract": null,
    "riskLevel": "low",
    "hostSupport": [
      "claude"
    ]
  },
  {
    "capability": "browser",
    "action": "session",
    "name": "browser/session",
    "description": "Use the persistent browser for interactive work.",
    "contractPath": "generated/workflow-contracts/browser/session.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "browse",
    "runtimeContract": null,
    "riskLevel": "medium",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "design",
    "action": "consult",
    "name": "design/consult",
    "description": "Define a design direction and system.",
    "contractPath": "generated/workflow-contracts/design/consult.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "design-decision-store",
    "runtimeContract": null,
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "safety",
    "action": "guard",
    "name": "safety/guard",
    "description": "Enable careful-mode for a Claude session.",
    "contractPath": "generated/workflow-contracts/safety/guard.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "claude-hook-mode-state",
    "runtimeContract": null,
    "riskLevel": "low",
    "hostSupport": [
      "claude"
    ]
  },
  {
    "capability": "safety",
    "action": "freeze",
    "name": "safety/freeze",
    "description": "Enable read-only freeze-mode for a Claude session.",
    "contractPath": "generated/workflow-contracts/safety/freeze.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "claude-hook-mode-state",
    "runtimeContract": null,
    "riskLevel": "low",
    "hostSupport": [
      "claude"
    ]
  },
  {
    "capability": "safety",
    "action": "unfreeze",
    "name": "safety/unfreeze",
    "description": "Disable freeze-mode for a Claude session.",
    "contractPath": "generated/workflow-contracts/safety/unfreeze.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "claude-hook-mode-state",
    "runtimeContract": null,
    "riskLevel": "low",
    "hostSupport": [
      "claude"
    ]
  },
  {
    "capability": "context",
    "action": "save",
    "name": "context/save",
    "description": "Save current working context.",
    "contractPath": "generated/workflow-contracts/context/save.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "context-checkpoint-store",
    "runtimeContract": null,
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "context",
    "action": "restore",
    "name": "context/restore",
    "description": "Restore saved working context.",
    "contractPath": "generated/workflow-contracts/context/restore.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "context-checkpoint-store",
    "runtimeContract": null,
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "context",
    "action": "retro",
    "name": "context/retro",
    "description": "Summarize recent work and lessons.",
    "contractPath": "generated/workflow-contracts/context/retro.workflow.md",
    "runtime": "compatibility",
    "lifecycle": "public",
    "runtimeOwner": "prompt-contract-dispatch",
    "runtimeContract": null,
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "knowledge",
    "action": "recall",
    "name": "knowledge/recall",
    "description": "Inspect Goldband learnings and knowledge.",
    "contractPath": "generated/workflow-contracts/knowledge/recall.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "goldband-knowledge",
    "runtimeContract": null,
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "knowledge",
    "action": "setup",
    "name": "knowledge/setup",
    "description": "Configure GBrain integration.",
    "contractPath": "generated/workflow-contracts/knowledge/setup.workflow.md",
    "runtime": "registered-only",
    "lifecycle": "experimental",
    "runtimeOwner": null,
    "runtimeContract": null,
    "riskLevel": "high",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "knowledge",
    "action": "sync",
    "name": "knowledge/sync",
    "description": "Synchronize GBrain knowledge.",
    "contractPath": "generated/workflow-contracts/knowledge/sync.workflow.md",
    "runtime": "registered-only",
    "lifecycle": "experimental",
    "runtimeOwner": null,
    "runtimeContract": null,
    "riskLevel": "high",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "benchmark",
    "action": "workflow",
    "name": "benchmark/workflow",
    "description": "Benchmark product or workflow performance.",
    "contractPath": "generated/workflow-contracts/benchmark/workflow.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "benchmark-evidence-aggregator",
    "runtimeContract": null,
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "document",
    "action": "generate",
    "name": "document/generate",
    "description": "Audit documentation coverage and prepare documentation artifacts.",
    "contractPath": "generated/workflow-contracts/document/generate.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "documentation-audit",
    "runtimeContract": {
      "modes": [
        "audit"
      ],
      "requiredInputs": {
        "audit": [
          "diffFile"
        ]
      },
      "outputs": [
        "coverage-artifact",
        "pr-body-section-artifact"
      ],
      "sideEffects": {
        "pr-body-update": "native-host-approval"
      }
    },
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "system",
    "action": "health",
    "name": "system/health",
    "description": "Inspect Goldband health and installation state.",
    "contractPath": "generated/workflow-contracts/system/health.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "goldband-installation",
    "runtimeContract": null,
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "system",
    "action": "upgrade",
    "name": "system/upgrade",
    "description": "Upgrade Goldband.",
    "contractPath": "generated/workflow-contracts/system/upgrade.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "goldband-setup-gate",
    "runtimeContract": null,
    "riskLevel": "high",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  },
  {
    "capability": "ios",
    "action": "qa",
    "name": "ios/qa",
    "description": "Run iOS QA.",
    "contractPath": "generated/workflow-contracts/ios/qa.workflow.md",
    "runtime": "typed",
    "lifecycle": "public",
    "runtimeOwner": "ios-qa-evidence",
    "runtimeContract": null,
    "riskLevel": "high",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes",
      "gbrain"
    ]
  }
];
