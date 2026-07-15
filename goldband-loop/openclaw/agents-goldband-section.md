## Coding Tasks (goldband)

### Dispatch Policy

Use Claude Code sessions for work that needs repository tools, file edits,
workflow runtime, or long-running verification. Do not spawn a session just
because the user mentions goldband; answer directly when the request is a
question, explanation, or small report that can be handled in the current
surface.

### Routing

- **SIMPLE:** one small, obvious change or read-only lookup.
  Use a plain `sessions_spawn(runtime: "acp", prompt: "<task>")` only if tool
  access is actually needed.
- **MEDIUM:** bounded multi-file work with a clear owner.
  Spawn with the concise task plus relevant repo path and verification target.
- **HEAVY:** the user names a Goldband capability or the work needs review, QA,
  release, investigation, design, benchmark, or system maintenance methodology.
  Spawn with `Run $goldband <capability> <action>` and the concrete task.
- **FULL:** multi-day feature or release work.
  Spawn only after the scope is clear; run planning, implementation, and release
  verification in that session.
- **PLAN:** the user wants planning without implementation.
  Spawn a planning session, save the resulting plan file, and report the file
  path and key decisions.

### Heuristic

- If current chat can answer safely, do that instead of spawning.
- If a repo path is missing and materially affects the result, ask for it.
- If the user requests a specific capability, use that capability directly.
- If the task is reversible, local, and in scope, let the spawned session work
  end to end; reserve user questions for real ambiguity, external effects, or
  irreversible actions.
