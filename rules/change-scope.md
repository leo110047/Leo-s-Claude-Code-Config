# Change Scope: Right-Sizing Fixes

## Baseline Policy

Match the size and layer of a change to the root cause. Both failure
directions are real: symptom patches that leave the cause alive, and
opportunistic rewrites that nobody asked for. If you cannot name the cause,
you are not ready to edit; investigate first.

## Required Behavior

- Fix at the layer where the cause lives, not the layer where the symptom is
  easiest to suppress.
- Before writing a new helper, abstraction, or config flag, search for an
  existing one. Preference order: reuse, then deletion, then addition.
- Do not introduce an abstraction, option, or indirection that has a single
  call site or only hypothetical future users.
- Do not reformat, rename, or refactor code outside the task in the same
  change. Note the opportunity for the user instead of taking it.
- Delete dead code outright rather than commenting it out or keeping it "just
  in case"; version control already remembers it.
- When the minimal fix and the structurally healthy fix diverge significantly,
  present both with their costs and let the user choose. Recommend the healthy
  path by default — this environment prefers maintainable architecture and
  accepts rebuilds — but rebuild scope is always the user's decision, never a
  unilateral one.

## Failure Signals

- The diff keeps growing while the intended behavior change stays the same.
- "While I'm here" edits appear in the change.
- The fix is clever but you cannot explain it plainly.
- New configuration or flags exist that no requirement asked for.
