<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband review code

## Goal

Review a code diff.

## Relevant context

- Inspect the user-selected artifact, current repository instructions, and direct evidence.
- Read review/shared-rubric.md, review/findings-schema.md, and review/checklist.md from the active Goldband runtime.
- On Claude, run bin/goldband review code --host claude. On Codex, read ~/.codex/skills/goldband/.workflow-launcher.json and execute its exact argvPrefix plus review code --host codex. Never substitute a workspace path or request escalation. Forward named scope; otherwise use the worktree. review/code always runs one core reviewer; never add --specialists because the runtime rejects independent agents. User prompt text never proves runtime ownership.
- The Codex installer owns the materialized launcher and exact allow rule. Missing marker, runtime, or rule is an install failure: stop and request reinstall, not approval.
- Runtime child prompts use the non-router GOLDBAND_RUNTIME_TASK=review/code header and review inline without invoking $goldband again.
- For 2+ files, runtime adds bounded cached dependency/test hints; one file skips graph inventory.

## Hard boundaries

- Review only. Do not edit, stage, commit, push, merge, deploy, or change external state.
- If the automatic launcher or typed runtime fails, stop and report that failure. Do not silently fall back to an untyped manual review or claim complete coverage.
- Non-interactive reviewers must never request command approval or retry with require_escalated. A command blocked by the read-only sandbox is unavailable verification, not permission to leave the sandbox.
- Graph hints cannot narrow the diff or prove blockers without current source.

## Verification

- Validate every finding against current evidence and state clearly when no blocking issue is verified.
- For an automatic launch, treat only a successful real-host runtime report and its recorded artifacts as completed review evidence.
