<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband browser session

## Goal

Use the persistent browser for interactive work.

## Relevant context

- Use Goldband's persistent browser runtime. On Claude, run bin/goldband browser session --host claude <command> [args...].
- On Codex CLI, do not probe Browser or Chrome plugin bindings. Read ~/.codex/skills/goldband/.workflow-launcher.json and execute its exact argvPrefix plus browser session --host codex <command> [args...]; never substitute a workspace path.
- The Codex installer owns the materialized browser client, bundled server, launcher, and exact inspection allow rules. Navigation commands are intentionally outside those automatic rules and use the host's normal approval path. Missing marker, runtime, or rule is an install failure: stop and request reinstall.

## Hard boundaries

- Do not expose credentials or private session data. Get explicit approval before submissions, purchases, messages, account changes, or cookie import.
- The typed launcher accepts only non-outward-effect browser commands. Do not bypass it with a workspace browser executable when a command is rejected.

## Verification

- Inspect the resulting page state and capture the smallest useful visual or textual evidence.
- Treat only a successful typed browser runtime result and its recorded evidence as completed browser work.
