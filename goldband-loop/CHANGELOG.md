# Changelog

This changelog records user-visible changes only. Implementation details and engineering
evidence remain in pull requests and Git history.

## [1.46.0.0] - 2026-07-06

- Goldband Loop now has one workflow discovery profile.
- Legacy `*-slim` and `*-full` profile names still map to the standard profile with a deprecation warning; use `workflow`, `workflow-codex`, or `workflow-auto` in new scripts.

## [1.45.0.0] - 2026-05-25

- Design boards now live 24 hours, not 10 minutes. One daemon hosts every board, one tab survives the whole day.

## [1.44.1.0] - 2026-05-24

- Office-hours session counts, macOS 26.x iOS QA tunnels, Windows brain sync, and browse bind diagnostics were fixed.

## [1.44.0.0] - 2026-05-23

- Sidebar Claude Code now survives the day. WebSocket keepalive, transparent re-attach across network blips with scrollback intact, and a restart button that actually kills the old claude before spawning the new one.

## [1.43.3.0] - 2026-05-21

- Headed Chromium embedded by external supervisors stops auto-shutting-down after 30 minutes of HTTP idle.

## [1.43.2.0] - 2026-05-21

- Three flagship workflows stop lying to users: /retro detects stale base before fabricating a narrative, /sync-gbrain resumes from gbrain's checkpoint instead of restarting the 35-min import loop, and /review forces every finding to quote the code line that motivates it.

## [1.43.1.0] - 2026-05-21

- Local gbrain PGLite now defaults to Voyage's code-specialized embedding model when `VOYAGE_API_KEY` is set.

## [1.43.0.0] - 2026-05-20

- iOS QA on a real iPhone — no XCTest, no WebDriverAgent, no simulators.

## [1.42.2.0] - 2026-05-20

- Headed Chromium stops shipping the yellow `--no-sandbox` infobar, and Cmd+Q on the managed window stops triggering the supervisor respawn loop.

## [1.42.1.0] - 2026-05-19

- Embedder PTY teardown stops clobbering — gbrowser's phoenix overlay survives every shutdown.

## [1.42.0.0] - 2026-05-19

- Sidebar security enforcement, screenshot sizing, Windows installation, and Codex review compatibility received a bundled fix release.

## [1.41.1.0] - 2026-05-18

- Build and sync tools now fail safely when temporary-file creation fails instead of writing to predictable or root-level paths.
- Classifier downloads clean up partial files; malformed `pdf --from-file` input reports a useful error; `/goldband` discovers long-header sessions reliably.

## [1.40.0.0] - 2026-05-16

- gbrain sync stops biting users across the install path, slug algorithm, federation queue, and `.env.local` footgun.

## [1.39.2.0] - 2026-05-15

- Conductor workspaces wire `GOLDBAND_*` keys straight into gbrain embeddings and paid evals.

## [1.39.1.0] - 2026-05-15

- Plan-mode reviews now enforce a blocking ExitPlanMode gate.

## [1.39.0.0] - 2026-05-14

- `buildFetchHandler` ships. Embedders compose overlay routes on top of goldband's dispatch without forking the browse server.

## [1.38.1.0] - 2026-05-14

- Every review skill ends with a build-actionable task checklist. Federation sync stops dropping office-hours design docs.

## [1.38.0.0] - 2026-05-14

- Windows install actually works across every host adapter. Page scrapes survive lone Unicode surrogates on every egress path.

## [1.37.0.0] - 2026-05-14

- Split-engine gbrain: remote MCP for brain, local PGLite for code.

## [1.35.0.0] - 2026-05-13

- Docs become a tracked surface, not an afterthought. `/document-generate` writes them from scratch, `/document-release` audits coverage in four Diataxis quadrants.

## [1.34.2.0] - 2026-05-13

- `/codex review`, `/investigate` learnings, and `/sync-gbrain` engine detection work again.

## [1.34.1.0] - 2026-05-13

- `goldband-update-check` resolves remote VERSION via a SHA-pinned URL.

## [1.34.0.0] - 2026-05-12

