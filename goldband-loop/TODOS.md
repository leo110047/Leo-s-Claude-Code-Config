# TODOS

Completed work is kept in [`docs/archive/TODOS_COMPLETED.md`](docs/archive/TODOS_COMPLETED.md).

## design daemon: follow-ups (filed v1.45.0.0 via release review)

### P3: Minor maintainability nits from release review

- `design/src/cli.ts` and `design/src/serve.ts` both have a small `openBrowser`
  helper with identical darwin/linux/else branches. Extract a shared
  `design/src/open-browser.ts`.
- `design/src/daemon-client.ts:320` (`AbortSignal.timeout(2000)`) and `:357`
  (`delay(50)`) use bare numeric literals while sibling timeouts are named
  constants. Promote to `SHUTDOWN_POST_TIMEOUT_MS` and `ALIVE_POLL_INTERVAL_MS`.
### P3: Daemon scope deferred from v1.45.0.0 plan

Originally listed in the plan's "TODOs surfaced for later" section:

- Per-daemon scoped auth tokens (only relevant once a tunnel/share use case appears).
- Optional persistent board history on disk in
  `~/.goldband/projects/$SLUG/designs/history/` so submitted boards survive
  daemon restarts.
- Windows spawn branch lifted from browse (V1 daemon is macOS + Linux;
  Windows users fall back to legacy `--no-daemon` per-process server).
- `$D board list` / `$D board stop <id>` per-board ops CLI (V1 has only
  `$D daemon status` / `stop`).
- Cross-worktree daemon attach (conductor sibling worktrees of the same
  repo currently each spawn their own daemon — matches browse; revisit
  if it causes friction).

---

## browse server: terminal-agent teardown follow-ups (filed v1.41 via /plan-eng-review)

### P3: shutdown() reads module-level `config`, not `cfg.config` (composition gap)

**What:** `browse/src/server.ts:shutdown()` reads `path.dirname(config.stateFile)`
where `config` is the module-level value resolved at import time, not the
`cfg.config` passed into `buildFetchHandler`. Same gap applies to
`cleanSingletonLocks(resolveChromiumProfile())` at server.ts:1298 — should
read `cfg.chromiumProfile`.

**Why:** Embedders today happen to share state-dir resolution with the CLI
(both go through `resolveConfig()` against the same env), so this doesn't
bite. But if an embedder ever passes a divergent `cfg.config` (e.g., a test
harness pointing at a temp dir), shutdown will operate on the wrong paths.
The `ownsTerminalAgent` flag exposes the problem without fixing it.

**Pros:** Closes the embedder-composition story properly. Pairs with
`cfg.chromiumProfile` to give a single coherent "this factory teardown
respects cfg" contract.

**Cons:** Pre-existing — not a regression. Two call sites today (1285 for
terminal files, 1298 for chromium locks). Threading `cfg.config` and
`cfg.chromiumProfile` into the right closures is straightforward but
broader than the v1.41 fix.

**Context:** Flagged by both Codex and Claude subagent in the /plan-eng-review
dual voices. Documented as out-of-scope in the v1.41 plan; same shape as the
`chromiumProfile` PR-body note to the gbrowser team.

**Depends on:** None.

---

### P3: Ownership-object refactor if a 4th caller-owned teardown gate appears

**What:** Today `ServerConfig` has three caller-owned teardown gates:
`xvfb?` (presence ⇒ don't close), `proxyBridge?` (same), and now
`ownsTerminalAgent` (explicit boolean). If a 4th gate appears, collapse to
`cfg.callerOwns?: Set<'terminalAgent' | 'xvfb' | 'proxyBridge' | ...>` or
similar.

**Why:** Three independent flags is below the refactor threshold — each
field has clear, distinct semantics and the JSDoc voice is consistent. A
fourth tips the cost balance: the per-field surface gets noisy, and
"what does this factory own?" becomes a question you have to ask of three
or four scattered fields instead of one explicit set.

**Pros:** Single source of truth for "what goldband tears down". Trivial
extension surface for future caller-owned resources. Easier to assert in
tests ("the set should contain X, not Y").

**Cons:** Premature today. The polarity-inversion note in the
`ownsTerminalAgent` JSDoc only hurts a little — it's one anomaly, not a
pattern. Refactoring now to an ownership object would touch every embedder.

**Context:** Recommended by Claude subagent during /plan-ceo-review dual
voice (autoplan). Trigger: a 4th caller-owned teardown gate in this same
`ServerConfig` shape.

**Depends on:** A 4th gate to motivate the refactor.

---

## /sync-gbrain memory stage perf follow-up

### P2: Investigate `gbrain import` perf on large staging dirs

**What:** Cold-run time on a 5131-file staging dir is >10 min in `gbrain import`
alone (after goldband's prepare phase, which is now <10s after dropping per-file
gitleaks). On 501 files it took 10s. The scaling is worse than linear and the
bottleneck is inside gbrain, not the goldband orchestrator.

**Why:** With memory-ingest's prepare phase now fast, the remaining cold-run cost
is entirely on the gbrain side. Users with large corpora (5K+ files) currently pay
~15-30 min on first ingest. Likely culprits in `~/git/gbrain/src/core/import-file.ts`:

- N+1 SQL queries: `engine.getPage(slug)` for each file's content_hash check
  (line 242 + 478) — should be batched into a single query
- Per-page auto-link reconciliation that fires even for unchanged content
- FTS / vector index updates without batching transactions

**Pros:** Lives in gbrain (cleaner separation). Fix in gbrain benefits other
gbrain callers too (`gbrain sync`, MCP `put_page` workflows). Likely 10-50x
speedup from batched queries alone.

**Cons:** Cross-repo change, requires gbrain test coverage for the new batched
path. Not on the goldband critical path; goldband's architecture is already correct.

**Context:** Verified on real corpus 2026-05-10. goldband-side prepare with
`--scan-secrets` off runs in <10s. The full gbrain import on the same staged
dir consumes 100% CPU for >10 min. Both observations from
`bin/goldband-memory-ingest.ts:ingestPass` reaching the `runGbrainImport` call
quickly, then the child process taking the bulk of the wall time.

**Depends on:** None — goldband's batch-ingest architecture (D1-D8 in
`docs/designs/SYNC_GBRAIN_BATCH_INGEST.md`) is already shipped and correct.

---

### P3: Cache "no changes since last import" at the prepare-batch level

**What:** Even with the prepare phase fast (<10s for 5135 files), walking and
mtime-stat'ing every file on a true no-op run adds a few seconds and creates
spurious staging dirs. Cache the most-recent-source-mtime per-source in the
state file; if no source dir has a newer mtime, skip the walk + stage + import
entirely.

**Why:** Most `/sync-gbrain` invocations have nothing new to ingest. The
fastest path is "do nothing, fast." `gbrain doctor` should still report state,
but the actual ingest pipeline can short-circuit when last_full_walk is recent
and no source-tree mtime has moved.

**Pros:** Trivial implementation (~20 lines in `ingestPass`). Makes the
incremental fast-path actually live up to "<30s" in the original plan.

**Cons:** Adds a cache invalidation surface. If a user edits a file but its
parent dir's mtime doesn't update (rare on macOS APFS), changes get missed.
Mitigation: only short-circuit when last_full_walk is recent (e.g. <1 min ago).

**Context:** Filed during 2026-05-10 perf testing after `--scan-secrets` was
made opt-in. Lower priority than the gbrain-side perf issue above.

---

## Browser-skills follow-on (Phases 2-4)

### P1: Browser-skills Phase 2 — `/scrape` and `/skillify` skill templates

**What:** Phase 2a of the browser-skills design (`docs/designs/BROWSER_SKILLS_V1.md`). Two new goldband skills: `/scrape <intent>` (read-only) is the single entry point for pulling page data — first call prototypes via `$B` primitives, subsequent calls on a matching intent route to a codified browser-skill in ~200ms. `/skillify` codifies the most recent successful prototype into a permanent browser-skill on disk: synthesizes `script.ts` + `script.test.ts` + fixture from the agent's own context (final-attempt $B calls only), runs the test in a temp dir, asks before committing, atomic rename to `~/.goldband/browser-skills/<name>/`. The mutating-flow sibling `/automate` is split out as its own P0 (below) — same skillify pattern, different trust profile.

**Why:** Phase 1 shipped the runtime — humans can hand-write deterministic browser scripts that goldband runs. Phase 2a unlocks the productivity gain: an agent that gets a flow right once via 20+ `$B` commands says `/skillify` and the script becomes a 200ms call forever after. Same skillify pattern the maintainer's articles describe, applied to the read-only browser activity (scraping) most amenable to deterministic compression. Mutating actions ship next as `/automate` because the failure mode (unintended writes) needs stronger gates.

