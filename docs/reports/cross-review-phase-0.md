# Cross-Review Phase 0 Report

Date: 2026-07-05

## Confirmed

- Claude Stop blocking is wired through `hooks/scripts/hooks/hook-router.js`: a policy result with `decision: "block"` exits with status `2`.
- The cross-review Stop gate is deterministic. It reads the session contract, plan marker, reviewer artifact, and review-scope hash; it does not spawn Claude, Codex, or any LLM.
- Review scope is `tracked-and-untracked-vs-base`: `git -c core.autocrlf=false diff --no-ext-diff --binary <baseCommit>` plus sorted untracked file bytes.
- The hash covers tracked unstaged changes, staged changes, untracked text, untracked binary bytes, and CRLF bytes. This is covered by `node scripts/test-cross-review.mjs`.
- The reviewer prompt uses the same bounded review scope family as the hash: tracked diff plus sorted untracked file names, sha256 values, and text content or base64 bytes.
- Reviewer and implementer must be different host families in the runtime contract and schema.
- Mock reviewer mode can write a reviewer artifact and plan marker for contract tests, but Stop rejects mock artifacts as production approval evidence.
- UserPromptSubmit trigger arming is implemented for `[[cross-review]]` and `開啟交互審查`, scoped by `session_id`.
- The local Codex CLI can produce a parseable cross-review verdict in headless mode when run with the required local app-server permissions. A real `codex` reviewer smoke produced an `APPROVED` artifact through `goldband-cross-review run --review-mode real`.
- The local Claude CLI is logged in when run with normal user keychain access. A real `claude` reviewer smoke produced an `APPROVED` artifact through `goldband-cross-review run --review-mode real`.
- A real Codex reviewer E2E produced `CHANGES_REQUESTED` for a contract-violating diff, then produced `APPROVED` after the diff was fixed.
- A real Claude reviewer accepted an implementer rebuttal from the recorded response log. Round 1 had `CR-001` open; round 2 returned `APPROVED` with `CR-001` set to `status: "rebutted-accepted"`.
- Codex Stop hard-blocking works through hook process exit code `2` with a stderr message. A live probe showed `hook: Stop Blocked`, the turn did not complete on the blocked response, and a second Stop pass completed only after the hook returned success.
- The repo-wired Codex cross-review gate now reaches the same `Stop Blocked` path in a live `codex exec` probe. The probe armed a contract from `[[cross-review]]`, left it `active`, and timed out after Codex re-entered the turn instead of finishing.
- Reaching max rounds or an `ESCALATE` verdict writes an escalation summary under `${GOLDBAND_HOME:-$HOME/.goldband}/cross-review/summaries/`; Stop human-arbitration messages include that path when available.
- Cross-review runtime telemetry records arm, round verdict, implementer response, escalation, override, and done events as v1-compatible usage events.
- `CHANGES_REQUESTED` never rewrites to `APPROVED`; malformed or missing findings for a non-approval verdict fail closed through `ESCALATE`.
- Round 2+ moving-goalpost protection still allows a new `HIGH` `regression.clear` blocker introduced by the implementer's latest fix.
- Re-sending a cross-review trigger for an already active session does not reset `roundsUsed` or `baseCommit`; it only fills a missing `planFile` when the prompt supplies one.

## Rejected

- Running a reviewer CLI from a Stop hook is rejected. The hook remains a pure check.
- Treating a plan marker alone as proof is rejected. The gate requires a matching artifact and current `reviewed-sha`.
- Claiming hash-based anti-forgery is rejected. The hash catches drift, not malicious same-permission tampering.
- Treating cross-review as a security boundary is rejected. It is an evidence gate for accidental-completion prevention and cross-model review discipline, not protection against a same-permission operator forging state or artifacts.
- Treating Codex Stop JSON output as a hard block is rejected. Live probes showed `systemMessage`, `additionalContext`, `permissionDecision: "deny"`, `decision.behavior: "deny"`, and top-level `decision: "block"` did not prevent final output; some only made the hook show `Stop Failed`.

## Fallback Decisions

- `goldband-cross-review run` defaults to `real` reviewer mode. CI and local contract tests must opt into `--review-mode mock`, and mock artifacts cannot satisfy the Stop gate.
- Codex cross-review Stop blocks use process exit `2` rather than JSON hook output. Advisory Stop checks still use `systemMessage` so they do not create completion loops.
- A permanently failing Stop hook causes Codex to keep re-entering the turn. The cross-review gate therefore exits `2` only while the session contract remains active and invalid; `override`, expiry, or a valid marker/artifact/sha lets the hook return success.
- The official Codex manual documents `Stop` as a turn-scope lifecycle hook and documents hook discovery/trust behavior, but the fetched manual section did not provide a Stop-specific JSON deny contract. The implementation relies on the empirical exit-code behavior above.
- Block messages include the installed `goldband-loop/bin/goldband-cross-review` wrapper path when available. This avoids telling Codex to run `/goldband-cross-review`, which noninteractive shell execution treats as a missing absolute path.
- Cross-review telemetry uses the existing usage-event schema with `category: "hook-decision"` and `name: "cross-review-*"`, rather than introducing a new telemetry category.
- Claude auth checks must be run with normal user keychain access. A restricted sandbox can report a false negative and must not be treated as proof that the user is logged out.
- Claude Stop handling short-circuits on `stop_hook_active` to avoid recursive Stop-hook storms; Codex hard-blocks by exiting the hook with status `2` and re-entering the turn. This means the two host interactions are enforced through different mechanics even though they share gate validation.
- If a session has no contract, the gate allows immediately. This protects unrelated sessions from false interception.

## Verification Commands

```bash
node scripts/test-cross-review.mjs
npm run test:cross-review
npm run test:hook-router -- --fixtures hooks/fixtures/router/cross-review-fixtures.json
node scripts/test-codex-hook-router.mjs
python3 scripts/check-json-toml-syntax.py
codex features list
claude auth status
claude -p --output-format text --no-session-persistence
goldband-loop/bin/goldband-cross-review run --review-mode real
codex exec --ephemeral --sandbox read-only --dangerously-bypass-hook-trust -c 'hooks.Stop=[...]'
/opt/homebrew/bin/timeout 25 codex exec --ephemeral --sandbox read-only --skip-git-repo-check -
```