- Goldband Loop is now consumable as a submodule.

## [1.33.2.0] - 2026-05-11

- `./setup` no longer pollutes the global install when run from a Conductor worktree.

## [1.33.1.0] - 2026-05-11

- Long skills stop drifting away from their starting context.

## [1.33.0.0] - 2026-05-11

- `/sync-gbrain` memory stage no longer infinite-loops or silently throws away progress.

## [1.32.0.0] - 2026-05-10

- Root-token comparison, IPv6 link-local blocking, NUL-safe transcript ingestion, sidebar tabs, fresh-worktree builds, model IDs, and CJK rendering were fixed.

## [1.31.1.0] - 2026-05-10

- `/careful` works on macOS again, Codex Step 0 no longer collides, and `/make-pdf` setup runs in the right order.

## [1.31.0.0] - 2026-05-09

- AskUserQuestion stops getting silently buried in plan files.

## [1.30.0.0] - 2026-05-09

- Windows installs now resolve browse and PDF binaries correctly, restrict Goldband state files with NTFS ACLs, and run telemetry through the available Bash executable.
- Codex session resume works on machines with either `python3` or `python` and no longer passes unsupported resume flags.
- Browse fixes console-log persistence, concurrent daemon startup, iframe cleanup, and Korean/CJK IME input.

## [1.29.0.0] - 2026-05-08

- Code search beats Grep across every Conductor worktree now, not just the last one you synced.

## [1.28.0.0] - 2026-05-07

- Browse handles real-world automation now: SOCKS5 with auth, container Xvfb, browser-native downloads. Plus a single-file `llms.txt` index agents can crawl in one read.

## [1.27.1.0] - 2026-05-06

- Plan-mode reviews now refuse to dump findings without asking.

## [1.27.0.0] - 2026-05-06

- `/setup-gbrain` connects to a remote brain in one paste. Brain repo renamed to goldband-artifacts.

## [1.26.5.0] - 2026-05-06

- The v1.26 memory feature now actually works on a fresh `/setup-gbrain` install, and `/sync-gbrain --full` actually registers github-hosted code sources.

## [1.26.4.0] - 2026-05-05

- `/autoplan` review reports now reliably land at the bottom of the plan, even when an older copy lives mid-file.

## [1.26.3.0] - 2026-05-03

- `/sync-gbrain` keeps your brain current and teaches the agent when to use it.

## [1.26.2.0] - 2026-05-03

- `/plan-eng-review` always asks. Never silently writes findings to your plan first.

## [1.26.1.0] - 2026-05-03

- `goldband-gbrain-sync` ships host-agnostic. Curated artifacts push from Claude Code, Codex CLI, or a dev workspace — same orchestrator, same install, same result.

## [1.26.0.0] - 2026-05-02

- Your coding agent now remembers everything. Every goldband skill auto-loads what you actually did.

## [1.25.1.0] - 2026-05-01

- Office-hours stops at Phase 4 architectural forks. AskUserQuestion evals — and `/codex` synthesis — now grade the "because" clause.

## [1.25.0.0] - 2026-05-01

- Plan-mode skills surface every decision again, even when the host disallows AskUserQuestion.

## [1.24.0.0] - 2026-04-30

- Cross-platform hardening. Mac + Linux full, curated Windows lane added.

## [1.23.0.0] - 2026-04-30

- Every PR title now starts with `vX.Y.Z.W`. `/ship`, `/document-release`, and the GitHub Action all enforce it.

## [1.21.1.0] - 2026-04-28

- `/plan-ceo-review` no longer skips Step 0 or ships a plan without the required decision gate.

## [1.20.0.0] - 2026-04-28

- Browser-skills land. `/scrape <intent>` first call drives the page; second call runs the codified script in 200ms.

## [1.17.0.0] - 2026-04-26

- Your goldband memory now actually lives in gbrain.

## [1.16.0.0] - 2026-04-28

- Paired-agent tunnel allowlist now matches what the docs already promised. Catch-22 resolved, gate is unit-testable.

## [1.15.0.0] - 2026-04-26