**Pros:** The 100x productivity gain lives here. Closes the loop: agents prototype, codify, then reach for the codified skill in future sessions instead of re-exploring. Replaces the original "self-authoring `$B` commands" P1 — same user-visible goal, no in-daemon isolation problem (skill scripts run as standalone Bun processes, never imported into the daemon). Synthesis question (Codex finding #6) is resolved by re-prompting from the agent's own conversation context (option b in the design doc), bounded to final-attempt `$B` calls per `/plan-eng-review` D2.

**Cons:** **Bun runtime distribution** (Codex finding #7). Phase 1 sidesteps this because the bundled reference skill ships inside the goldband install. User-authored skills land on machines without Bun unless we ship a runtime alongside, compile to a self-contained binary, or use Node + the existing `cli.ts` pattern. Deferred to Phase 4 — `/skillify` documents the assumption that goldband is installed (which means Bun is on PATH).

**Context:** The Phase 1 architecture (3-tier lookup, scoped tokens, sibling SDK, frontmatter contract) is locked and exercised by the bundled `hackernews-frontpage` reference skill. Phase 2a plugs `/scrape` and `/skillify` into that runtime via two skill templates plus one new helper (`browse/src/browser-skill-write.ts` for atomic temp-dir-then-rename per `/plan-eng-review` D3) — no new storage primitives.

**Effort:** M (human: ~1 week / CC: ~1 day)
**Priority:** P1 (this branch — `project-owner/browserharness` shipping as v1.19.0.0)
**Depends on:** Phase 1 shipped (this branch).

---

### P2: Browser-skills Phase 3 — resolver injection at session start

**What:** Mirror the domain-skill resolver at `browse/src/server.ts:722-743`. When a sidebar-agent session starts on a host with matching browser-skills, inject a list block telling the agent which skills exist for that host and how to invoke them (`$B skill run <name> --arg ...`). UNTRUSTED-wrapped via the existing L1-L6 security stack. Add `goldband-config browser_skillify_prompts` knob (default `off`) controlling end-of-task nudges in `/qa`, `/design-review`, etc. when activity feed shows ≥N commands on a single host AND no skill exists yet for that host+intent.

**Why:** Without the resolver, browser-skills only work when the user explicitly types `$B skill run <name>`. With the resolver, agents auto-discover existing skills for the current host and reach for them instead of re-exploring. Same compounding pattern as domain-skills.

**Pros:** Closes the discoverability gap. Agents that wouldn't know a skill exists now see it in their system prompt automatically. End-of-task nudges (opt-in via knob) catch the moments where skillify is most valuable.

**Cons:** The resolver block lives in the system prompt and competes with other resolver blocks for prompt budget. Need to gate carefully so it doesn't fire on every host with a skill — only when the skill is plausibly relevant to the current task. v1.8.0.0 domain-skills handles this by only firing for the active tab's hostname; same pattern here.

**Effort:** S (human: ~3 days / CC: ~4 hours)
**Priority:** P2
**Depends on:** Phase 2.

---

### P2: Browser-skills Phase 4 — eval infrastructure + fixture staleness + OS sandbox

**What:** Three loosely-coupled extensions: (a) LLM-judge eval ("did the agent reach for the skill instead of re-exploring?"), classified `periodic` per `test/helpers/touchfiles.ts`. (b) Fixture-staleness detection — periodic comparison of bundled fixtures against live pages, flagging mismatches before they break tests silently. (c) OS-level FS sandbox for untrusted spawns: `sandbox-exec` profile on macOS, namespaces / seccomp on Linux. Drops in cleanly behind the existing trusted/untrusted contract (Phase 1 just stripped env; Phase 4 adds real FS isolation).

**Why:** Phase 1's trust model has the daemon-side capability boundary right (scoped tokens) but the process-side env scrub is hygiene, not a sandbox (Codex finding #1). For genuinely untrusted skills (Phase 2 agent-authored), real FS isolation matters. Eval + fixture staleness keep the skill quality bar honest as flows drift.

**Pros:** Closes the last credible attack surface from Codex finding #1 (FS read of `~/.ssh/id_rsa` etc.). Eval data tells us whether the resolver injection is actually working. Fixture staleness catches HTML drift before users.

**Cons:** Three different concerns, three different design passes. Tempting to bundle. Resist: each can ship independently. OS sandbox is the hardest piece (macOS `sandbox-exec` is Apple-private but stable; Linux requires namespaces + bind mounts).

**Effort:** L (human: ~2-3 weeks / CC: ~3-5 days)
**Priority:** P2
**Depends on:** Phase 2 (need agent-authored skills to motivate sandbox); Phase 3 (eval needs resolver injection).

---

### P2: Migrate `/learn` to SQLite

**What:** The current `~/.goldband/projects/<slug>/learnings.jsonl` storage works (append-only, tolerant parser, idle compactor) but Codex outside-voice (T5) flagged JSONL as "the wrong primitive" for multi-writer canonical state: lost-update on rewrite, partial-line corruption on crash, no transactions. v1.8.0.0 hardened JSONL with flock + O_APPEND but the right long-term primitive is SQLite (which Bun has built in via `bun:sqlite`).

**Why:** Domain skills now live in the same `learnings.jsonl` (per CEO D1 unification). As volume grows, the JSONL hardening compactor + tolerant parser approach becomes the long pole. SQLite gives atomic transactions, indexes (huge for hostname lookup), and crash-safety without a custom compactor.

**Pros:** Atomic writes. Real schema. Fast indexed lookups by hostname/key/type. Crash-safe.

**Cons:** Migration touches every consumer of `learnings.jsonl` — `/learn` scripts (`goldband-learnings-log`, `goldband-learnings-search`), domain-skills.ts read/write, gbrain-sync (which currently treats it as a flat file). Old `learnings.jsonl` files in the wild need a one-shot migration script.

**Context:** The JSONL hardening in v1.8.0.0 was the right call for that release scope (preserve unification, not high-scope). But the failure modes are bounded, not eliminated. SQLite is the high-scope fix.

**Effort:** M (human: ~1 week / CC: ~1 day)
**Priority:** P2
**Depends on:** v1.8.0.0 in production for ~1 month to measure JSONL pain (compactor frequency, partial-line drops, write contention).

---

### P2: Remove plan-mode handshake from `/plan-devex-review` SKILL.md.tmpl

**What:** `/plan-devex-review` has a "Plan Mode Handshake" section at the top that contradicts the preamble's "Skill Invocation During Plan Mode" contract (which says AskUserQuestion satisfies plan mode's end-of-turn requirement). The handshake forces an extra exit-plan-mode step that no other interactive review skill needs. `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review` all run fine in plan mode without it.

**Why:** Found during the v1.8.0.0 DevEx review. The inconsistency cost a turn and confused the flow. Either remove the handshake from `plan-devex-review` (clean fix, recommended) OR add it to every interactive skill for consistency.

**Pros:** Fixes a real DX bug for anyone running `/plan-devex-review` in plan mode. Five-minute change.

**Cons:** Need to think about WHY it was added in the first place — there may be context this TODO is missing.

**Context:** The handshake section in `plan-devex-review/SKILL.md.tmpl` says it's needed because plan mode's "this supersedes any other instructions" warning could otherwise bypass the skill's per-finding STOP gates. But the same warning exists for the other review skills, and they all work fine because AskUserQuestion satisfies the end-of-turn contract.

**Effort:** S (human: ~15 min / CC: ~5 min)
**Priority:** P2
**Depends on:** Nothing.

---

### P2: Bump gbrain install-pin in lockstep with goldband memory-feature releases (#1305 part 2)

**What:** `bin/goldband-gbrain-install` pins gbrain to commit `08b3698` (v0.18.2). When goldband ships features that depend on newer gbrain ops or schema (e.g. v1.26.0 manifests + `code-def`/`code-refs`/`reindex-code`), the pin doesn't move with it. Fresh `/setup-gbrain` installs an old gbrain that fails `gbrain doctor` schema_version checks (24 vs latest 32+) until the user manually upgrades.

**Why:** Filed in #1305 alongside the `put_page` CLI bug. Out of scope for the v1.26.5.0 fix wave (separate release-coordination concern: which gbrain version we install vs. how we call it). The install-pin should either (a) auto-bump whenever goldband releases features that need newer gbrain, or (b) detect a stale pin during preamble and either auto-upgrade gbrain or print a one-line FIX hint.

**Pros:** Closes the "fresh-install paper-cut" path. New users land on a healthy schema. Reduces support noise on `/setup-gbrain` flows. Makes the goldband/gbrain release contract visible.

**Cons:** Adds release-cadence coupling between goldband and gbrain. Needs a policy: pin = "minimum version that still works" vs "latest known good." If gbrain ships a breaking change to `put` shape and goldband doesn't update the pin, fresh installs break in a new way.

**Context:** Issue #1305 part 1 (the `put_page` CLI verb bug) was handled in v1.26.5.0. Part 2 (this TODO) is the install-pin staleness. Pin lives in `bin/goldband-gbrain-install` near the top as a constant. Easiest minimal fix: ship the pin as a tracked release artifact (e.g. write it from `package.json` at build time) and add a doctor-style preamble check.

**Effort:** S (human: ~2 days / CC: ~3 hours)
**Priority:** P2
**Depends on:** Nothing.

---

### P3: Source-id host-collision risk in `deriveCodeSourceId` (cross-host duplicate org/repo)

**What:** v1.26.5.0's `deriveCodeSourceId` drops the host segment to fit gbrain's 32-char source-id budget. This means `github.com/acme/foo` and `gitlab.com/acme/foo` collapse to the same `goldband-code-acme-foo`. `ensureSourceRegisteredSync()` in `bin/goldband-gbrain-sync.ts:323` will silently re-register the source when `local_path` differs, evicting one side.

**Why:** Vanishingly rare in practice — same `<org>/<repo>` shape across both github.com and gitlab.com on the same machine almost never happens. But the failure mode is silent (one repo evicts the other in the brain), and the user has no signal anything is wrong.

**Pros:** Closes the silent-eviction edge. Two viable approaches: short host marker (`gh-` / `gl-` / `bb-`) eats 3 chars but keeps cross-host uniqueness; OR include a 3-char hash of the host alongside the org-repo.

**Cons:** Source IDs change shape again — anyone with existing registrations on v1.26.5.0 gets a one-time re-register. Net break-even because the current scheme also changed from v1.26.4.0.

**Context:** Filed in #1320 / #1322 / #1323 / #1331 (the underlying source-id validation bugs), addressed in v1.26.5.0 by dropping host segment + hash-truncating. Cross-host collision was a known accepted tradeoff in PR #1330's design ("vanishingly rare in practice"). Codex outside-voice plan review surfaced it as a long-tail concern; this TODO captures it for a future bump.

**Effort:** XS (human: ~4 hours / CC: ~30 min)
**Priority:** P3
**Depends on:** Nothing.

---

### P3: GBrain skillpack publishing for domain skills

**What:** Domain skills are agent-authored notes per hostname. Right now they're per-machine or per-agent-repo. The natural compounding extension: publish curated skill packs to GBrain (`goldband-brain-sync`) so others can subscribe. "Louise's LinkedIn skills" or "the maintainer's GitHub skills" become packs anyone can pull.

**Why:** v1.8.0.0 gets us per-machine compounding. Cross-user compounding is the network effect — every user contributes, every user benefits.

**Pros:** Massive compounding potential. Hard part is trust/moderation (existing problem GBrain-sync has thought through).

**Cons:** Publishing infra, signature/redaction model, moderation when packs go bad. Real plan needed.

**Context:** GBrain-sync infra (v1.7.0.0) already does private cross-machine sync for the user's own data. Skillpack publishing is the public/shared layer on top of that.

**Effort:** M (human: ~1 week / CC: ~1 day)
**Priority:** P3
**Depends on:** GBrain-sync stable in production. Some user demand signal first.

---

### P3: Replay/record demonstrated flows to domain-skills

**What:** Watch a human drive a site once (record DOM events + screenshots + nav), generalize to a domain-skill. "Teach by showing." Different research dream than v1.8.0.0's per-site notes.

**Why:** The highest-quality skill content is one a human demonstrated, not one the agent figured out from scratch. Pairs with skillpack publishing — recorded flows are the most valuable packs.

**Pros:** Skill quality jumps. Some sites are too complex for an agent to figure out alone (multi-step OAuth, captcha-gated forms).

**Cons:** Record fidelity vs. selector stability over time. DOM changes break recordings. Real research needed.

**Context:** Browser-use has experimented with this. Playwright has a recorder. Codeception/Cypress recorders exist. None of them do the "generalize the recording into a markdown note" step.

**Effort:** L (human: ~2-3 weeks / CC: ~2-3 days)
**Priority:** P3
**Depends on:** Probably its own `/office-hours` session before committing eng time.

---

### P3: `$B commands review` batch-mode UX

**What:** Originally an alternative for the inline-on-first-use approval gate (DevEx D6 alternative C). Instead of approving each agent-authored command at first invocation, batch them: agent scaffolds many, human reviews `$B commands review` at a convenient time, approves/rejects in one pass.

**Why:** If self-authoring commands ever ships (the P1 above), the inline approval at first-use can interrupt the agent mid-task. Batch review is friendlier for the human.

**Pros:** Reduces interrupt frequency. Lets humans review with full context.

**Cons:** Defers approval — agent can't use the new command until the human comes back. If the agent needs the command immediately, this is worse than inline.

**Context:** Tied to the P1 above. Won't ship before that does.

**Effort:** S (human: ~half day / CC: ~30 min)
**Priority:** P3
**Depends on:** P1 self-authoring `$B` commands.

---

### P3: Heuristic command-gap watcher

**What:** Sidebar-agent watches the activity feed; when an agent repeats a similar action 3+ times (e.g., calls `$B js` with structurally similar arguments), suggest scaffolding a command. From DevEx D4 alternative C.

**Why:** Closes the discoverability loop on self-authoring commands. Agent is most likely to write a command when it just hit the same friction multiple times.

**Pros:** Surgical. Fires only when a command would have demonstrably helped. Uses real telemetry, not heuristics.

**Cons:** False positives (legitimate repeated actions) feel intrusive. Hard to design without telemetry first.

**Context:** Telemetry from v1.8.0.0 (`cdp_method_called`, `cdp_method_denied` counters) gives us the data to design this well. Don't design until we have ~1 month of production data.

**Effort:** M (human: ~1 week / CC: ~1 day)
**Priority:** P3
**Depends on:** v1.8.0.0 telemetry in production. P1 self-authoring commands.

---
## Sidebar Terminal (cc-pty-import follow-ups)

### v1.1: PTY session survives sidebar reload

**What:** Today the Terminal tab's PTY dies with the WebSocket — sidebar
reload, side-panel close, even a quick navigate-away in another tab close
the session. v1.1 should key the PTY on a tab/session id so a reload
reattaches to the existing claude process and you keep `/resume` history.

**Why:** Mid-task resilience. When you've been pair-programming with claude
for 20 minutes and an accidental Cmd-R blows it away, the cost is real.

**Pros:** Better UX, fewer interrupted sessions. **Cons:** Session-tracking
state, ghost-process risk, lifecycle bugs (when DOES the PTY actually go
away?). v1 chose the simple "PTY dies with WS" model deliberately.

**Context:** /plan-eng-review Issue 1C decision (cc-pty-import branch,
2026-04-25). v1 ships with phoenix's lifecycle. **Depends on:**
cc-pty-import landed.

**Priority:** P2 (nice-to-have).
**Effort:** M. Likely needs a per-tab session map keyed by chrome.tabs.id
plus a TTL so abandoned PTYs eventually exit.

---

### v1.1+: Audit `/health` token distribution

**What:** Codex's outside-voice review on cc-pty-import flagged that
`/health` already surfaces `AUTH_TOKEN` to any localhost caller in headed
mode (`server.ts:1657`). That's a pre-existing soft leak — anything
running on localhost gets the root token by hitting `/health`.

**Why:** cc-pty-import sidesteps it by NOT putting the PTY token there
(uses an HttpOnly cookie path instead). But the underlying leak is still
shippable surface. A second extension or a localhost web app could
currently scrape `AUTH_TOKEN` and hit any browse-server endpoint.

**Pros:** Closes a real privilege-escalation path on multi-extension
machines. **Cons:** Either we tighten the gate (Origin must be OUR
extension id, not just any chrome-extension://) or we move bootstrap
discovery off `/health` entirely. Either has migration cost for tests
and the existing extension.

**Context:** codex finding #2 on cc-pty-import plan-eng review. Not in
scope of that PR; deliberately deferred to keep PTY-import small.

**Priority:** P2.
**Effort:** M.

---

## Testing

## P2: Per-finding AskUserQuestion count assertion for /plan-ceo-review

**What:** PTY E2E test that drives /plan-ceo-review through Step 0 with a stable fixture diff containing N known findings, asserts that exactly N distinct AskUserQuestions fire (one per finding) before plan_ready.

**Why:** The skill template repeats "One issue = one AskUserQuestion call. Never combine multiple issues into one question." at every review checkpoint. No test enforces it. The current `skill-e2e-plan-ceo-plan-mode.test.ts` smoke (post-v1.21.1.0) only catches "agent skipped Step 0 entirely." Batching findings into one question slips through silently.

**Pros:** Locks in the strongest contract the skill mandates. Catches a real failure mode (the original attachment showed 2 findings batched as 0 questions).
**Cons:** Needs a stable fixture diff to keep finding count deterministic (~1 day human / ~30 min CC). Opus may reasonably consolidate two related findings, so the assertion needs a forgiving lower bound (e.g., `>= ceil(N * 0.6)`) rather than strict equality.

**Context:** The PTY harness (`runPlanSkillObservation`) returns at first terminal outcome — for V2 we need a streaming variant that counts AskUserQuestions across the whole session up to `plan_ready`. Probably a new helper alongside `runPlanSkillObservation`.

**Depends on:** Stable fixture diff (`test/fixtures/plans/multi-finding.diff` or similar) with a small known set of issues that triggers all 4 review sections.

**Priority:** P2.
**Effort:** S (CC: ~30 min once fixture exists). Captured from v1.21.1.0 plan-eng-review D2.

---

## P3: Honor env vars in goldband-config (so QUESTION_TUNING/EXPLAIN_LEVEL actually isolate tests)

**What:** `goldband-config get <key>` reads `~/.goldband/config.yaml`. `runPlanSkillObservation` plumbs `env: { QUESTION_TUNING: 'false', EXPLAIN_LEVEL: 'default' }` through to the spawned `claude` process — but the skill preamble bash uses `goldband-config get question_tuning`, which never looks at env. The env passthrough is theater on current code.

**Why:** Without env honoring, the v1.21.1.0 plan-ceo-review smoke is still flaky on machines with `question_tuning: true` set in YAML. AUTO_DECIDE preferences would skip the rendered AskUserQuestion list, masking the regression we want to catch.

**Pros:** Makes the gate test hermetic across machines. The env wiring is already in place — only `goldband-config` needs to read env first, fall back to YAML.
**Cons:** Touches the goldband-config binary across all 3 platforms (linux/darwin/windows). Cross-binary refactor.

**Context:** Captured from v1.21.1.0 adversarial review. Documented honestly in the test docstring as a known limitation.

**Priority:** P3.
**Effort:** S. Single-file edit to `bin/goldband-config` (~10 LOC for env-first lookup).

---

## P3: Path-confusion hardening on SANCTIONED_WRITE_SUBSTRINGS

**What:** `runPlanSkillObservation`'s silent-write detector uses substring matching on a few sanctioned paths (`.goldband/`, `CHANGELOG.md`, `TODOS.md`, etc). A write to `node_modules/some-pkg/CHANGELOG.md` or `src/foo/.goldband/leak.ts` is currently sanctioned because the substring matches anywhere in the path.

**Why:** Defensive — no current bug exploits this, but a malicious skill or fixture could write to a path that happens to contain `.goldband/` or `CHANGELOG.md` and slip past silent-write detection.

**Pros:** Hardens the harness against future skill misbehavior. Aligns substring rules with their intent.
**Cons:** Need to anchor against absolute prefixes (`os.homedir() + '/.goldband/'`, worktree root) which makes the test less portable across machines.

**Context:** Captured from v1.21.1.0 adversarial review (HIGH/FIXABLE finding, pre-existing). Refactored into a `SANCTIONED_WRITE_SUBSTRINGS` constant in v1.21.1.0 but the substring-includes logic is unchanged from before.

**Priority:** P3.
**Effort:** S.

---

## P1: Structural STOP-Ask forcing function across all skills

**What:** Design and implement a structural forcing function that catches when a skill mandates per-issue AskUserQuestion but the model silently substitutes batch-synthesis. Candidate mechanisms: question-count assertion (skill declares expected question count in frontmatter; post-run audit logs if model fired <N), typed question templates (skill hands the model pre-built AskUserQuestion payloads rather than prose instructions), or a canUseTool-based post-run audit that compares declared-gates-fired vs expected.

**Why:** The authoritative "Skill Invocation During Plan Mode" rule (hoisted to preamble position 1) tells the model AskUserQuestion satisfies plan mode's end-of-turn requirement. That fixes plan-mode entry, but NOT the broader class of failures: the model silently substitutes batch-synthesis for STOP-Ask loops whenever the skill's interactive contract collides with any other rule surface (auto mode, tool-count anxiety, cognitive load). Without structural enforcement, every skill with STOP-per-issue contracts remains vulnerable.

**Pros:** Catches a class-of-bug, not an instance. Applies to every skill that declares STOP gates. Builds on `canUseTool` primitive in `test/helpers/agent-sdk-runner.ts`.

**Cons:** Real design work. How does a skill declare expected question count — static value in frontmatter, or dynamic based on number of review sections that surface findings? Is the audit inline (blocking, same-turn) or post-hoc (after skill completion)? Calibration of expected-vs-actual thresholds depends on real V0 question-log data across skills.

**Context:** Relevant files — `scripts/question-registry.ts` (typed question catalog), `scripts/resolvers/question-tuning.ts` (preference classification), `bin/goldband-question-log` (event log), `bin/goldband-question-preference` (read/write preferences), `test/helpers/agent-sdk-runner.ts` (canUseTool harness). Existing question-log already captures fire events; the gap is declaring expected counts and auditing against them.

**Effort:** L (human: ~1-2 weeks / CC+goldband: ~2-3 hours for design doc + first-pass implementation).
**Priority:** P1 if interactive-skill volume is growing; P2 otherwise.
**Depends on / blocked by:** design doc — likely its own `docs/designs/STOP_ASK_ENFORCEMENT_V0.md`.
## Context skills

### `/context-save --lane` + `/context-restore --lane` for parallel workstreams

**What:** Let users save and restore per-workstream (lane) context independently. On save: `/context-save --lane A "backend refactor"` writes a lane-tagged file. Or `/context-save lanes` reads the "Parallelization Strategy" section of the most recent plan file and auto-generates one saved context per lane. On restore: `/context-restore --lane A` loads just that lane's context. Useful when a plan has 3 independent workstreams and the user wants to pick one up in each of 3 Conductor windows.

**Why:** Plans produced by `/plan-eng-review` already emit a lane table (Lane A: touches `models/` and `controllers/` sequentially; Lane B: touches `api/` independently; etc.). Right now there's no way to transfer that structure into resumable saved state. Users manually re-describe the scope in each window. Lane-tagged save/restore would be the bridge between "here's the plan" and "three people (or three AIs) are now working in parallel on it."

**Pros:** Turns `/plan-eng-review`'s parallelization output into actionable resume state. Reduces context-loss across Conductor workspace handoffs for multi-workstream plans.

**Cons:** Net-new functionality (not a port from the old `/checkpoint` skill). The "spawn new Conductor windows" part needs research into whether Conductor has a spawn CLI. Also requires lane-tagging discipline in the save step (manual or extracted).

**Context:** Source of the lane data model is `plan-eng-review/SKILL.md.tmpl:240-249` (the "Parallelization Strategy" output with Lane A/B/C dependency tables and conflict flags). Deferred from the v0.18.5.0 rename PR so the rename could land as a tight, low-risk fix. Saved files currently live at `~/.goldband/projects/$SLUG/checkpoints/YYYYMMDD-HHMMSS-<title>.md` with YAML frontmatter (branch, timestamp, etc.). The lane feature would add a `lane:` field to frontmatter and a `--lane` filter to both skills.

**Effort:** M (human: ~1-2 days / CC: ~45-60 min)
**Priority:** P3 (nice-to-have, not blocking anyone yet)
**Depends on:** `/context-save` + `/context-restore` rename stable in production (v1.0.1.0+). Research: does Conductor expose a spawn-workspace CLI?

## P0: Browser-skills Phase 2 follow-up — `/automate` skill

**What:** The mutating-flow sibling of `/scrape` (Phase 2b). `/automate <intent>` codifies form fills, click sequences, and multi-step interactions into permanent browser-skills. Reuses Phase 2a's skillify machinery (`/skillify` is shared) and the D3 atomic-write helper. Adds: per-mutating-step UNTRUSTED-wrapped summary + `AskUserQuestion` confirmation gate when running non-codified (codified skills run unattended after the initial human approval). Defaults to `trusted: false` per Phase 1 — env-scrubbed spawn, scoped-token capability, no admin scope.

**Why:** Read-only scraping is the safer wedge to validate the skillify pattern (failure mode: wrong data = benign). Mutating actions are the other half of the 100x productivity gain — agents that codify "log into example.com → click Settings → toggle X" save real time on every future session. Splitting from Phase 2a means we ship the productivity loop first, validate the architecture, then add the higher-trust surface with confidence.

**Pros:** Unlocks deterministic automation authoring without self-authoring safety concerns — Phase 1's scoped-token model applies equally to mutating skills. The codified script enumerates exactly which `$B click`/`$B fill`/`$B type` calls run; nothing else is possible at runtime. Reuses 100% of `/skillify`, the D3 helper, and the storage tier. Per-step confirmation gate surfaces the actions to the user before they run for the first time.

**Cons:** Mutating intents have higher blast radius (the wrong selector clicks "Delete Account" instead of "Delete Comment"). Phase 4 OS-level FS sandbox is a stronger answer; until then, the user trust burden is real. Confirmation-gate UX needs care — too many prompts and users hit "yes" reflexively. Mitigation: only gate first-run; after `/skillify` codifies, the skill runs unattended.

**Context:** Original Phase 2 plan in `docs/designs/BROWSER_SKILLS_V1.md` bundled `/scrape` + `/automate`. Split during the v1.19.0.0 plan review (`/plan-eng-review` on `project-owner/browserharness`) — the user's source doc framed both as primary, but in practice scraping is where users start because the failure mode is benign. Ship `/scrape` + `/skillify` first (this branch), validate the skillify pattern works, then `/automate` lands on top of the same machinery.

**Effort:** M (human: ~3-5 days / CC: ~1 day)
**Priority:** P0 (next branch after v1.19.0.0)
**Depends on:** Phase 2a (`/scrape` + `/skillify`) shipped at v1.19.0.0. The D3 atomic-write helper (`browse/src/browser-skill-write.ts`) and the bundled SDK pattern are reused as-is.

---

## P0: PACING_UPDATES_V0 — Louise's fatigue root cause (V1.1)

**What:** Implement the pacing overhaul extracted from PLAN_TUNING_V1. Full design in `docs/designs/PACING_UPDATES_V0.md`. Requires: session-state model, `phase` field in question-log schema, registry extension for dynamic findings, pacing as skill-template control flow (not preamble prose), `bin/goldband-flip-decision` command, migration-prompt budget rule, first-run preamble audit, ranking threshold calibration from real V0 data, one-way-door uncapped rule, concrete verification values.

**Why:** Louise de Sadeleer's "yes yes yes" during `/autoplan` was pacing + agency, not (only) jargon density. V1 addresses jargon (ELI10 writing). V1.1 addresses the interruption-volume half. Without this, V1 only gets halfway to the HOLY SHIT outcome.

**Pros:** End-to-end answer to Louise's feedback. Ships real calibration data from V1 usage. Completes the V0 → V2 pacing arc started in PLAN_TUNING_V0.

**Cons:** Substantial scope (10 items in `docs/designs/PACING_UPDATES_V0.md`). Needs its own CEO + Codex + DX + Eng review cycle. Calibration depends on real V0 question-log distribution.

**Context:** PLAN_TUNING_V1 attempted to bundle pacing. Three eng-review passes + two Codex passes surfaced 10 structural gaps unfixable via plan-text editing. Extracted to V1.1 as a dedicated plan.

**Depends on / blocked by:** V1 shipping (provides Louise's baseline transcript for calibration).

## Plan Tune (v2 deferrals from v0.19.0.0 rollback)

All six items are gated on v1 dogfood results and the acceptance criteria in
`docs/designs/PLAN_TUNING_V0.md`. They were explicitly deferred after Codex's
outside-voice review drove a scope rollback from the CEO EXPANSION plan. v1
ships the observational substrate only; v2 adds behavior adaptation.

### E1 — Substrate wiring (5 skills consume profile)

**What:** Add `{{PROFILE_ADAPTATION:<skill>}}` placeholder to ship, review,
office-hours, plan-ceo-review, plan-eng-review SKILL.md.tmpl files. Implement
`scripts/resolvers/profile-consumer.ts` with a per-skill adaptation registry
(`scripts/profile-adaptations/{skill}.ts`). Each consumer reads
`~/.goldband/developer-profile.json` on preamble and adapts skill-specific
defaults (verbosity, mode selection, severity thresholds, pushback intensity).

**Why:** v1 observational profile writes a file nobody reads. The substrate
claim only becomes real when skills actually consume it. Without this, /plan-tune
is a fancy config page.

**Pros:** goldband feels personal. Every skill adapts to the user's steering
style instead of defaulting to middle-of-the-road.

**Cons:** Risk of psychographic drift if profile is noisy. Requires calibrated
profile (v1 acceptance criteria: 90+ days stable across 3+ skills).

**Context:** See `docs/designs/PLAN_TUNING_V0.md` §Deferred to v2. v1 ships the
signal map + inferred computation; it's displayed in /plan-tune but no skill
reads it yet.

**Effort:** L (human: ~1 week / CC: ~4h)
**Priority:** P0
**Depends on:** 2+ weeks of v1 dogfood, profile diversity check passing.

### E3 — `/plan-tune narrative` + `/plan-tune vibe`

**What:** Event-anchored narrative ("You accepted 7 scope expansions, overrode
test_failure_triage 4 times, called every PR 'ship the complete version'") + one-word vibe
archetype (Cathedral Builder, Ship-It Pragmatist, Deep Craft, etc).
scripts/archetypes.ts is ALREADY SHIPPED in v1 (8 archetypes + Polymath
fallback). v2 work is the narrative generator + /plan-tune skill wiring.

**Why:** Makes profile tangible and shareable. Screenshot-able.

**Pros:** Killer delight feature. Social surface for goldband. Concrete, specific
output anchored in real events (not generic AI slop).

**Cons:** Requires stable inferred profile — without calibration it produces
generic paragraphs. Gen-tests need to validate no-slop.

**Context:** Archetypes already defined. Just need the /plan-tune narrative
subcommand + slop-check test.

**Effort:** S+ (human: ~1 day / CC: ~1h)
**Priority:** P0
**Depends on:** Calibrated profile (>= 20 events, 3+ skills, 7+ days span).

### E4 — Blind-spot coach

**What:** Preamble injection that surfaces the OPPOSITE of the user's profile
once per session per tier >= 2 skill. High-scope user gets challenged on
scope ("what's the 80% version?"); small-scope user gets challenged on ambition.
`scripts/resolvers/blind-spot-coach.ts`. Marker file for session dedup. Opt-out
via `goldband-config set blind_spot_coach false`.

**Why:** Makes goldband a coach (challenges you) instead of a mirror (reflects
you). The killer differentiation vs. a settings menu.

**Pros:** The feature that makes goldband feel distinct. Surfaces assumptions
the user hasn't challenged.

**Cons:** Logically conflicts with E1 (which adapts TO profile) and E6 (which
flags mismatch). Requires interaction-budget design: global session budget +
escalation rules + explicit exclusion from mismatch detection. Risk of feeling
like a nag if fires wrong.

**Context:** v2 must redesign to resolve the E1/E4/E6 composition issue Codex
caught. Dogfood required to calibrate frequency.

**Effort:** M (human: ~3 days / CC: ~2h design + ~1h impl)
**Priority:** P0
**Depends on:** E1 shipped + interaction-budget design spec.

### E5 — LANDED celebration HTML page

**What:** When a PR authored by the user is newly merged to the base branch,
open an animated HTML celebration page in the browser. Confetti + typewriter
headline + stats counter. Shows: what we built (PR stats + CHANGELOG entry),
road traveled (scope decisions from CEO plan), road not traveled (deferred
items), where we're going (next TODOs), who you are as a builder (vibe +
narrative + profile delta for this ship). Self-contained HTML (CSS animations
only, no JS deps).

**CRITICAL REVISION from v0 plan:** Passive detection must NOT live in the
preamble (Codex #9). When promoted, moves to explicit `/plan-tune show-landed`
OR post-ship hook — not passive detection in the hot path.

**Why:** Biggest personality moment in goldband. The "one-word thing that makes
you remember why you built this."

**Pros:** Screenshot-worthy. Shareable. The kind of dopamine hit that turns
power users into evangelists.

**Cons:** Product theater if the substrate isn't solid. Needs /design-shotgun
→ /design-html for the visual direction. Requires E2 unified profile for
narrative/vibe data.

**Context:** /land-and-deploy trust/adoption is low, so passive detection is
the right trigger shape. Dedup marker per PR in `~/.goldband/.landed-celebrated-*`.
E2E tests for squash/merge-commit/rebase/co-author/fresh-clone/dedup variants.

**Effort:** M+ (human: ~1 week / CC: ~3h total)
**Priority:** P0
**Depends on:** E3 narrative/vibe shipped. /design-shotgun run on real PR data
to pick a visual direction, then /design-html to finalize.

### E6 — Auto-adjustment based on declared ↔ inferred mismatch

**What:** Currently `/plan-tune` shows the gap between declared and inferred
(v1 observational). v2 auto-suggests declaration updates when the gap exceeds
a threshold ("Your profile says hands-off but you've overridden 40% of
recommendations — you're actually taste-driven. Update declared autonomy from
0.8 to 0.5?"). Requires explicit user confirmation before any mutation (Codex
trust-boundary #15 already baked into v1).

**Why:** Profile drifts silently without correction. Self-correcting profile
stays honest.

**Pros:** Profile becomes more accurate over time. User sees the gap and
decides.

**Cons:** Requires stable inferred profile (diversity check). False positives
nag the user.

**Context:** v1 has `--check-mismatch` that flags > 0.3 gaps but doesn't
suggest fixes. v2 adds the suggestion UX + per-dimension threshold tuning from
real data.

**Effort:** S (human: ~1 day / CC: ~45min)
**Priority:** P0
**Depends on:** Calibrated profile + real mismatch data from v1 dogfood.

### E7 — Psychographic auto-decide

**What:** When inferred profile is calibrated AND a question is two-way AND
the user's dimensions strongly favor one option, auto-choose without asking
(visible annotation: "Auto-decided via profile. Change with /plan-tune."). v1
only auto-decides via EXPLICIT per-question preferences; v2 adds profile-driven
auto-decide.

**Why:** The whole point of the psychographic. Silent, correct defaults based
on who the user IS, not just what they've said.

**Pros:** Friction-free skill invocation for calibrated power users. Over time,
goldband feels like it's reading your mind.

**Cons:** Highest-risk deferral. Wrong auto-decides are costly. Requires very
high confidence in the signal map AND calibration gate.

**Context:** v1 diversity gate is `sample_size >= 20 AND skills_covered >= 3
AND question_ids_covered >= 8 AND days_span >= 7`. v2 must prove this gate
actually catches noisy profiles before shipping.

**Effort:** M (human: ~3 days / CC: ~2h)
**Priority:** P0
**Depends on:** E1 (skills consuming profile) + real observed data showing
calibration gate is trustworthy.

## Browse

### Scope sidebar-agent kill to session PID, not `pkill -f sidebar-agent\.ts`

**What:** `shutdown()` in `browse/src/server.ts:1193` uses `pkill -f sidebar-agent\.ts` to kill the sidebar-agent daemon, which matches every sidebar-agent on the machine, not just the one this server spawned. Replace with PID tracking: store the sidebar-agent PID when `cli.ts` spawns it (via state file or env), then `process.kill(pid, 'SIGTERM')` in `shutdown()`.

**Why:** A user running two Conductor worktrees (or any multi-session setup), each with its own `$B connect`, closes one browser window ... and the other worktree's sidebar-agent gets killed too. The blast radius was there before, but the v0.18.1.0 disconnect-cleanup fix makes it more reachable: every user-close now runs the full `shutdown()` path, whereas before user-close bypassed it.

**Context:** Surfaced by the v0.18.1.0 release review. Pre-existing code, not introduced by the fix. Fix requires propagating the sidebar-agent PID from `cli.ts` spawn site (~line 885) into the server's state file so `shutdown()` can target just this session's agent. Related: `browse/src/cli.ts` spawns with `Bun.spawn(...).unref()` and already captures `agentProc.pid`.

**Effort:** S (human: ~2h / CC: ~15min)
**Priority:** P2
**Depends on:** None

## Sidebar Security

### ML Prompt Injection Classifier — v2 Follow-ups

#### Cache review decisions per (domain, payload-hash-prefix) (P1)

**What:** If Haiku fires on a page twice in the same session (e.g., user does Bash then Grep on the same suspicious file), the second fire shouldn't re-prompt. Cache the user's decision keyed by a per-session (domain, payloadHash-prefix) pair. Small LRU, ~100 entries, session-scoped (not persistent across sidebar restarts — we want fresh decisions on new sessions).

**Why:** Reduces review-banner fatigue when the same bit of sketchy content gets scanned multiple times via different tools. At 44% FP on v1, this matters most.

**Effort:** S (human: ~0.5 day / CC: ~20 min)
**Priority:** P1

#### Fine-tune a small classifier on BrowseSafe-Bench + Qualifire + xxz224 (P2 research)

**What:** TestSavantAI was trained on direct-injection text, wrong distribution for browser-agent attacks (measured 15% recall). Take BERT-base, fine-tune on BrowseSafe-Bench (3,680 cases) + Qualifire prompt-injection-benchmark (5k) + xxz224 (3.7k) combined, ship in ~/.goldband/models/ as replacement L4 classifier.

**Why:** Expected 15% → 70%+ recall on the actual threat distribution without needing Haiku. Would also cut latency (no CLI subprocess) and drop Haiku cost.

**Effort:** XL (human: ~3-5 days + ~$50 GPU / CC: ~4-6 hours setup + ~$50 GPU)
**Priority:** P2 research — validate the lift on a held-out test set before committing to replace TestSavant

#### DeBERTa-v3 ensemble as default (P2)

**What:** Flip `GOLDBAND_SECURITY_ENSEMBLE=deberta` from opt-in to default. Adds a 3rd ML vote; 2-of-3 agreement rule should reduce FPs while catching attacks that only DeBERTa sees.

**Why:** More votes = better calibration. Currently opt-in because 721MB is a big first-run download; flipping to default requires lazy-download UX.

**Cons:** 721MB first-run download for every user. Costs user bandwidth + disk.

**Effort:** M (human: ~2 days / CC: ~1 hour + UX)
**Priority:** P2 (after #1 tuning to see how much room is left)

#### User-feedback flywheel — decisions become training data (P3)

**What:** Every Allow/Block click is labeled data. Log (suspected_text hash, layer scores, user decision, ts) to ~/.goldband/security/feedback.jsonl. Aggregate via community-pulse when `telemetry: community`. Periodically retrain the classifier on aggregate feedback.

**Why:** The system gets better the more it's used. Closes the loop between user reality and defense quality.

**Cons:** Feedback loop can be poisoned if attacker controls enough devices. Need guardrails (stratified sampling, reviewer validation, k-anon minimums on training batch).

**Effort:** L (human: ~1 week for local logging + aggregation pipe, another week for retrain cron / CC: ~2-4 hours per sub-part)
**Priority:** P3 — only worth building after v2 tuning proves the architecture is the right shape


#### Full BrowseSafe-Bench at gate tier (P2)

**What:** Promote `browse/test/security-bench.test.ts` from smoke-200 (gate) to full-3680
(gate) once smoke/full detection rate correlation is measured (~2 weeks post-ship).

**Why:** BrowseSafe-Bench is Perplexity's 3,680-case browser-agent injection benchmark.
Smoke-200 is a sample; full coverage catches the long tail. Run time ~5min hermetic.

**Effort:** S (CC: ~45min)
**Priority:** P2
**Depends on:** v1 shipped + ~2 weeks real data

#### ~~Cross-user aggregate attack dashboard (P2)~~ — CLI SHIPPED, web UI remains

CLI dashboard shipped in commits a5588ec0 (schema migration) + 2d107978
(community-pulse edge function security aggregation) + 756875a7 (bin/goldband-
security-dashboard). Users can now run `goldband-security-dashboard` to see
attacks last 7 days, top attacked domains, detection-layer distribution,
and verdict counts — all aggregated from the Supabase community-pulse pipe.

Web UI at goldband.gg/dashboard/security is still open — that's a separate
webapp project outside this repo's scope.

#### Bun-native 5ms inference (P3 research) — SKELETON SHIPPED, forward pass open

Research skeleton landed this round (browse/src/security-bunnative.ts,
docs/designs/BUN_NATIVE_INFERENCE.md, browse/test/security-bunnative.test.ts):

  * Pure-TS WordPiece tokenizer — reads HF tokenizer.json directly, matches
    transformers.js output on fixture strings (correctness-tested in CI)
  * Stable `classify()` API that current callers can wire against today
  * Benchmark harness with p50/p95/p99 reporting — anchors v1 WASM baseline
    for future regressions

Design doc captures the roadmap:
  * Approach A: pure-TS + Float32Array SIMD — ruled out (can't beat WASM)
  * Approach B: Bun FFI + Apple Accelerate cblas_sgemm — target ~3-6ms p50,
    macOS-only, ~1000 LOC
  * Approach C: Bun WebGPU — unexplored, worth a spike

Remaining work (XL, multi-week):
  * FFI proof-of-concept for cblas_sgemm
  * Single transformer layer implementation + correctness check vs onnxruntime
  * Full forward pass + weight loader + correctness regression fixtures
  * Production swap in security-bunnative.ts `classify()` body

## Builder Ethos

### First-time Search Before Building intro

**What:** Add a `generateSearchIntro()` function (like `generateLakeIntro()`) that introduces the Search Before Building principle on first use, with a link to the blog essay.

**Why:** Completeness Principle has an intro flow that links to the essay and marks `.completeness-intro-seen`. Search Before Building should have the same pattern for discoverability.

**Context:** Blocked on a blog post to link to. When the essay exists, add the intro flow with a `.search-intro-seen` marker file. Pattern: `generateLakeIntro()` at gen-skill-docs.ts:176.

**Effort:** S
**Priority:** P2
**Depends on:** Blog post about Search Before Building

## Chrome DevTools MCP Integration

### Real Chrome session access

**What:** Integrate Chrome DevTools MCP to connect to the user's real Chrome session with real cookies, real state, no Playwright middleman.

**Why:** Right now, headed mode launches a fresh Chromium profile. Users must log in manually or import cookies. Chrome DevTools MCP connects to the user's actual Chrome ... instant access to every authenticated site. This is the future of browser automation for AI agents.

**Context:** Google shipped Chrome DevTools MCP in Chrome 146+ (June 2025). It provides screenshots, console messages, performance traces, Lighthouse audits, and full page interaction through the user's real browser. goldband should use it for real-session access while keeping Playwright for headless CI/testing workflows.

Potential new skills:
- `/debug-browser`: JS error tracing with source-mapped stack traces
- `/perf-debug`: performance traces, Core Web Vitals, network waterfall

May replace `/setup-browser-cookies` for most use cases since the user's real cookies are already there.

**Effort:** L (human: ~2 weeks / CC: ~2 hours)
**Priority:** P0
**Depends on:** Chrome 146+, DevTools MCP server installed

## Browse

### Bundle server.ts into compiled binary

**What:** Eliminate `resolveServerScript()` fallback chain entirely — bundle server.ts into the compiled browse binary.

**Why:** The current fallback chain (check adjacent to cli.ts, check global install) is fragile and caused bugs in v0.3.2. A single compiled binary is simpler and more reliable.

**Context:** Bun's `--compile` flag can bundle multiple entry points. The server is currently resolved at runtime via file path lookup. Bundling it removes the resolution step entirely.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Sessions (isolated browser instances)

**What:** Isolated browser instances with separate cookies/storage/history, addressable by name.

**Why:** Enables parallel testing of different user roles, A/B test verification, and clean auth state management.

**Context:** Requires Playwright browser context isolation. Each session gets its own context with independent cookies/localStorage. Prerequisite for video recording (clean context lifecycle) and auth vault.

**Effort:** L
**Priority:** P3

### Video recording

**What:** Record browser interactions as video (start/stop controls).

**Why:** Video evidence in QA reports and PR bodies. Currently deferred because `recreateContext()` destroys page state.

**Context:** Needs sessions for clean context lifecycle. Playwright supports video recording per context. Also needs WebM → GIF conversion for PR embedding.

**Effort:** M
**Priority:** P3
**Depends on:** Sessions

### v20 encryption format support

**What:** AES-256-GCM support for future Chromium cookie DB versions (currently v10).

**Why:** Future Chromium versions may change encryption format. Proactive support prevents breakage.

**Effort:** S
**Priority:** P3

### Auth vault

**What:** Encrypted credential storage, referenced by name. LLM never sees passwords.

**Why:** Security — currently auth credentials flow through the LLM context. Vault keeps secrets out of the AI's view.

**Effort:** L
**Priority:** P3
**Depends on:** Sessions, state persistence

### Semantic locators

**What:** `find role/label/text/placeholder/testid` with attached actions.

**Why:** More resilient element selection than CSS selectors or ref numbers.

**Effort:** M
**Priority:** P4

### Device emulation presets

**What:** `set device "iPhone 16 Pro"` for mobile/tablet testing.

**Why:** Responsive layout testing without manual viewport resizing.

**Effort:** S
**Priority:** P4

### Network mocking/routing

**What:** Intercept, block, and mock network requests.

**Why:** Test error states, loading states, and offline behavior.

**Effort:** M
**Priority:** P4

### Download handling

**What:** Click-to-download with path control.

**Why:** Test file download flows end-to-end.

**Effort:** S
**Priority:** P4

### Content safety

**What:** `--max-output` truncation, `--allowed-domains` filtering.

**Why:** Prevent context window overflow and restrict navigation to safe domains.

**Effort:** S
**Priority:** P4

### Streaming (WebSocket live preview)

**What:** WebSocket-based live preview for pair browsing sessions.

**Why:** Enables real-time collaboration — human watches AI browse.

**Effort:** L
**Priority:** P4

### Multi-agent tab isolation

**What:** Two Claude sessions connect to the same browser, each operating on different tabs. No cross-contamination.

**Why:** Enables parallel /qa + /design-review on different tabs in the same browser.

**Context:** Requires tab ownership model for concurrent headed connections. Playwright may not cleanly support two persistent contexts. Needs investigation.

**Effort:** L (human: ~2 weeks / CC: ~2 hours)
**Priority:** P3
**Depends on:** Headed mode (shipped)

### Sidebar direct API calls (eliminate claude -p startup tax)

**What:** Each sidebar message spawns a fresh `claude -p` process (~2-3s cold start overhead). For "click @e24" that's absurd. Direct Anthropic API calls would be sub-second.

**Why:** The `claude -p` startup cost is: process spawn (~100ms) + CLI init (~500ms-1s) + API connection (~200ms) + first token. Model routing (Sonnet for actions) helps but doesn't fix the CLI overhead.

**Context:** `server.ts:spawnClaude()` builds args and writes to queue file. `sidebar-agent.ts:askClaude()` spawns `claude -p`. Replace with direct `fetch('https://api.anthropic.com/...')` with tool use. Requires `ANTHROPIC_API_KEY` accessible to the browse server.

**Effort:** M (human: ~1 week / CC: ~30min)
**Priority:** P2
**Depends on:** None

### Chrome Web Store publishing

**What:** Publish the goldband browse Chrome extension to Chrome Web Store for easier install.

**Why:** Currently sideloaded via chrome://extensions. Web Store makes install one-click.

**Effort:** S
**Priority:** P4
**Depends on:** Chrome extension proving value via sideloading

### Linux cookie decryption — PARTIALLY SHIPPED

~~**What:** GNOME Keyring / kwallet / DPAPI support for non-macOS cookie import.~~

Linux cookie import shipped in v0.11.11.0 (Wave 3). Supports Chrome, Chromium, Brave, Edge on Linux with GNOME Keyring (libsecret) and "peanuts" fallback. Windows DPAPI support remains deferred.

**Remaining:** Windows cookie decryption (DPAPI). Needs complete rewrite — PR #64 was 1346 lines and stale.

**Effort:** L (Windows only)
**Priority:** P4
**Completed (Linux):** v0.11.11.0 (2026-03-23)

## Release

### GitLab support for `$goldband release land`

**What:** Add GitLab MR merge + CI polling support to the release workflow. The current implementation uses GitHub-specific `gh` operations and needs an explicit `glab` adapter.

**Why:** GitLab users need the same merge, deploy, and verification outcome without reviving a separate shipping workflow.

**Effort:** L
**Priority:** P2
**Depends on:** None

## Review

### Inline PR annotations

**What:** Review and release actions post inline review comments at specific file:line locations using `gh api` to create pull request review comments.

**Why:** Line-level annotations are more actionable than top-level comments. The PR thread becomes a line-by-line conversation between Greptile, Claude, and human reviewers.

**Context:** GitHub supports inline review comments via `gh api repos/$REPO/pulls/$PR/reviews`. Pairs naturally with Phase 3.6 visual annotations.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Greptile training feedback export

**What:** Aggregate greptile-history.md into machine-readable JSON summary of false positive patterns, exportable to the Greptile team for model improvement.

**Why:** Closes the feedback loop — Greptile can use FP data to stop making the same mistakes on your codebase.

**Context:** Was a P3 Future Idea. Upgraded to P2 now that greptile-history.md data infrastructure exists. The signal data is already being collected; this just makes it exportable. ~40 lines.

**Effort:** S
**Priority:** P2
**Depends on:** Enough FP data accumulated (10+ entries)

### Visual review with annotated screenshots

**What:** /review Step 4.5: browse PR's preview deploy, annotated screenshots of changed pages, compare against production, check responsive layouts, verify accessibility tree.

**Why:** Visual diff catches layout regressions that code review misses.

**Context:** Part of Phase 3.6. Needs S3 upload for image hosting.

**Effort:** M
**Priority:** P2
**Depends on:** /setup-goldband-upload

## QA

### QA trend tracking

**What:** Compare baseline.json over time, detect regressions across QA runs.

**Why:** Spot quality trends — is the app getting better or worse?

**Context:** QA already writes structured reports. This adds cross-run comparison.

**Effort:** S
**Priority:** P2

### CI/CD QA integration

**What:** `/qa` as GitHub Action step, fail PR if health score drops.

**Why:** Automated quality gate in CI. Catch regressions before merge.

**Effort:** M
**Priority:** P2

### Smart default QA tier

**What:** After a few runs, check index.md for user's usual tier pick, skip the AskUserQuestion.

**Why:** Reduces friction for repeat users.

**Effort:** S
**Priority:** P2

### Accessibility audit mode

**What:** `--a11y` flag for focused accessibility testing.

**Why:** Dedicated accessibility testing beyond the general QA checklist.

**Effort:** S
**Priority:** P3

### CI/CD generation for non-GitHub providers

**What:** Extend CI/CD bootstrap to generate GitLab CI (`.gitlab-ci.yml`), CircleCI (`.circleci/config.yml`), and Bitrise pipelines.

**Why:** Not all projects use GitHub Actions. Universal CI/CD bootstrap would make test bootstrap work for everyone.

**Context:** v1 ships with GitHub Actions only. Detection logic already checks for `.gitlab-ci.yml`, `.circleci/`, `bitrise.yml` and skips with an informational note. Each provider needs ~20 lines of template text in `generateTestBootstrap()`.

**Effort:** M
**Priority:** P3
**Depends on:** Test bootstrap (shipped)

### Auto-upgrade weak tests (★) to strong tests (★★★)

**What:** When Step 7 coverage audit identifies existing ★-rated tests (smoke/trivial assertions), generate improved versions testing edge cases and error paths.

**Why:** Many codebases have tests that technically exist but don't catch real bugs — `expect(component).toBeDefined()` isn't testing behavior. Upgrading these closes the gap between "has tests" and "has good tests."

**Context:** Requires the quality scoring rubric from the test coverage audit. Modifying existing test files is riskier than creating new ones — needs careful diffing to ensure the upgraded test still passes. Consider creating a companion test file rather than modifying the original.

**Effort:** M
**Priority:** P3
**Depends on:** Test quality scoring (shipped)

## Retro

### Deployment health tracking (retro + browse)

**What:** Screenshot production state, check perf metrics (page load times), count console errors across key pages, track trends over retro window.

**Why:** Retro should include production health alongside code metrics.

**Context:** Requires browse integration. Screenshots + metrics fed into retro output.

**Effort:** L
**Priority:** P3
**Depends on:** Browse sessions

## Infrastructure

### /setup-goldband-upload skill (S3 bucket)

**What:** Configure S3 bucket for image hosting. One-time setup for visual PR annotations.

**Why:** Prerequisite for visual PR annotations in review and release actions.

**Effort:** M
**Priority:** P2

### goldband-upload helper

**What:** `browse/bin/goldband-upload` — upload file to S3, return public URL.

**Why:** Shared utility for all skills that need to embed images in PRs.

**Effort:** S
**Priority:** P2
**Depends on:** /setup-goldband-upload

### WebM to GIF conversion

**What:** ffmpeg-based WebM → GIF conversion for video evidence in PRs.

**Why:** GitHub PR bodies render GIFs but not WebM. Needed for video recording evidence.

**Effort:** S
**Priority:** P3
**Depends on:** Video recording



### Extend worktree isolation to Claude E2E tests

**What:** Add `useWorktree?: boolean` option to `runSkillTest()` so any Claude E2E test can opt into worktree mode for full repo context instead of tmpdir fixtures.

**Why:** Some Claude E2E tests (CSO audit, review-sql-injection) create minimal fake repos but would produce more realistic results with full repo context. The infrastructure exists (`describeWithWorktree()` in e2e-helpers.ts) — this extends it to the session-runner level.

**Context:** WorktreeManager shipped in v0.11.12.0. Currently only Gemini/Codex tests use worktrees. Claude tests use planted-bug fixture repos which are correct for their purpose, but new tests that want real repo context can use `describeWithWorktree()` today. This TODO is about making it even easier via a flag on `runSkillTest()`.

**Effort:** M (human: ~2 days / CC: ~20 min)
**Priority:** P3
**Depends on:** Worktree isolation (shipped v0.11.12.0)

### Eval web dashboard

**What:** `bun run eval:dashboard` serves local HTML with charts: cost trending, detection rate, pass/fail history.

**Why:** Visual charts better for spotting trends than CLI tools.

**Context:** Reads `~/.goldband-dev/evals/*.json`. ~200 lines HTML + chart.js via Bun HTTP server.

**Effort:** M
**Priority:** P3
**Depends on:** Eval persistence (shipped in v0.3.6)

### CI/CD QA quality gate

**What:** Run `/qa` as a GitHub Action step, fail PR if health score drops below threshold.

**Why:** Automated quality gate catches regressions before merge. Currently QA is manual — CI integration makes it part of the standard workflow.

**Context:** Requires headless browse binary available in CI. The `/qa` skill already produces `baseline.json` with health scores — CI step would compare against the main branch baseline and fail if score drops. Would need `ANTHROPIC_API_KEY` in CI secrets since `/qa` uses Claude.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Cross-platform URL open helper

**What:** `goldband-open-url` helper script — detect platform, use `open` (macOS) or `xdg-open` (Linux).

**Why:** The first-time Completeness Principle intro uses macOS `open` to launch the essay. If goldband ever supports Linux, this silently fails.

**Effort:** S (human: ~30 min / CC: ~2 min)
**Priority:** P4
**Depends on:** Nothing

### CDP-based DOM mutation detection for ref staleness

**What:** Use Chrome DevTools Protocol `DOM.documentUpdated` / MutationObserver events to proactively invalidate stale refs when the DOM changes, without requiring an explicit `snapshot` call.

**Why:** Current ref staleness detection (async count() check) only catches stale refs at action time. CDP mutation detection would proactively warn when refs become stale, preventing the 5-second timeout entirely for SPA re-renders.

**Context:** Parts 1+2 of ref staleness fix (RefEntry metadata + eager validation via count()) are shipped. This is Part 3 — the most ambitious piece. Requires CDP session alongside Playwright, MutationObserver bridge, and careful performance tuning to avoid overhead on every DOM change.

**Effort:** L
**Priority:** P3
**Depends on:** Ref staleness Parts 1+2 (shipped)

## Office Hours / Design

### Design docs → Supabase team store sync

**What:** Add design docs (`*-design-*.md`) to the Supabase sync pipeline alongside test plans, retro snapshots, and QA reports.

**Why:** Cross-team design discovery at scale. Local `~/.goldband/projects/$SLUG/` keyword-grep discovery works for same-machine users now, but Supabase sync makes it work across the whole team. Duplicate ideas surface, everyone sees what's been explored.

**Context:** /office-hours writes design docs to `~/.goldband/projects/$SLUG/`. The team store already syncs test plans, retro snapshots, QA reports. Design docs follow the same pattern — just add a sync adapter.

**Effort:** S
**Priority:** P2
**Depends on:** `project-owner/team-supabase-store` branch landing on main

### /yc-prep skill

**What:** Skill that helps founders prepare their YC application after /office-hours identifies strong signal. Pulls from the design doc, structures answers to YC app questions, runs a mock interview.

**Why:** Closes the loop. /office-hours identifies the founder, /yc-prep helps them apply well. The design doc already contains most of the raw material for a YC application.

**Effort:** M (human: ~2 weeks / CC: ~2 hours)
**Priority:** P2
**Depends on:** office-hours founder discovery engine shipping first

## Design Review

### Design outside voices in /plan-eng-review

**What:** Extend the parallel dual-voice pattern (Codex + Claude subagent) to /plan-eng-review's architecture review section.

**Why:** The design beachhead (v0.11.3.0) proves cross-model consensus works for subjective reviews. Architecture reviews have similar subjectivity in tradeoff decisions.

**Context:** Depends on learnings from the design beachhead. If the litmus scorecard format proves useful, adapt it for architecture dimensions (coupling, scaling, reversibility).

**Effort:** S
**Priority:** P3
**Depends on:** Design outside voices shipped (v0.11.3.0)

### Outside voices in /qa visual regression detection

**What:** Add Codex design voice to /qa for detecting visual regressions during bug-fix verification.

**Why:** When fixing bugs, the fix can introduce visual regressions that code-level checks miss. Codex could flag "the fix broke the responsive layout" during re-test.

**Context:** Depends on /qa having design awareness. Currently /qa focuses on functional testing.

**Effort:** M
**Priority:** P3
**Depends on:** Design outside voices shipped (v0.11.3.0)

## Document-Release

### `{{DOC_VOICE}}` shared resolver

**What:** Create a placeholder resolver in gen-skill-docs.ts encoding the goldband voice guide (friendly, user-forward, lead with benefits). Inject into release documentation and reference from CLAUDE.md.

**Why:** DRY — voice rules currently live inline in multiple release documentation surfaces. When the voice evolves, they drift.

**Context:** Same pattern as `{{QA_METHODOLOGY}}` — shared block injected into multiple templates to prevent drift. ~20 lines in gen-skill-docs.ts.

**Effort:** S
**Priority:** P2
**Depends on:** None

## Ship Confidence Dashboard

### Smart review relevance detection — PARTIALLY SHIPPED

~~**What:** Auto-detect which of the 4 reviews are relevant based on branch changes (skip Design Review if no CSS/view changes, skip Code Review if plan-only).~~

`bin/goldband-diff-scope` shipped — categorizes diff into SCOPE_FRONTEND, SCOPE_BACKEND, SCOPE_PROMPTS, SCOPE_TESTS, SCOPE_DOCS, SCOPE_CONFIG. Used by design-review-lite to skip when no frontend files changed. Dashboard integration for conditional row display is a follow-up.

**Remaining:** Dashboard conditional row display (hide "Design Review: NOT YET RUN" when SCOPE_FRONTEND=false). Extend to Eng Review (skip for docs-only) and CEO Review (skip for config-only).

**Effort:** S
**Priority:** P3
**Depends on:** goldband-diff-scope (shipped)


## Codex

### Codex→Claude reverse buddy check skill

**What:** A Codex-native skill (`.agents/skills/goldband-claude/SKILL.md`) that runs `claude -p` to get an independent second opinion from Claude — the reverse of what `/codex` does today from Claude Code.

**Why:** Codex users deserve the same cross-model challenge that Claude users get via `/codex`. Currently the flow is one-way (Claude→Codex). Codex users have no way to get a Claude second opinion.

**Context:** The `/codex` skill template (`codex/SKILL.md.tmpl`) shows the pattern — it wraps `codex exec` with JSONL parsing, timeout handling, and structured output. The reverse skill would wrap `claude -p` with similar infrastructure. Would be generated into `.agents/skills/goldband-claude/` by `gen-skill-docs --host codex`.

**Effort:** M (human: ~2 weeks / CC: ~30 min)
**Priority:** P1
**Depends on:** None

## Completeness

### Completeness metrics dashboard

**What:** Track how often Claude chooses the complete option vs shortcut across goldband sessions. Aggregate into a dashboard showing completeness trend over time.

**Why:** Without measurement, we can't know if the Completeness Principle is working. Could surface patterns (e.g., certain skills still bias toward shortcuts).

**Context:** Would require logging choices (e.g., append to a JSONL file when AskUserQuestion resolves), parsing them, and displaying trends. Similar pattern to eval persistence.

**Effort:** M (human) / S (CC)
**Priority:** P3
**Depends on:** Completeness Principle shipped (v0.6.1)

## Safety & Observability

### /investigate scoped debugging enhancements (gated on telemetry)

**What:** Six enhancements to /investigate auto-freeze, contingent on telemetry showing the freeze hook actually fires in real debugging sessions.

**Why:** /investigate v0.7.1 auto-freezes edits to the module being debugged. If telemetry shows the hook fires often, these enhancements make the experience smarter. If it never fires, the problem wasn't real and these aren't worth building.

**Context:** All items are prose additions to `investigate/SKILL.md.tmpl`. No new scripts.

**Items:**
1. Stack trace auto-detection for freeze directory (parse deepest app frame)
2. Freeze boundary widening (ask to widen instead of hard-block when hitting boundary)
3. Post-fix auto-unfreeze + full test suite run
4. Debug instrumentation cleanup (tag with DEBUG-TEMP, remove before commit)
5. Debug session persistence (~/.goldband/investigate-sessions/ — save investigation for reuse)
6. Investigation timeline in debug report (hypothesis log with timing)

**Effort:** M (all 6 combined)
**Priority:** P3
**Depends on:** Telemetry data showing freeze hook fires in real /investigate sessions

## Context Intelligence

### Context recovery preamble

**What:** Add ~10 lines of prose to the preamble telling the agent to re-read goldband artifacts (CEO plans, design reviews, eng reviews, checkpoints) after compaction or context degradation.

**Why:** goldband skills produce valuable artifacts stored at `~/.goldband/projects/$SLUG/`. When Claude's auto-compaction fires, it preserves a generic summary but doesn't know these artifacts exist. The plans and reviews that shaped the current work silently vanish from context, even though they're still on disk. This is the thing nobody else in the Claude Code ecosystem is solving, because nobody else has goldband's artifact architecture.

**Context:** Inspired by Anthropic's `claude-progress.txt` pattern for long-running agents. Also informed by claude-mem's "progressive disclosure" approach. See `docs/designs/SESSION_INTELLIGENCE.md` for the broader vision. CEO plan: `~/.goldband/projects/project-owner-goldband/ceo-plans/2026-03-31-session-intelligence-layer.md`.

**Effort:** S (human: ~30 min / CC: ~5 min)
**Priority:** P1
**Depends on:** None
**Key files:** `scripts/resolvers/preamble.ts`

### Session timeline

**What:** Append one-line JSONL entry to `~/.goldband/projects/$SLUG/timeline.jsonl` after every skill run (timestamp, skill, branch, outcome). `/retro` renders the timeline.

**Why:** Makes AI-assisted work history visible. `/retro` can show "this week: 3 review runs, 2 release runs, 1 investigation." Provides the observability layer for the session intelligence architecture.

**Effort:** S (human: ~1h / CC: ~5 min)
**Priority:** P1
**Depends on:** None
**Key files:** `scripts/resolvers/preamble.ts`, `retro/SKILL.md.tmpl`

### Cross-session context injection

**What:** When a new goldband session starts on a branch with recent checkpoints or plans, the preamble prints a one-line summary: "Last session: implemented JWT auth, 3/5 tasks done." Agent knows where you left off before reading any files.

**Why:** Claude starts every session fresh. This one-liner orients the agent immediately. Similar to claude-mem's SessionStart hook pattern but simpler and integrated.

**Effort:** S (human: ~2h / CC: ~10 min)
**Priority:** P2
**Depends on:** Context recovery preamble

### /checkpoint skill

**What:** Manual skill to snapshot current working state: what's being done and why, files being edited, decisions made (and rationale), what's done vs. remaining, critical types/signatures. Saved to `~/.goldband/projects/$SLUG/checkpoints/<timestamp>.md`.

**Why:** Useful before stepping away from a long session, before known-complex operations that might trigger compaction, for handing off context to a different agent/workspace, or coming back to a project after days away.

**Effort:** M (human: ~1 week / CC: ~30 min)
**Priority:** P2
**Depends on:** Context recovery preamble
**Key files:** New `checkpoint/SKILL.md.tmpl`, `scripts/gen-skill-docs.ts`

### Session Intelligence Layer design doc

**What:** Write `docs/designs/SESSION_INTELLIGENCE.md` describing the architectural vision: goldband as the persistent brain that survives Claude's ephemeral context. Every skill writes to `~/.goldband/projects/$SLUG/`, preamble re-reads, `/retro` rolls up.

**Why:** Connects context recovery, health, checkpoint, and timeline features into a coherent architecture. Nobody else in the ecosystem is building this.

**Effort:** S (human: ~2h / CC: ~15 min)
**Priority:** P1
**Depends on:** None

## Health

### /health — Project Health Dashboard

**What:** Skill that runs type-check, lint, test suite, and dead code scan, then reports a composite 0-10 health score with breakdown by category. Tracks over time in `~/.goldband/health/<project-slug>/` for trend detection. Optionally integrates CodeScene MCP for deeper complexity/cohesion/coupling analysis.

**Why:** No quick way to get "state of the codebase" before starting work. CodeScene peer-reviewed research shows AI-generated code increases static analysis warnings by 30%, code complexity by 41%, and change failure rates by 30%. Users need guardrails. Like `/qa` but for code quality rather than browser behavior.

**Context:** Reads CLAUDE.md for project-specific commands (platform-agnostic principle). Runs checks in parallel. `/retro` can pull from health history for trend sparklines.

**Effort:** M (human: ~1 week / CC: ~30 min)
**Priority:** P1
**Depends on:** None
**Key files:** New `health/SKILL.md.tmpl`, `scripts/gen-skill-docs.ts`

### Health as a release gate

**What:** If health score exists and drops below a configurable threshold, `$goldband release land` warns before creating the PR: "Health dropped from 8/10 to 5/10 this branch — 3 new lint warnings, 1 test failure. Continue?"

**Why:** Quality gate that prevents shipping degraded code. Configurable threshold so it's not blocking for teams that don't use `/health`.

**Effort:** S (human: ~1h / CC: ~5 min)
**Priority:** P2
**Depends on:** /health skill

## Swarm

### Swarm primitive — reusable multi-agent dispatch

**What:** Extract Review Army's dispatch pattern into a reusable resolver (`scripts/resolvers/swarm.ts`). Wire it into release readiness for parallel checks (type-check + lint + test in parallel sub-agents). Make it available to QA, investigation, and health actions.

**Why:** Review Army proved parallel sub-agents work brilliantly (5 agents = 835K tokens of working memory vs. 167K for one). The pattern is locked inside `review-army.ts`. Other skills need it too. Claude Code Agent Teams (official, Feb 2026) validates the team-lead-delegates-to-specialists pattern. Gartner: multi-agent inquiries surged 1,445% in one year.

**Context:** Start with the specific release-readiness use case. Extract shared parts only after 2+ consumers reveal what config parameters are actually needed. Avoid premature abstraction. Can leverage existing WorktreeManager for isolation.

**Effort:** L (human: ~2 weeks / CC: ~2 hours)
**Priority:** P2
**Depends on:** None
**Key files:** `scripts/resolvers/review-army.ts`, new `scripts/resolvers/swarm.ts`, `land-and-deploy/SKILL.md.tmpl`, `lib/worktree.ts`

## Refactoring

### /refactor-prep — Pre-Refactor Token Hygiene

**What:** Skill that detects project language/framework, runs appropriate dead code detection (knip/ts-prune for TS/JS, vulture/autoflake for Python, staticcheck/deadcode for Go, cargo udeps for Rust), strips dead imports/exports/props/console.logs, and commits cleanup separately.

**Why:** Dirty codebases accelerate context compaction. Dead imports, unused exports, and orphaned code eat tokens that contribute nothing but everything to triggering compaction mid-refactor. Cleaning first buys back 20%+ of context budget. Reports lines removed and estimated token savings.

**Effort:** M (human: ~1 week / CC: ~30 min)
**Priority:** P2
**Depends on:** None
**Key files:** New `refactor-prep/SKILL.md.tmpl`, `scripts/gen-skill-docs.ts`

## Factory Droid

### Browse MCP server for Factory Droid

**What:** Expose goldband's browse binary and key workflows as an MCP server that Factory Droid connects to natively. Factory users would run /mcp, add the goldband server, and get browse, QA, and review capabilities as Factory tools.

**Why:** Factory already supports 40+ MCP servers in its registry. Getting goldband's browse binary listed there is a distribution play. Nobody else has a real compiled browser binary as an MCP tool. This is the thing that makes goldband uniquely valuable on Factory Droid.

**Context:** Option A (--host factory compatibility shim) ships first in v0.13.4.0. Option B is the follow-up that provides deeper integration. The browse binary is already a stateless CLI, so wrapping it as an MCP server is straightforward (stdin/stdout JSON-RPC). Each browse command becomes an MCP tool.

**Effort:** L (human: ~1 week / CC: ~5 hours)
**Priority:** P1
**Depends on:** --host factory (Option A, shipping in v0.13.4.0)

### .agent/skills/ dual output for cross-agent compatibility

**What:** Factory also reads from `<repo>/.agent/skills/` as a cross-agent compatibility path. Could output there in addition to `.factory/skills/` for broader reach across other agents that use the `.agent` convention.

**Why:** Multiple AI agents beyond Factory may adopt the `.agent/skills/` convention. Outputting there too would give free compatibility.

**Effort:** S
**Priority:** P3
**Depends on:** --host factory

### Custom Droid definitions alongside skills

**What:** Factory has "custom droids" (subagents with tool restrictions, model selection, autonomy levels). Could ship `goldband-qa.md` droid configs alongside skills that restrict tools to read-only + execute for safety.

**Why:** Deeper Factory integration. Droid configs give Factory users tighter control over what goldband skills can do.

**Effort:** M
**Priority:** P3
**Depends on:** --host factory

## Goldband Loop Browser

### Anti-bot stealth: Playwright CDP patches (rebrowser-style)

**What:** Write a postinstall script that patches Playwright's CDP layer to suppress `Runtime.enable` and use `addBinding` for context ID discovery, same approach as rebrowser-patches. Eliminates the `navigator.webdriver`, `cdc_` markers, and other CDP artifacts that sites like Google use to detect automation.

**Why:** Our current stealth narrows to `navigator.webdriver` masking + ChromeDriver `cdc_` runtime cleanup + Permissions API patch (v1.28.0.0 narrowed it from also faking plugins/languages, since modern fingerprinters punish inconsistent fakes more than they punish admitted defaults). That's enough for most sites but Google still triggers captchas, because the real detection is at the CDP protocol level. rebrowser-patches proved the approach works but their patches target Playwright 1.52.0 and don't apply to our 1.58.2. We need our own patcher using string matching instead of line-number diffs. 6 files, ~200 lines of patches total.

**Context:** Full analysis of rebrowser-patches source: patches 6 files in `playwright-core/lib/server/` (crConnection.js, crDevTools.js, crPage.js, crServiceWorker.js, frames.js, page.js). Key technique: suppress `Runtime.enable` (the main CDP detection vector), use `Runtime.addBinding` + `CustomEvent` trick to discover execution context IDs without it. Our extension communicates via Chrome extension APIs, not CDP Runtime, so it should be unaffected. Write E2E tests that verify: (1) extension still loads and connects, (2) Google.com loads without captcha, (3) sidebar chat still works.

**Effort:** L (human: ~2 weeks / CC: ~3 hours)
**Priority:** P1
**Depends on:** None

### Chromium fork (long-term alternative to CDP patches)

**What:** Maintain a Chromium fork where anti-bot stealth, Goldband Loop Browser branding, and native sidebar support live in the source code, not as runtime monkey-patches.

**Why:** The CDP patches are brittle. They break on every Playwright upgrade and target compiled JS with fragile string matching. A proper fork means: (1) stealth is permanent, not patched, (2) branding is native (no plist hacking at launch), (3) native sidebar replaces the extension (Phase 4 of V0 roadmap), (4) custom protocols (goldband://) for internal pages. Companies like Brave, Arc, and Vivaldi maintain Chromium forks with small teams. With CC, the rebase-on-upstream maintenance could be largely automated.

**Context:** Trigger criteria from V0 design doc: fork when extension side panel becomes the bottleneck, when anti-bot patches need to live deeper than CDP, or when native UI integration (sidebar, status bar) can't be done via extension. The Chromium build takes ~4 hours on a 32-core machine and produces ~50GB of build artifacts. CI would need dedicated build infra. See `docs/designs/GOLDBAND_BROWSER_V0.md` Phase 5 for full analysis.

**Effort:** XL (human: ~1 quarter / CC: ~2-3 weeks of focused work)
**Priority:** P2
**Depends on:** CDP patches proving the value of anti-bot stealth first
