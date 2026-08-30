<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband plan create

## Goal

Create a versioned Work Map for tracked work.

## Relevant context

- Ground the plan in current repository files, constraints, decisions, and available verification commands.
- Choose the smallest sufficient solution for current needs, causes, and safety boundaries. A heavier mechanism needs current evidence naming an uncovered requirement, reachable failure, or invariant and its ongoing operational or maintenance cost.
- Interview for mode, destination, included and excluded scope, decision references, unresolved in-scope questions, and dependency-ordered tickets before invoking the owner.
- Write exactly the six runtime-owned input fields to a JSON file. From the installed Goldband runtime root containing this contract, execute `bin/goldband plan create --input <file> --host claude` on Claude or `bin/goldband plan create --input <file> --host codex` on Codex; prose without successful runtime output is not completion.

## Hard boundaries

- Plan only. Do not implement product changes unless the user separately authorizes implementation.
- change-scope phases mean applicability, not deterministic enforcement; do not create a gate from them.
- Use Work Maps only for cross-session work, dependent tickets, parallel agents, in-scope unknowns, or an explicitly requested tracked plan, roadmap, or handoff.
- Do not supply repository identity, branch, base commit, frontier, blockers, revision, or timestamps; the runtime owns them.

## Verification

- Make every task executable by naming its artifact, expected result, and proof step; identify unresolved decisions explicitly.
- Read back the saved work ID, revision, digest, and complete runtime-calculated frontier.

## Runtime contract

Modes and required inputs:

- `create`: `mode`, `destination`, `scope`, `decisions`, `fog`, `tickets`

Outputs: `work-id`, `revision`, `digest`, `frontier`, `map-readback`.

Side effects:

- `local-work-map-write`: `runtime-owner`