- Real-PTY test harness ships.

## [1.14.0.0] - 2026-04-25

- The goldband browser sidebar is now an interactive Claude Code REPL with live tab awareness.

## [1.13.0.0] - 2026-04-25

- `/goldband-claude` gives non-Claude hosts a read-only outside voice.

## [1.12.2.0] - 2026-04-24

- `/setup-gbrain` polish: PATH parsing, repo init order, MCP user scope.

## [1.12.1.0] - 2026-04-24

- Plan-mode review skills run the review directly, no more "exit and rerun" prompt.

## [1.12.0.0] - 2026-04-24

- `/setup-gbrain` — any coding agent goes from zero to "gbrain is running, and I can call it" in under five minutes.

## [1.11.1.0] - 2026-04-23

- Plan mode stopped silently rubber-stamping your reviews. The forcing questions actually fire now.

## [1.11.0.0] - 2026-04-23

- Workspace-aware ship. Two open PRs can't both claim the same VERSION anymore.

## [1.10.1.0] - 2026-04-23

- Removed the Opus 4.7 fan-out prompt after measurement showed that it reduced performance.

## [1.10.0.0] - 2026-04-23

- Plan reviews walk you through each issue again, and every question is now a real decision brief.

## [1.9.0.0] - 2026-04-23

- Your goldband memory now travels with you. Cross-machine brain via a private git repo + optional GBrain indexing, no daemon, no credential leaks.

## [1.6.4.0] - 2026-04-22

- Sidebar prompt-injection defense got half as noisy, half as trusting of any single classifier.

## [1.6.3.0] - 2026-04-23

- Codex finally explains what it's asking about. No more "ELI10 please" the 10th time in a row.

## [1.6.2.0] - 2026-04-22

- Plan reviews give you the recommendation again. And we finally admitted a 10/10 score on a mode pick means nothing.

## [1.6.1.0] - 2026-04-22

- Opus 4.7 now uses a model-specific overlay.

## [1.6.0.0] - 2026-04-21

- The token leak in pair-agent sessions is closed by splitting the daemon into two HTTP listeners, not by pretending one port can be two things at once.

## [1.5.1.0] - 2026-04-20

- Three visible bugs in v1.4.0.0 /make-pdf, all fixed.

## [1.5.0.0] - 2026-04-20

- Your sidebar agent now defends itself against prompt injection.

## [1.4.0.0] - 2026-04-20

- Turn any markdown file into a PDF that looks finished.

## [1.3.0.0] - 2026-04-19

- Your design skills learn your taste.

## [1.1.3.0] - 2026-04-19

- `/checkpoint` is now `/context-save` and `/context-restore`; existing saved contexts still load.
- Restore ordering is deterministic, and restoring with no saved contexts now reports a clean empty state on macOS.

## [1.1.2.0] - 2026-04-19

- `/plan-ceo-review` keeps SCOPE EXPANSION output expansive, and `/office-hours` keeps its stronger forcing questions and exploratory builder mode.

## [1.1.1.0] - 2026-04-18

- **`/ship` no longer silently lets `VERSION` and `package.json` drift.**
- **Hardened against malformed version strings.**

## [1.1.0.0] - 2026-04-18

- **Browse can now render local HTML without an HTTP server.**
- **Element screenshots with an explicit flag.**
- **Retina screenshots via `--scale`.**
- **Load-HTML content survives scale changes.**

## [1.0.0.0] - 2026-04-18

- **v1 prompts = simpler.**
- **Terse opt-out for power users.**
- **Curated jargon list.**
- **Real LOC receipts in the README.**

## [0.19.0.0] - 2026-04-17

- **`/plan-tune` skill — goldband can now learn which of its prompts you find valuable vs noisy.**
- **Dual-track developer profile.**
- **Builder archetypes.**
- **Inline `tune:` feedback across every goldband skill.**

## [0.18.4.0] - 2026-04-18

