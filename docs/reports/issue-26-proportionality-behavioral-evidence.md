# Issue #26 Proportionality Behavioral Evidence

Date: 2026-08-29 (Asia/Taipei; host event timestamps use UTC)

## Scope

This is behavioral evidence for the prompt and policy guidance introduced by
Issue #26. It is not deterministic enforcement. Each host made a read-only
planning and implementation judgment without tools in an empty temporary
working directory, so the installed global adapter was the active guidance
surface.

Before the runs, installer readback confirmed:

- `~/.claude/CLAUDE.md` points to `claude/CLAUDE.md` and contains the new
  smallest-sufficient guidance.
- `~/.codex/AGENTS.md` points to `codex/AGENTS.md` and contains the same concise
  guidance.

## Fixed Scenario Results

| Scenario | Claude decision and evidence | Codex decision and evidence |
| --- | --- | --- |
| Narrow input validation already covers the incident; proposal adds approval, state, artifact, and lineage | Chose the authoritative boundary validator plus regression test. Rejected the heavier mechanism because the demonstrated risk is input integrity, not authorization, and the added machinery would burden every import and create another decision authority. | Chose the non-empty validator at the import boundary. Rejected the heavier mechanism because no other failure path or compliance requirement was present; it would add approval, state, artifact, lineage, and troubleshooting cost to normal imports. |
| One-time wrong format; proposal adds approval to every migration and deploy | Chose deterministic format validation before execution. Rejected permanent approval because there was no recurring, concurrency, permission, or compliance evidence and normal operations would gain delay and bypass pressure. | Chose command preflight validation. Rejected permanent approval because a one-time event does not justify a second approval path and would slow unrelated migrations and deploys. |
| External GitHub publish protected by native host approval | Kept the native approval immediately before the external write. Treated the one confirmation as proportional to the outward-facing, hard-to-reverse side effect and rejected convenience as evidence for removal. | Kept the native approval boundary. Noted that the existing prompt is already the smallest sufficient mechanism and affects only the publish action, not read-only or local work. |
| Reproducible expired-lease race that caller checks cannot make atomic | Accepted a single lease owner with atomic create or compare-and-swap and bounded expiry. The barrier reproduction, mutual-exclusion invariant, and proven inability of caller checks to supply atomicity justified the heavier mechanism while keeping it scoped to lease acquisition. | Accepted the same owner and atomic acquisition design. Cited the reproducible barrier test and caller-side check limitation as direct evidence, while rejecting expansion into a generic coordination or approval platform. |

Both hosts named a direction, the smallest sufficient alternative, the current
requirement or reachable risk, the evidence for or against a heavier mechanism,
and the permanent cost or effect on unrelated normal work for all four cases.

## Run Evidence

- Claude Code completed successfully with `claude-opus-5`, session
  `471f2763-1688-41a8-a845-0b5b96b3722e`, one turn, and no tool use.
- Codex completed successfully with thread
  `01a04917-537b-76d3-b87d-e7285dcd21f1` and no command execution. It reported
  that local `approval_policy = Never` was disallowed by managed requirements
  and fell back to required `OnRequest`; this did not affect the read-only
  judgment.

The common prompt asked each host to evaluate the four required scenarios
independently and return a concrete decision, current requirement or reachable
risk, smallest sufficient option, evidence for or against a heavier permanent
mechanism, and permanent operational or maintenance cost. It explicitly
prohibited edits and tool use.
