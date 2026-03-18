---
name: skill-developer
description: Use when creating or editing Claude Code skills, trigger descriptions, prompt-time suggestion rules, progressive disclosure layouts, or hook-backed skill tooling in this repo.
---

# Skill Developer

## When to Use

- Creating a new skill folder under `skills/global/` or `skills/projects/`
- Refactoring a skill from markdown blob into `reference/`, `scripts/`, `assets/`, or `examples/`
- Rewriting descriptions so they describe when to trigger, not what the skill covers
- Adding or tuning prompt-time skill suggestions
- Updating installer/catalog/docs after skill inventory changes
- Verifying that a new skill is discoverable and wired correctly

## Gotchas

- Do not treat `skill-rules.json` as executable config; it is a governance/reference document, not the live trigger engine.
- Do not claim file-path or content-pattern auto-activation exists unless you actually implemented a dedicated hook for it.
- Do not add scripts, assets, or examples without surfacing them in `SKILL.md`.
- Do not leave generic tutorial prose in the entrypoint when the high-signal content belongs in `Gotchas` or `reference/`.
- Do not add prompt suggestions for a skill unless the rule is narrow enough to avoid spam and conflict churn.

## Current Architecture

### Skill Folder Shape

Every skill starts with `SKILL.md` and can add supporting files as needed:

```text
my-skill/
├── SKILL.md
├── reference/
├── scripts/
├── assets/
├── examples/
└── config.json
```

Use supporting folders only when they increase signal:
- `reference/` for detailed docs, API notes, or long examples
- `scripts/` for reusable automation or verification
- `assets/` for report templates or reusable snippets
- `examples/` for concrete input/output or debugging fixtures
- `config.json` for skill-local defaults and setup prompts

### Trigger Surfaces In This Repo

1. **Native skill description/frontmatter**
   - Claude decides whether to use the skill from `name` + `description`.
   - This is the primary trigger surface for ordinary skills.
2. **`UserPromptSubmit` suggestion hook**
   - `hooks/scripts/hooks/skill-activation-suggestions.js`
   - Rules live in `hooks/scripts/lib/skill-activation/activation-rules.js`
   - Session dedupe lives in `hooks/scripts/lib/skill-activation/session-state.js`
3. **Explicit user invocation**
   - `/skill-name`
   - direct mention in the prompt

### Hook Boundaries

- `UserPromptSubmit` is advisory only. It can suggest skills and record telemetry.
- `PreToolUse` / `PostToolUse` / `Stop` / `Notification` run through `hook-router.js`.
- Blocking behavior today is mode/policy-oriented (`careful-mode`, `freeze-mode`, secrets, dev server, doc-file guardrails), not generic per-skill enforcement.
- `SubagentStop` is a prompt hook for lightweight evidence review of subagent output.

## Recommended Workflow

1. Scaffold the folder.
   - Prefer `skills/global/new-skill-scaffold/scripts/create-skill.js`
2. Write `SKILL.md`.
   - Keep the description trigger-first.
   - Add `When to Use`, `Gotchas`, and only the minimum workflow needed at the entrypoint.
3. Move detail out of the entrypoint.
   - Put long references in `reference/`
   - Put reusable automation in `scripts/`
   - Put setup defaults in `config.json`
4. Decide whether prompt suggestions are warranted.
   - If yes, add a narrow rule to `activation-rules.js`
   - If no, rely on native skill routing and explicit invocation
5. Update repo inventory.
   - `README.md`
   - `skills/global/README.md`
   - `install.sh` profile lists if the skill is installable by default
   - `skills/global/skill-rules.json` if governance/collaboration guidance changes
6. Verify before claiming the skill is ready.
   - `node skills/global/claude-config-verification/scripts/verify-claude-config.js`
   - `node skills/global/claude-config-verification/scripts/verify-claude-config.js --router-replay` when router logic changed

## References

- [TRIGGER_TYPES.md](TRIGGER_TYPES.md) — what actually triggers skills in this repo
- [HOOK_MECHANISMS.md](HOOK_MECHANISMS.md) — current hook topology and data flow
- [PATTERNS_LIBRARY.md](PATTERNS_LIBRARY.md) — reusable prompt/description patterns
- [SKILL_RULES_REFERENCE.md](SKILL_RULES_REFERENCE.md) — meaning of `skill-rules.json`
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — debugging guide for activation and install issues
- [ADVANCED.md](ADVANCED.md) — future-facing ideas that are not wired today