- **Apple Silicon no longer dies with SIGKILL on first run.**
- **`/codex` no longer hangs forever in Claude Code's Bash tool.**
- **`/codex` and `/autoplan` fail fast when Codex auth is missing or broken.**
- **`/codex` and `/autoplan` no longer sit at 0% CPU forever if the model API stalls.**

## [0.18.3.0] - 2026-04-17

- **Windows cookie import.**
- **One-command OpenCode install.**
- **No more permission prompts on every skill invocation.**
- **Multi-step QA actually works.**

## [0.18.2.0] - 2026-04-17

- **`/ship` stops skipping `/document-release` ~80% of the time.**
- **`/ship`'s 4 heaviest sub-workflows now run in isolated subagent contexts.**
- **`/ship` step numbers are clean integers 1-20 instead of fractional (`3.47`, `8.5`, `8.75`).**
- **`/ship` now prints "You are NOT done" after push.**

## [0.18.1.0] - 2026-04-16

- **`/open-goldband-browser` actually stays open now.**
- **Closing the headed browser window now cleans up properly.**
- **CI/Claude Code Bash calls can now share a persistent headless server.**
- **`SIGTERM` / `SIGINT` shutdown now exits with code 0 instead of 1.**

## [0.18.0.1] - 2026-04-16

- **Windows install no longer fails with a build error.**
- **CI stops lying about green builds.**
- **`/pair-agent` on Windows surfaces install problems at install time, not tunnel time.**

## [0.18.0.0] - 2026-04-15

- **Confusion Protocol.**
- **Hermes host support.**
- **GBrain host + brain-first resolver.**
- **GBrain v0.10.0 integration.**

## [0.17.0.0] - 2026-04-14

- **UX behavioral foundations.**
- **First-person narration mode.**
- **`$B ux-audit` command.**
- **`snapshot -H` / `--heatmap` flag.**

## [0.16.4.0] - 2026-04-13

- **Cookie origin pinning.**
- **Command audit log.**
- **Cookie domain tracking.**
- **Symlink bypass in file writes.**

## [0.16.3.0] - 2026-04-09

- **AI slop cleanup.**
- **`bun run slop:diff`**
- **Slop-scan usage guidelines**
- **Design doc**

## [0.16.2.0] - 2026-04-09

- **Office hours now remembers you.**
- **Builder profile**
- **Builder-to-founder nudge**
- **Journey-matched resources.**

## [0.16.1.0] - 2026-04-08

- Cookie picker no longer leaks the browse server auth token. Previously, opening the cookie picker page exposed the master bearer token in the HTML source, letting any local process extract it and execute arbitrary JavaScript in your browser session.

## [0.16.0.0] - 2026-04-07

- **Browser data platform.**
- `media` command: discover every image, video, and audio element on a page. Returns URLs, dimensions, srcset, lazy-load state, and detects HLS/DASH streams.
- `data` command: extract structured data embedded in pages. JSON-LD (product prices, recipes, events), Open Graph, Twitter Cards, and meta tags.
- `download` command: fetch any URL or `@ref` element to disk using the browser's session cookies. Handles blob URLs via in-page base64 conversion.

## [0.15.16.0] - 2026-04-06

- Each browser tab now has isolated refs, snapshot state, and frame context, preventing cross-tab collisions.

## [0.15.15.1] - 2026-04-06

- pair-agent tunnel drops after 15 seconds. The browse server was monitoring its parent process ID and self-terminating when the CLI exited.
- `$B connect` crashes with "domains is not defined". A stray variable reference in the headed-mode status check prevented Goldband Loop Browser from initializing properly.

## [0.15.15.0] - 2026-04-06

- Cookie value redaction for tokens, API keys, JWTs, and session secrets in `browse cookies` output. Your secrets no longer appear in Claude's context.
- IPv6 ULA prefix blocking (fc00::/7) in URL validation. Covers the full unique-local range, not just the literal `fd00::`.
- Per-tab cancel signaling for sidebar agents. Stopping one tab's agent no longer kills all tabs.
- Parent process watchdog for the browse server. When Claude Code exits, orphaned browser processes now self-terminate within 15 seconds.

## [0.15.14.0] - 2026-04-05

