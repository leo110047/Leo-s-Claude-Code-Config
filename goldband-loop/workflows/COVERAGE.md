# Workflow Runtime Coverage

## Core Set

Local usage logs did not contain `workflow-entry` events, so this core set uses
the documented fallback: root `CLAUDE.md`, `rules/git-workflow.md`, and
`goldband-loop/CLAUDE.md`.

| Workflow | Basis | Integration |
| --- | --- | --- |
| `goldband-review` | Code review is named in root guidance and git workflow. | `typed` |
| `goldband-investigate` | Bug/root-cause workflow is named in routing guidance. | `compatibility` |
| `goldband-qa` | QA/testing workflow is named in routing guidance. | `compatibility` |
| `plan` | Plan-first workflow is named in git workflow. | `compatibility` |
| `goldband-cso` | Security review is named in root preferred entrypoints. | `compatibility` |
| `goldband-ship` | Ship/release workflow is named in routing guidance. | `compatibility` |

## Integrated

These workflows run through `bun run workflows/run.ts` in mock mode and write
evidence under:

```bash
${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs/<workflow>.jsonl
```

| Workflow | Status | Entrypoint | Risk | Next step |
| --- | --- | --- | --- | --- |
| goldband-cso | integrated | compatibility | medium | Add typed security checklist and evidence gates. |
| goldband-investigate | integrated | compatibility | medium | Promote hypothesis and evidence loop to typed steps. |
| goldband-qa | integrated | compatibility | medium | Promote browser checks and screenshot artifacts to typed steps. |
| goldband-review | integrated | typed | medium | Keep schema and evidence fixtures stable. |
| goldband-ship | integrated | compatibility | high | Add safety-gate typed steps before side effects. |
| plan | integrated | compatibility | low | Type non-interactive review pieces while preserving HITL prompts. |

Real LLM e2e readback for `goldband-review`:

- Command: `GOLDBAND_HOME=/private/tmp/goldband-workflow-real-e2e-codex bun run workflows/run.ts goldband-review --mode real --host codex --diff-file test/fixtures/workflows/review.diff`
- Evidence path: `/private/tmp/goldband-workflow-real-e2e-codex/workflow-runs/goldband-review.jsonl`
- Fixture copy: `test/fixtures/workflows/real-llm-evidence.jsonl`
- Result: one validated high-severity finding and a rendered report artifact.

## Pending Registered-Only

| Workflow | Status | Entrypoint | Risk | Next step |
| --- | --- | --- | --- | --- |
| goldband-autoplan | registered-only | legacy-thin | low | Type non-interactive review pieces while preserving HITL prompts. |
| goldband-benchmark | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-benchmark-models | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-browse | registered-only | legacy-thin | medium | Prioritize after core runtime coverage settles. |
| goldband-canary | registered-only | legacy-thin | high | Prioritize after core runtime coverage settles. |
| goldband-careful | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-codex | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-context-restore | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-context-save | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-design-consultation | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-design-html | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-design-review | registered-only | legacy-thin | medium | Prioritize after core runtime coverage settles. |
| goldband-design-shotgun | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-devex-review | registered-only | legacy-thin | medium | Prioritize after core runtime coverage settles. |
| goldband-document-generate | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-document-release | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-freeze | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-guard | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-health | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-ios-clean | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-ios-design-review | registered-only | legacy-thin | medium | Prioritize after core runtime coverage settles. |
| goldband-ios-fix | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-ios-qa | registered-only | legacy-thin | high | Promote browser checks and screenshot artifacts to typed steps. |
| goldband-ios-sync | registered-only | legacy-thin | high | Prioritize after core runtime coverage settles. |
| goldband-land-and-deploy | registered-only | legacy-thin | high | Add safety-gate typed steps before side effects. |
| goldband-landing-report | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-learn | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-make-pdf | registered-only | legacy-thin | medium | Prioritize after core runtime coverage settles. |
| goldband-office-hours | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-open-goldband-browser | registered-only | legacy-thin | medium | Prioritize after core runtime coverage settles. |
| goldband-pair-agent | registered-only | legacy-thin | medium | Prioritize after core runtime coverage settles. |
| goldband-plan-ceo-review | registered-only | legacy-thin | medium | Type non-interactive review pieces while preserving HITL prompts. |
| goldband-plan-design-review | registered-only | legacy-thin | medium | Type non-interactive review pieces while preserving HITL prompts. |
| goldband-plan-devex-review | registered-only | legacy-thin | medium | Type non-interactive review pieces while preserving HITL prompts. |
| goldband-plan-eng-review | registered-only | legacy-thin | medium | Type non-interactive review pieces while preserving HITL prompts. |
| goldband-plan-tune | registered-only | legacy-thin | low | Type non-interactive review pieces while preserving HITL prompts. |
| goldband-qa-only | registered-only | legacy-thin | medium | Promote browser checks and screenshot artifacts to typed steps. |
| goldband-retro | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-scrape | registered-only | legacy-thin | medium | Prioritize after core runtime coverage settles. |
| goldband-setup-browser-cookies | registered-only | legacy-thin | high | Prioritize after core runtime coverage settles. |
| goldband-setup-deploy | registered-only | legacy-thin | high | Add safety-gate typed steps before side effects. |
| goldband-setup-gbrain | registered-only | legacy-thin | high | Prioritize after core runtime coverage settles. |
| goldband-skillify | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-sync-gbrain | registered-only | legacy-thin | high | Prioritize after core runtime coverage settles. |
| goldband-unfreeze | registered-only | legacy-thin | low | Prioritize after core runtime coverage settles. |
| goldband-upgrade | registered-only | legacy-thin | high | Prioritize after core runtime coverage settles. |

## Typed Migration Order

1. `goldband-investigate`: root-cause loop maps cleanly to hypothesis, evidence,
   and verified-cause steps.
2. `goldband-qa` / `goldband-qa-only`: browser checks and screenshots are
   naturally typed artifacts.
3. `plan-*`: type the non-interactive audit parts while preserving
   `AskUserQuestion` and HITL boundaries.
4. `goldband-ship`, `goldband-land-and-deploy`, deploy/setup workflows: keep
   compatibility first, then add explicit safety-gate typed steps before any
   external side effect.
