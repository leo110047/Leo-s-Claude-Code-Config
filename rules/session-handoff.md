# Session Handoff and Continuity

## Baseline Policy

A session's durable output is not only the diff. Decisions, direction
reversals, and hard-won constraints must land where the next session — likely
a different or weaker model with zero context — will actually find them.
Anything that lives only in the conversation is lost when the session ends.

## Where Durable Facts Go

- Repo-scoped decisions with lasting consequences: a dated record in
  `docs/DECISIONS.md` (decision, why, implementation contract), or the repo's
  equivalent decision log.
- Cross-session task state, direction reversals, and user preferences not
  derivable from the repo: persistent memory only when host policy allows it
  and the user explicitly asks; otherwise use a repo-local handoff/report.
  Use absolute dates and omit or redact sensitive data.
- Investigations that ended without a fix: a short written record of findings
  and the next step, in a report file or authorized memory — never only in the
  conversation.
- Nothing the repo already records (git history, code structure, past fixes):
  do not duplicate it into memory or decision logs.

## Required Behavior

- Before ending a blocked or partial session, write down: what was tried,
  what is verified versus suspected, and the single next step.
- Convert relative dates ("yesterday", "next sprint") to absolute dates before
  persisting anything.
- When a new decision reverses an earlier record, update or mark the old
  record as superseded. Never leave two conflicting records live.
- Treat recalled memory as a point-in-time observation: verify that files,
  flags, or commands it names still exist before acting on them.

## Failure Signals

- The next session re-derives something this session already established.
- Two live records contradict each other.
- Memory entries restate what `git log` already shows.