- **`goldband-team-init` now detects and removes vendored goldband copies.**
- **`/goldband-upgrade` respects team mode.**
- **`team_mode` config key.**

## [0.15.13.0] - 2026-04-04

- Team Mode

## [0.15.12.0] - 2026-04-05

- Content Security: 4-Layer Prompt Injection Defense

## [0.15.11.0] - 2026-04-05

- Re-running `/ship` repeats verification while keeping pushes, PR creation, and version bumps idempotent.
- Previously dismissed review findings stay suppressed unless their relevant code changes, and the final PR body includes documentation updates.

## [0.15.10.0] - 2026-04-05

- Native OpenClaw Skills + ClawHub Publishing

## [0.15.9.0] - 2026-04-05

- OpenClaw Integration v2

## [0.15.8.1] - 2026-04-05

- Community PR Triage + Error Polish

## [0.15.8.0] - 2026-04-04

- Smarter Reviews

## [0.15.7.0] - 2026-04-05

- Security Wave 1

## [0.15.6.2] - 2026-04-04

- Anti-Skip Review Rule

## [0.15.6.1] - 2026-04-04

- **Skill prefix self-healing.**

## [0.15.6.0] - 2026-04-04

- Declarative Multi-Host Platform

## [0.15.5.0] - 2026-04-04

- Interactive DX Review + Plan Mode Skill Fix

## [0.15.4.0] - 2026-04-03

- Autoplan DX Integration + Docs

## [0.15.3.0] - 2026-04-03

- Developer Experience Review

## [0.15.2.1] - 2026-04-02

- Setup Runs Migrations

## [0.15.2.0] - 2026-04-02

- Voice-Friendly Skill Triggers

## [0.15.1.0] - 2026-04-01

- Design Without Shotgun

## [0.15.0.0] - 2026-04-01

- Session Intelligence

## [0.14.6.0] - 2026-03-31

- Recursive Self-Improvement

## [0.14.5.0] - 2026-03-31

- Ship Idempotency + Skill Prefix Fix

## [0.14.4.0] - 2026-03-31

- Review Army: Parallel Specialist Reviewers

## [0.14.3.0] - 2026-03-31

- Always-On Adversarial Review + Scope Drift + Plan Mode Design Tools

## [0.14.2.0] - 2026-03-30

- Sidebar CSS Inspector + Per-Tab Agents

## [0.14.1.0] - 2026-03-30

- Comparison Board is the Chooser

## [0.14.0.0] - 2026-03-30

- Design to Code

## [0.13.10.0] - 2026-03-29

- Office Hours Gets a Reading List

## [0.13.9.0] - 2026-03-29

- Composable Skills

## [0.13.8.0] - 2026-03-29

- Security Audit Round 2

## [0.13.7.0] - 2026-03-29

- Community Wave

## [0.13.6.0] - 2026-03-29

- Goldband Loop Learns

## [0.13.5.1] - 2026-03-29

- Gitignore .factory

## [0.13.5.0] - 2026-03-29

- Factory Droid Compatibility

## [0.13.4.0] - 2026-03-29

- Sidebar Defense

## [0.13.3.0] - 2026-03-28

- Lock It Down

## [0.13.2.0] - 2026-03-28

- User Sovereignty

## [0.13.1.0] - 2026-03-28

- Defense in Depth

## [0.13.0.0] - 2026-03-27

- Your Agent Can Design Now

## [0.12.12.0] - 2026-03-27

- Security Audit Compliance

## [0.12.11.0] - 2026-03-27

- Skill Prefix is Now Your Choice

## [0.12.10.0] - 2026-03-27

- Codex Filesystem Boundary

## [0.12.9.0] - 2026-03-27

- Community PRs: Faster Install, Skill Namespacing, Uninstall

## [0.12.8.1] - 2026-03-27

- zsh Glob Compatibility

## [0.12.8.0] - 2026-03-27

- Codex No Longer Reviews the Wrong Project

## [0.12.7.0] - 2026-03-27

- Community PRs + Security Hardening

