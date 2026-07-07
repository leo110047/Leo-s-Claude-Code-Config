---
description: List and run installed Goldband Loop workflows through one selector entrypoint.
argument-hint: [workflow-name or search terms]
---

# Goldband Workflow Selector

Use this custom prompt as the single visible Codex entrypoint for Goldband Loop
workflows. The user invokes it as:

```text
/prompts:goldband
/prompts:goldband review
/prompts:goldband qa
/prompts:goldband investigate
```

Do not require the user to memorize individual workflow names, and do not look
for top-level `goldband-*` skills.

## Process

1. Resolve the active Goldband runtime root.
   - Prefer `~/.codex/skills/goldband`.
   - Fall back to `~/.claude/skills/goldband`.
   - If running inside the goldband repository, fall back to `goldband-loop`.
   - Stop with a clear message if none exists.

2. Read available workflows from:

   ```text
   <runtime-root>/workflows/*.workflow.md
   ```

   Treat these files as internal workflow documents, not discoverable top-level
   skills.

3. Build a concise workflow list.
   - Use frontmatter `name` and `description` when present.
   - Otherwise derive the name from the filename.
   - Deduplicate aliases: prefer `goldband-review` over `review` when both
     point to the same workflow file, but display the short alias in
     parentheses.
   - Put common workflows first when present:
     `review`, `qa`, `investigate`, `ship`, `plan-eng-review`,
     `design-review`, `cso`, `context-restore`.

4. If `$ARGUMENTS` is empty, `list`, or `help`:
   - Show the workflow list.
   - Ask the user to reply with a number or workflow name.
   - Stop. Do not guess a workflow.

5. If `$ARGUMENTS` is present:
   - Match it against workflow names, aliases, and descriptions.
   - If exactly one workflow matches, read that `.workflow.md` completely and
     follow it as executable workflow instructions.
   - If multiple workflows match, show the matching list and ask the user to
     reply with a number or workflow name.
   - If nothing matches, show the workflow list and ask the user to choose.

## Contract

- This prompt is a thin selector. It must not duplicate workflow logic.
- It must not expose every workflow as a top-level skill.
- It must fail clearly when Goldband Loop is not installed or no workflow files
  are present.
