---
name: goldband
version: 2.0.0
description: |
  Route Goldband tasks through the formal capability interface for review, investigation,
  QA, release, planning, browser, design, safety, context, knowledge, benchmarking,
  documents, system maintenance, and iOS work.
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->

# Goldband capability router

Use the exact interface `$goldband <capability> <action>`. Old workflow names are
not aliases and must fail as unknown input.

For an empty invocation, show this generated capability menu and stop:

<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
- `$goldband review code` — Independent review with a selected engineering lens.
- `$goldband investigate code` — Find and verify the root cause of a failure.
- `$goldband qa app` — Verify product behavior with explicit evidence.
- `$goldband release land` — Prepare, land, deploy, and verify a release.
- `$goldband plan create` — Create, expand, or tune an implementation plan.
- `$goldband browser session` — Operate the persistent browser and browser-backed tools.
- `$goldband design consult` — Define, explore, and prototype product design.
- `$goldband safety guard` — Apply or remove workflow safety boundaries.
- `$goldband context restore` — Save, restore, and summarize working context.
- `$goldband knowledge recall` — Recall, configure, and synchronize Goldband knowledge.
- `$goldband benchmark workflow` — Measure workflow or model performance.
- `$goldband document generate` — Create product documentation and publication artifacts.
- `$goldband system health` — Inspect or maintain the Goldband installation.
- `$goldband ios qa` — Maintain and validate iOS-specific product behavior.

## Route and load

1. Select one capability/action from the menu using the user's requested outcome.
   Do not force a workflow when ordinary conversation is sufficient.
2. Resolve the active Goldband runtime root from `GOLDBAND_ROOT`, or from the
   directory containing this `SKILL.md`.
3. Read `workflows/<capability>/<action>.workflow.md` completely. That file is
   the task contract. Do not search for nested workflow `SKILL.md` entrypoints.
4. Keep the working prompt limited to the requested goal, relevant context,
   hard boundaries, and verification. Let the model choose its reasoning and
   tools unless the contract requires a deterministic process.
5. Require approval before an outward-facing or irreversible action. Verify the
   requested outcome before reporting completion.

Load browser instructions only for `browser/*` or browser-backed `qa/*` actions
by reading `manuals/browser.md`. Load host-specific setup only when the selected
contract explicitly points to it.

If the capability/action is unknown or its contract is missing, stop with an
explicit error. Do not redirect to a historical name or fabricate a workflow.