## [0.12.6.0] - 2026-03-27

- Sidebar Knows What Page You're On

## [0.12.5.1] - 2026-03-27

- Eng Review Now Tells You What to Parallelize

## [0.12.5.0] - 2026-03-26

- Fix Codex Hangs: 30-Minute Waits Are Gone

## [0.12.4.0] - 2026-03-26

- Full Commit Coverage in /ship

## [0.12.3.0] - 2026-03-26

- Voice Directive: Every Skill Sounds Like a Builder

## [0.12.2.0] - 2026-03-26

- Deploy with Confidence: First-Run Dry Run

## [0.12.1.0] - 2026-03-26

- Smarter Browsing: Network Idle, State Persistence, Iframes

## [0.12.0.0] - 2026-03-26

- Headed Mode + Sidebar Agent

## [0.11.21.0] - 2026-03-26

- **`/autoplan` reviews now count toward the ship readiness gate.**
- **`/ship` no longer tells you to "run /review first."**
- **`/land-and-deploy` now checks all 8 review types.**
- **Dashboard Outside Voice row now works.**

## [0.11.20.0] - 2026-03-26

- **GitLab support for `/retro` and `/ship`.**
- **GitHub Enterprise and self-hosted GitLab detection.**
- **`/document-release` works on GitLab.**
- **GitLab safety gate for `/land-and-deploy`.**

## [0.11.19.0] - 2026-03-24

- **Auto-upgrade no longer breaks.**
- **Codex reviews now run in the correct repo.**

## [0.11.18.2] - 2026-03-24

- **Windows browse daemon fixed.**

## [0.11.18.1] - 2026-03-24

- **One decision per question. everywhere.**

## [0.11.18.0] - 2026-03-24

- Ship With Teeth

## [0.11.17.0] - 2026-03-24

- Cleaner Skill Descriptions + Proactive Opt-Out

## [0.11.16.1] - 2026-03-24

- Installation ID Privacy Fix

## [0.11.16.0] - 2026-03-24

- Smarter CI + Telemetry Security

## [0.11.15.0] - 2026-03-24

- E2E Test Coverage for Plan Reviews & Codex

## [0.11.14.0] - 2026-03-24

- Windows Browse Fix

## [0.11.13.0] - 2026-03-24

- Worktree Isolation + Infrastructure Elegance

## [0.11.12.0] - 2026-03-24

- Triple-Voice Autoplan

## [0.11.11.0] - 2026-03-23

- Community Wave 3

## [0.11.10.0] - 2026-03-23

- CI Evals on Ubicloud

## [0.11.9.0] - 2026-03-23

- Codex Skill Loading Fix

## [0.11.8.0] - 2026-03-23

- zsh Compatibility Fix

## [0.11.7.0] - 2026-03-23

- /review → /ship Handoff Fix

## [0.11.6.0] - 2026-03-23

- Infrastructure-First Security Audit

## [0.11.5.2] - 2026-03-22

- Outside Voice

## [0.11.5.1] - 2026-03-23

- Inline Office Hours

## [0.11.5.0] - 2026-03-23

- Bash Compatibility Fix

## [0.11.4.0] - 2026-03-22

- Codex in Office Hours

## [0.11.3.0] - 2026-03-23

- Design Outside Voices

## [0.11.2.0] - 2026-03-22

- Codex Just Works

## [0.11.1.1] - 2026-03-22

- Plan Files Always Show Review Status

## [0.11.1.0] - 2026-03-22

- Global Retro: Cross-Project AI Coding Retrospective

## [0.11.0.0] - 2026-03-22

- /cso: Zero-Noise Security Audits

## [0.10.2.0] - 2026-03-22

- Autoplan Depth Fix

## [0.10.1.0] - 2026-03-22

- Test Coverage Catalog

## [0.10.0.0] - 2026-03-22

- Autoplan

## [0.9.8.0] - 2026-03-21

- Deploy Pipeline + E2E Performance

## [0.9.7.0] - 2026-03-21

- Plan File Review Report

## [0.9.6.0] - 2026-03-21

