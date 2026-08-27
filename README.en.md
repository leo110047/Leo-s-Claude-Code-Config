# goldband

> Local engineering guardrails, installer assets, and workflow runtime support
> for Claude Code and Codex.

English | [中文](README.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What This Is

goldband is a local engineering pack for Claude Code and Codex. It keeps shared
policy, hooks, rules, commands, portable skills, Codex config, and the optional
Goldband Loop workflow runtime in one checkout.

This repo has two layers:

- root `goldband`: installer, Claude/Codex adapters, shared policy, hooks,
  rules, commands, portable skills, plugin/app distribution.
- `goldband-loop/`: first-party workflow runtime for public review,
  investigation, QA, browser, planning, and related capability actions;
  unfinished high-risk work stays in a hidden experimental inventory.

For detailed ownership and runtime contracts, see
[ARCHITECTURE.md](ARCHITECTURE.md).

`review/code` first loads the project-owned `goldband.review-evidence.json`,
runs every typed check in an independent read-only, default-deny read/write/network snapshot,
validates pre/post tree digests, reciprocal provider/cell ownership, and exact RED exits, and validates
evidence completeness and candidate provenance before one semantic review. If
an operation uses a script launcher, its manifest must invoke the interpreter explicitly. A Mach-O runtime
with non-system dependencies executes from a private sealed projection: Goldband rewrites only attested
load commands, ad-hoc signs and re-attests the transformed bytes, and leaves the original host package tree
unreadable. The macOS profile exactly re-denies inherited syslog, Mach service, and shared-memory channels
in addition to broad network and system-socket access.
If
that review finds an issue and the candidate is repaired,
`--closure-artifact <initial-artifact>` performs one closure pass over only the
repair delta, original finding IDs, and rerun evidence. New or changed affected
cells in the repaired manifest are rerun, and `closed` requires fresh passing
evidence. Closure also requires a receipt issued by the installed runtime authority for the complete
initial payload, review scope, and Work Map claim attempt; prior-attempt replay is rejected. This
boundary distrusts reviewed code, model output, and artifact input, while trusting the Goldband
installer/runtime under the same OS account. Isolating a malicious same-user host process requires
an OS-backed key or privileged helper.
Closure receipts use at-most-once semantics: after repair binding and Work Map causality
validation, an atomic claim consumes the receipt. A crash or later failure requires a new
initial review instead of replaying that receipt. Prompt-redacted untracked files remain
digest-bound and executable through a separate snapshot-only channel.

Cross-run review authority is owned by a signed installed-runtime acceptance
lineage. A new manifest may add coverage but cannot remove, reverse, or weaken
inherited required cells, and an open finding forces scoped closure. Projects
may commit typed minimum evidence requirements or attributable waivers in
`goldband.review-policy.json` on the base commit; model prose and candidate-only
files have no waiver authority. `No new findings` is reported separately from
contract completeness, prior blockers, closure, and completion authority. A
zero-finding initial review cannot trigger closure. Fixture, local, live, device, and production
evidence levels remain distinct, and a green gate is never reported as overall
deployment readiness.

## Install Paths

| Need | Recommended path |
| --- | --- |
| Claude Code core guardrails | Claude plugin: `goldband@goldband` |
| Codex full setup | `./install.sh codex-full` |
| Claude Code + Codex | `./install.sh all-tools` |
| Claude Code + Codex + Goldband Loop | `./install.sh all-with-workflow` |
| Codex portable plugin subset | repo marketplace: `.agents/plugins/marketplace.json` |
| Claude Desktop app subset | `app-adapters/claude-desktop/dist/goldband-local-extension.mcpb` |
| Claude web/mobile app subset | `app-adapters/claude-remote/goldband-connector.template.json` |

The Claude plugin is the main Claude Code core-guardrails path. It does not
include Goldband Loop, Playwright/browser/iOS tooling, or Codex full setup. Use
the installer when you need the workflow runtime.

## Quickstart

Claude Code plugin:

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
claude plugin marketplace add ./
claude plugin install goldband@goldband --scope user
./install.sh status
```

Codex or dual-tool setup:

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
./install.sh all-tools
./install.sh status
```

Goldband Loop workflow runtime:

```bash
./install.sh all-with-workflow
```

Native PowerShell installation is not maintained. On Windows, use Git Bash or
WSL from a full git checkout and run the same POSIX commands.

## Common Commands

```bash
./install.sh status            # Check install state
./install.sh pack-quality      # Claude Code core quality pack, no workflow runtime
./install.sh codex-full        # Codex full setup
./install.sh all-tools         # Claude Code + Codex
./install.sh all-with-workflow # Claude Code + Codex + Goldband Loop
./install.sh uninstall         # Remove installer-managed assets
```

Uninstall the plugin:

```bash
claude plugin uninstall goldband@goldband
```

Update:

```bash
git pull --ff-only
./install.sh status
```

After updating, rerun the install profile you use, such as `pack-quality`,
`all-tools`, or `all-with-workflow`.

## Important Boundaries

- Use a full git checkout; do not copy `install.sh` by itself.
- Claude plugin, Codex plugin, Claude app adapters, and installer full setup are
  different distribution surfaces. Do not describe one as replacing another.
- `./install.sh status` reads back install state. If the plugin and
  installer-managed Claude assets both exist, it reports duplicate assets.
- Hooks, rules, the cross-review gate, and sandbox are guardrails and evidence
  gates, not a security boundary against a same-permission host user. Managed
  worktrees are a narrower exception: an OS sandbox blocks Git-metadata writes
  by the agent process, while the host user remains able to manage and finish
  the work outside that sandbox.
- `all-with-workflow` installs and verifies the Goldband Loop browser runtime.
  Offline or CI runs can explicitly set `GOLDBAND_SKIP_PLAYWRIGHT=1` to skip
  browser workflows.

## Workflow Entry Points

After installing Goldband Loop:

- Claude Code: `/goldband <capability> <action>`
- Codex: `$goldband <capability> <action>`

The supported capability/action list is generated in
[docs/generated/capabilities.md](docs/generated/capabilities.md).

Parallel agent worktrees use two user-triggered commands:

```bash
goldband worktree create task-name
# Start one agent in the managed shell; Goldband remains the outer hard boundary.
claude --settings '{"sandbox":{"enabled":false}}'
codex --sandbox danger-full-access
# Exit when done.
goldband worktree finish task-name -m "feat: integrate task"
```

`create` requires a clean source worktree on a normal branch and creates a
detached worktree without a task branch. Working files stay writable inside the
managed shell, while the OS sandbox keeps Git indexes, objects, and refs
read-only together with broker runtime and Git config/hook inputs. Run `finish`
only after leaving the managed shell. The broker uses a pinned Git executable,
isolated config environment, and the source-owned hook contract recorded by
`create`; a collision between source ignored content and the candidate tree
stops integration. Goldband removes the worktree only after validation,
integration, and durable-commit readback all succeed. macOS uses Seatbelt,
Linux uses bubblewrap, and unavailable boundaries fail closed. Windows does not
currently claim hard enforcement. Disable the agent's inner OS sandbox as shown
above to avoid unsupported nesting; normal permission prompts and Goldband hooks
remain active, while the outer managed boundary continues to deny Git writes.

## Development

The repo-root default aggregate test entrypoint is:

```bash
npm run bootstrap:test # after the first clone, lockfile changes, or installer migrations
npm test
# or
bun run test
```

`bootstrap:test` installs the dependencies declared by the root, `mcp/server`,
and `goldband-loop`, then removes entries from ignored host skill roots only
when a tracked retired inventory or managed marker proves ownership. Unknown
same-prefix skills are preserved. `npm test` itself does not access the network or
silently mutate the checkout. It checks dependencies, the minimum Bun version,
and legacy artifacts before running an explicit set of package-owned suites and
printing a final per-suite summary. List the suites with:

```bash
npm run test:repo:list
```

Do not treat bare `bun test` at the repo root as repository verification. It
bypasses package-owned test contracts, recursively scans files, and has no
per-package summary.

Common targeted gates:

```bash
npm run test:plugin-distribution
npm run test:app-support
npm run test:hook-router
npm run test:cross-review
npm run lint:style
```

After changing sources that feed the Claude plugin:

```bash
node scripts/sync-plugin-assets.mjs
npm run test:plugin-distribution
```

After changing Codex plugin or Claude app adapter sources:

```bash
npm run sync:app-support
npm run test:app-support
```

For contributor workflow details, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation Map

- [ARCHITECTURE.md](ARCHITECTURE.md): root goldband, Claude/Codex surfaces,
  Goldband Loop ownership, and runtime contracts.
- [OPERATIONS.md](OPERATIONS.md): install operations, Codex overlays, style
  gate, MCP, telemetry.
- [CONTRIBUTING.md](CONTRIBUTING.md): development flow and plugin distribution
  checks.
- [docs/generated/capabilities.md](docs/generated/capabilities.md): Goldband
  Loop capability/action catalog.
- [goldband-loop/README.md](goldband-loop/README.md): workflow runtime entry
  point.
- [mcp/README.md](mcp/README.md): MCP templates and first-party
  `goldband-mcp`.
- [sandbox/THREAT-MODEL.md](sandbox/THREAT-MODEL.md): what the container
  sandbox does and does not protect.
- [docs/knowledge-system.md](docs/knowledge-system.md): local knowledge layer.
- [docs/DECISIONS.md](docs/DECISIONS.md): decision records.

## License

MIT License.
