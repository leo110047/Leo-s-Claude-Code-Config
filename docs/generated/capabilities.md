<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# Goldband capabilities

Formal interface: `$goldband <capability> <action>`. Old workflow names are not aliases.

| Capability | Action | Outcome | Runtime | Risk |
| --- | --- | --- | --- | --- |
| `review` | `code` | Review a code diff. | `typed` | `medium` |
| `review` | `security` | Review security and trust boundaries. | `compatibility` | `medium` |
| `review` | `design` | Review visual and product design. | `registered-only` | `medium` |
| `review` | `devex` | Review developer experience. | `registered-only` | `medium` |
| `review` | `opposite-host` | Get an opposite-host second opinion. | `registered-only` | `low` |
| `review` | `plan-ceo` | Review product scope and ambition. | `registered-only` | `medium` |
| `review` | `plan-design` | Review a plan's design contract. | `registered-only` | `medium` |
| `review` | `plan-devex` | Review a plan's developer experience. | `registered-only` | `medium` |
| `review` | `plan-engineering` | Review architecture and implementation plans. | `registered-only` | `medium` |
| `investigate` | `code` | Investigate code or runtime behavior. | `compatibility` | `medium` |
| `qa` | `app` | Run product QA and record evidence. | `typed` | `medium` |
| `qa` | `report-only` | Report QA findings without fixing. | `registered-only` | `medium` |
| `release` | `land` | Merge, deploy, and verify. | `registered-only` | `high` |
| `release` | `setup` | Configure deployment. | `registered-only` | `high` |
| `release` | `canary` | Monitor a deployment after release. | `registered-only` | `high` |
| `release` | `report` | Produce a landing report. | `registered-only` | `low` |
| `release` | `docs` | Update documentation for a release. | `registered-only` | `low` |
| `plan` | `create` | Create an implementation plan. | `compatibility` | `low` |
| `plan` | `auto` | Run the complete plan review pipeline. | `registered-only` | `low` |
| `plan` | `strategy` | Explore product direction and scope. | `registered-only` | `low` |
| `plan` | `tune` | Tune recurring planning questions. | `registered-only` | `low` |
| `browser` | `session` | Use the persistent browser for interactive work. | `registered-only` | `medium` |
| `browser` | `open` | Open a visible browser workbench. | `registered-only` | `medium` |
| `browser` | `scrape` | Extract content or media from a page. | `registered-only` | `medium` |
| `browser` | `cookies` | Import browser cookies for authenticated testing. | `registered-only` | `high` |
| `browser` | `pair` | Pair another agent with the browser. | `registered-only` | `medium` |
| `design` | `consult` | Define a design direction and system. | `registered-only` | `low` |
| `design` | `prototype` | Generate an HTML design prototype. | `registered-only` | `low` |
| `design` | `explore` | Explore multiple design directions. | `registered-only` | `low` |
| `safety` | `careful` | Enable careful command handling. | `registered-only` | `low` |
| `safety` | `guard` | Enable workflow-local safety rails. | `registered-only` | `low` |
| `safety` | `freeze` | Restrict edits to an approved scope. | `registered-only` | `low` |
| `safety` | `unfreeze` | Remove an active edit restriction. | `registered-only` | `low` |
| `context` | `save` | Save current working context. | `registered-only` | `low` |
| `context` | `restore` | Restore saved working context. | `registered-only` | `low` |
| `context` | `retro` | Summarize recent work and lessons. | `registered-only` | `low` |
| `knowledge` | `recall` | Inspect Goldband learnings and knowledge. | `registered-only` | `low` |
| `knowledge` | `setup` | Configure GBrain integration. | `registered-only` | `high` |
| `knowledge` | `sync` | Synchronize GBrain knowledge. | `registered-only` | `high` |
| `benchmark` | `workflow` | Benchmark product or workflow performance. | `registered-only` | `low` |
| `benchmark` | `models` | Compare model performance. | `registered-only` | `low` |
| `document` | `generate` | Generate product or module documentation. | `registered-only` | `low` |
| `document` | `pdf` | Create a PDF artifact. | `registered-only` | `medium` |
| `system` | `health` | Inspect Goldband health and installation state. | `registered-only` | `low` |
| `system` | `upgrade` | Upgrade Goldband. | `registered-only` | `high` |
| `system` | `skill-authoring` | Create or improve a Goldband workflow skill. | `registered-only` | `low` |
| `ios` | `clean` | Clean iOS project state. | `registered-only` | `low` |
| `ios` | `review` | Review iOS design and behavior. | `registered-only` | `medium` |
| `ios` | `fix` | Repair iOS implementation issues. | `registered-only` | `low` |
| `ios` | `qa` | Run iOS QA. | `registered-only` | `high` |
| `ios` | `sync` | Synchronize iOS project state. | `registered-only` | `high` |

## Prompt/runtime boundary

- Prompt contract: goal, relevant-context, hard-boundaries, verification.
- Model owns: semantic-reasoning, task-decomposition, tool-selection, adaptation.
- Runtime owns: routing, authorization, side-effect-gates, typed-evidence, stop-conditions, state, observability, interaction-schema.
- Installed workflow documents are thin contracts generated from manifest-owned `promptContract` fields. Per-workflow `SKILL.md` and `SKILL.md.tmpl` prompt surfaces are not part of the architecture.

## Human decisions

- Ask only when the answer can materially change the result and cannot be safely inferred from current evidence or user-stated preferences.
- Batch related decisions when they can be answered together; split only when an earlier answer changes the next question, risk level, or required evidence.
- Tool schemas and UI own question shape, option labels, validation, and persistence. Prompts should provide only concise decision context.
- Avoid prompt-owned formats: prompt-owned formatting rubrics, scores, word-count rules, per-finding question rules.