- Auto-Scaled Adversarial Review

## [0.9.5.0] - 2026-03-21

- Builder Ethos

## [0.9.4.1] - 2026-03-20

- **`/retro` no longer nags about PR size.**

## [0.9.4.0] - 2026-03-20

- Codex Reviews On By Default

## [0.9.3.0] - 2026-03-20

- Windows Support

## [0.9.2.0] - 2026-03-20

- Gemini CLI E2E Tests

## [0.9.1.0] - 2026-03-20

- Adversarial Spec Review + Skill Chaining

## [0.9.0.1] - 2026-03-19

- **Telemetry opt-in now defaults to community mode.**
- **Review logs and telemetry now persist during plan mode.**

## [0.9.0] - 2026-03-19

- Works on Codex, Gemini CLI, and Cursor

## [0.8.6] - 2026-03-19

- **You can now see how you use goldband.**
- **Opt-in community telemetry.**
- **Community health dashboard.**
- **Install base tracking via update check.**

## [0.8.5] - 2026-03-19

- **`/retro` now counts full calendar days.**
- **Review log no longer breaks on branch names with `/`.**
- **All skill templates are now platform-agnostic.**
- **`/ship` reads CLAUDE.md to discover test commands**

## [0.8.4] - 2026-03-19

- **`/ship` now automatically syncs your docs.**
- **Six new skills in the docs.**
- **Browse handoff documented everywhere.**

## [0.8.3] - 2026-03-19

- **Plan reviews now guide you to the next step.**
- **Reviews know when they're stale.**
- **`skip_eng_review` respected everywhere.**
- **Design review lite now tracks commits too.**

## [0.8.2] - 2026-03-19

- **Hand off to a real Chrome when the headless browser gets stuck.**
- **Auto-handoff hint after 3 consecutive failures.**
- `browser.close()` now has a 5-second timeout to prevent hangs when closing headed browsers on macOS.

## [0.8.1] - 2026-03-19

- **`/qa` no longer refuses to use the browser on backend-only changes.**

## [0.8.0] - 2026-03-19

- Multi-AI Second Opinion

## [0.7.4] - 2026-03-18

- **`/qa` and `/design-review` now ask what to do with uncommitted changes**

## [0.7.3] - 2026-03-18

- **Safety guardrails you can turn on with one command.**
- **Lock edits to one folder with `/freeze`.**
- **`/guard` activates both at once.**
- **`/debug` now auto-freezes edits to the module being debugged.**

## [0.7.2] - 2026-03-18

- `/retro` date ranges now align to midnight instead of the current time. Running `/retro` at 9pm no longer silently drops the morning of the start date.
- `/retro` timestamps now use your local timezone instead of hardcoded Pacific time. Users outside the US-West coast get correct local hours in histograms, session detection, and streak tracking.

## [0.7.1] - 2026-03-19

- **goldband now suggests skills at natural moments.**
- **Lifecycle map.**
- **Opt-out with natural language.**
- **Trigger phrase validation.**

## [0.7.0] - 2026-03-18

- YC Office Hours

## [0.6.4.1] - 2026-03-18

- **Skills now discoverable via natural language.**

## [0.6.4.0] - 2026-03-17

- **`/plan-design-review` is now interactive. rates 0-10, fixes the plan.**
- **CEO review now calls in the designer.**
- `/qa-design-review` renamed to `/design-review`. the "qa-" prefix was confusing now that `/plan-design-review` is plan-mode.

## [0.6.3.0] - 2026-03-17

- **Every PR touching frontend code now gets a design review automatically.**
- **`goldband-diff-scope` categorizes what changed in your branch.**
- **Design review shows up in the Review Readiness Dashboard.**

## [0.6.2.0] - 2026-03-17

- **Plan reviews now think like the best in the world.**
- **Latent space activation, not checklists.**

## [0.6.1.0] - 2026-03-17

- `bun run eval:select` previews which diff-selected checks will run before spending API credits.
- `test:e2e` and `test:evals` now select checks from the current diff; `*:all` commands remain available for full runs.
