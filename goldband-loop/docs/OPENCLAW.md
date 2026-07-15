# goldband x OpenClaw Integration

goldband integrates with OpenClaw as a methodology source, not a ported codebase.
OpenClaw's ACP runtime spawns Claude Code sessions natively. goldband provides the
planning discipline and methodology that makes those sessions better.

This is a lightweight protocol encoded as prompt text. No daemon. No JSON-RPC.
No compatibility matrices. The prompt is the bridge.

## Architecture

```
  OpenClaw                               goldband repo
  ─────────────────────                    ──────────────
  Orchestrator: messaging,                 Source of truth for
  calendar, memory, EA                     methodology + planning
       │                                        │
       ├── Native skills (conversational)       ├── Tracks native skills
       │   office-hours, ceo-review,            │   under openclaw/skills
       │   investigate, retro                   │
       │                                        ├── Generates goldband-lite
       ├── sessions_spawn(runtime: "acp")       │   (planning discipline)
       │       │                                │
       │       └── Claude Code                  ├── Generates goldband-full
       │           └── goldband installed at      │   (complete pipeline)
       │               ~/.claude/skills/goldband  │
       │                                        └── docs/OPENCLAW.md (this file)
       └── Dispatch routing (AGENTS.md)
```

## Dispatch Routing

OpenClaw decides at spawn time which tier of goldband support to use:

| Tier | When | Prompt prefix |
|------|------|---------------|
| **Simple** | One-file edits, typos, config changes | No goldband context injected |
| **Medium** | Multi-file features, refactors | goldband-lite CLAUDE.md appended |
| **Heavy** | Specific goldband capability needed | "Load goldband. Run $goldband <capability> <action>" |
| **Full** | Complete features, objectives, projects | goldband-full pipeline appended |
| **Plan** | "Help me plan a Claude Code project" | goldband-plan pipeline appended |

### Decision heuristic

- Can it be done in <10 lines of code? -> **Simple**
- Does it touch multiple files but the approach is obvious? -> **Medium**
- Does the user name a specific Goldband capability? -> **Heavy**
- Is it a feature, project, or objective (not a task)? -> **Full**
- Does the user want to PLAN something for Claude Code without implementing yet? -> **Plan**

### Dispatch routing guide (for AGENTS.md)

The complete ready-to-paste section lives in `openclaw/agents-goldband-section.md`.
Copy it into your OpenClaw AGENTS.md.

Key behavioral rules (these go ABOVE the dispatch tiers):

1. **Always spawn, never redirect.** When the user asks to use ANY goldband skill,
   ALWAYS spawn a Claude Code session. Never tell the user to open Claude Code.
2. **Resolve the repo.** If the user names a repo, set the working directory. If
   unknown, ask which repo.
3. **Automated planning runs end-to-end.** Spawn `$goldband plan auto`, let it run the full pipeline, report back
   in chat. User should never have to leave Telegram.

### CLAUDE.md collision handling

When spawning Claude Code in a repo that already has a CLAUDE.md, APPEND
goldband-lite/full as a new section. Do not replace the repo's existing instructions.

## Tracked OpenClaw assets

All OpenClaw-specific artifacts are reviewed source files under `openclaw/`.
They are not generated from Goldband workflow prompts.

### goldband-lite (Medium tier)
`openclaw/goldband-lite-CLAUDE.md` — ~15 lines of planning discipline:
1. Read every file before modifying
2. Write a 5-line plan: what, why, which files, test case, risk
3. Resolve ambiguity using decision principles
4. Self-review before reporting done
5. Completion report: what shipped, decisions made, anything uncertain

A/B tested: 2x time, meaningfully better output.

### goldband-full (Full tier)
`openclaw/goldband-full-CLAUDE.md` — chains existing goldband skills:
1. Read CLAUDE.md and understand the project
2. Run `$goldband plan auto` (CEO + eng + design review)
3. Implement the approved plan
4. Run `$goldband release land` to create and land the PR
5. Report back with PR URL and decisions

### goldband-plan (Plan tier)
`openclaw/goldband-plan-CLAUDE.md` — full review gauntlet, no implementation:
1. Run `$goldband plan strategy` to produce a design doc
2. Run `$goldband plan auto` (CEO + eng + design + DX reviews + codex adversarial)
3. Save the reviewed plan to `plans/<project-slug>-plan-<date>.md`
4. Report back: plan path, summary, key decisions, recommended next step

The orchestrator persists the plan link to its own memory store (brain repo,
knowledge base, or whatever is configured in AGENTS.md). When the user is
ready to build, spawn a FULL session that references the saved plan.

### Native methodology skills
Published to ClawHub. Install with `clawhub install`:
- `goldband-openclaw-office-hours` — Product interrogation (6 forcing questions)
- `goldband-openclaw-ceo-review` — Strategic challenge (10-section review, 4 modes)
- `goldband-openclaw-investigate` — Operational debugging (4-phase methodology)
- `goldband-openclaw-retro` — Operational retrospective (weekly review)

Source lives in `openclaw/skills/` in the goldband repo. These are hand-crafted
adaptations of the goldband methodology for OpenClaw's conversational context.
No goldband infrastructure (no browse, no telemetry, no preamble).

## Spawned session detection

When Claude Code runs inside a session spawned by OpenClaw, the `OPENCLAW_SESSION`
environment variable should be set. goldband detects this and adjusts:
- Skips interactive prompts (auto-chooses recommended options)
- Skips upgrade checks and telemetry prompts
- Focuses on task completion and prose reporting

Set the env var in sessions_spawn: `env: { OPENCLAW_SESSION: "1" }`

## Installation

For OpenClaw users: tell your OpenClaw agent "install goldband for openclaw."

The agent should:
1. Install goldband-lite CLAUDE.md into its coding session templates
2. Install the 4 native methodology skills
3. Add dispatch routing to AGENTS.md
4. Verify with a test spawn

For goldband developers, `./setup --host openclaw` points to this documentation
and the tracked assets.

## What we don't do

- No dispatch daemon (ACP handles session spawning)
- No Clawvisor relay (no security layer needed)
- No bidirectional learnings bridge (brain repo is the knowledge store)
- No JSON schemas or protocol versioning
- No SOUL.md from goldband (OpenClaw has its own)
- No full skill porting (coding skills stay native to Claude Code)
