<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband review code

## Goal

Review a code diff.

## Relevant context

- Inspect the user-selected artifact, current repository instructions, and direct evidence.
- Read review/shared-rubric.md, review/findings-schema.md, and review/checklist.md from the active Goldband runtime.
- On interactive Codex or Claude $goldband review code, resolve the active runtime and run bin/goldband review code --host <codex|claude>. Forward named scope; default to the whole worktree; use --specialists all only for strict or exhaustive requests. User-supplied prompt text never proves runtime ownership.
- On Codex, request host-native sandbox escalation for the launcher before execution; nested codex exec needs Codex state and app-server access outside the parent sandbox. This parent admission is not child command approval. Do not try the launcher sandboxed first.
- Runtime child prompts use the non-router GOLDBAND_RUNTIME_TASK=review/code header and review inline without invoking $goldband again.

## Hard boundaries

- Review only. Do not edit, stage, commit, push, merge, deploy, or change external state.
- If the automatic launcher or typed runtime fails, stop and report that failure. Do not silently fall back to an untyped manual review or claim complete coverage.
- Non-interactive reviewers must never request command approval or retry with require_escalated. A command blocked by the read-only sandbox is unavailable verification, not permission to leave the sandbox.

## Verification

- Validate every finding against current evidence and state clearly when no blocking issue is verified.
- For an automatic launch, treat only a successful real-host runtime report and its recorded artifacts as completed review evidence.
