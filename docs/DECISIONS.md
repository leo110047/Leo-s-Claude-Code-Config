# Goldband Decisions

## 2026-07-16: Repository Runtime Tests Require Bun 1.3.11 and Explicit Bootstrap

Decision: treat Bun 1.3.11 as the minimum supported Goldband Loop runtime and
make repository test setup an explicit, deterministic bootstrap step. The root
test entrypoint remains offline and non-mutating; it fails early with one
remediation command when declared dependencies, the Bun minimum, or retired
ignored host artifacts are not ready.

Implementation contract:

- `goldband-loop/package.json` owns the Bun minimum and exact package-manager
  version. Setup reads the minimum from that contract and rejects older Bun
  before build, cleanup, or install side effects.
- CI pins the same Bun release on every platform. macOS runs the focused real
  PTY/WebSocket test plus the workflow and complete free runtime suites.
- `npm run bootstrap:test` installs the root, `mcp/server`, and
  `goldband-loop` lockfiles with their package-native installers. It also
  removes entries from ignored legacy host skill roots only when the shared
  retired inventory or a managed marker proves Goldband ownership. The root
  `goldband` skill, unrelated entries, and unknown same-prefix skills remain.
- `npm test` performs an offline preflight and reports all missing prerequisites
  before starting the fail-fast suite runner. Focused `--suite` runs remain
  available for diagnostics without requiring unrelated package setup.

Assumptions:

- Bun 1.3.11 or newer preserves the verified macOS PTY and WebSocket behavior.
- `npm ci` and `bun install --frozen-lockfile` remain the authoritative clean
  installers for their respective lockfiles.
- The tracked retired-entry inventory remains the authoritative migration list;
  new managed entries carry an explicit marker instead of claiming a prefix.

Consequences:

- A checkout that only ran root `npm ci` now gets a precise MCP/Loop dependency
  error instead of failing later because nested `tsc` is absent.
- Developers run one explicit bootstrap after clone, lockfile changes, or
  installer migrations; ordinary test reruns do not access the network or
  silently rewrite the checkout.
- Bun 1.2.x is no longer advertised as supported. Environments pinned below
  1.3.11 must upgrade before setup or the full runtime suite.
- macOS CI takes longer because it now owns the same runtime confidence expected
  from Linux instead of validating only installer and Playwright setup paths.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep `engines.bun >=1.0.0` and patch only the two tests | The failures reproduce in Bun 1.2.21 but pass unchanged in 1.3.11; weakening the runtime tests would preserve a false support claim. |
| Let `npm test` install missing dependencies automatically | Makes a validation command networked and mutating, and hides checkout/bootstrap drift. |
| Convert the root package to mixed npm/Bun workspaces | Does not give npm authoritative ownership of the Bun lockfile and expands the packaging change beyond the failure. |
| Ignore legacy generated host artifacts in contract tests | Leaves removed public entrypoints on upgraded checkouts and makes installed state differ from clean state. |

Failure signals:

- A supported Bun release fails the focused macOS PTY/WebSocket round trip.
- CI, setup instructions, `packageManager`, and `engines.bun` name different
  Bun versions.
- `npm run bootstrap:test && npm test` fails on a clean supported checkout due
  to missing declared dependencies or ignored legacy artifacts.
- Cleanup removes the root `goldband` skill, unrelated host entries, or unknown
  same-prefix entries without a managed marker.

Revisit triggers:

- A newer Bun release is adopted after the same cross-platform suite passes.
- Bun documents a lower stable release with equivalent PTY/WebSocket behavior
  and the focused test verifies it on macOS.
- The repository adopts one package manager and lockfile owner for all nested
  packages, making the explicit multi-package bootstrap unnecessary.

## 2026-07-16: Managed Agent Worktrees Use an OS Sandbox and Brokered Finish

Decision: keep the public worktree interface to `goldband worktree create` and
`goldband worktree finish`. `create` opens the agent inside a host OS sandbox
where working files are writable but all Git metadata and the source worktree
are read-only. `finish` is the only Git-writing path and runs outside that
sandbox after the user exits the managed shell.

Implementation contract:

- Leases, locks, scratch indexes, checkouts, and finish evidence live under the
  canonical real path of the declared Goldband state root at
  `~/.goldband/worktrees/` by default. Every lease, policy, and validation path
  uses that same canonical root, including macOS `/var` to `/private/var`
  resolution and user-supplied symlink aliases.
- The lease records canonical repository, source branch/worktree, base commit,
  common Git directory, per-worktree Git directory, enforcement boundary, and
  evidence target. Control files are owner-only.
- `create` accepts only a clean source worktree on a normal branch, creates a
  detached worktree, creates no branch, and probes the boundary before exposing
  the interactive shell.
- macOS uses Seatbelt to deny writes to source/Git/control state and every
  recorded broker input. Linux uses a read-only root through bubblewrap. Both
  expose a separate writable agent scratch directory while broker scratch stays
  read-only to the agent. Unsupported platforms, missing runtimes, failed
  probes, and nested hosts that cannot establish the boundary fail closed
  instead of falling back to hook-only enforcement.
- Claude Code and Codex run inside the same inherited process boundary. Their
  PreToolUse adapters and the global `pre-commit` hook are early diagnostics,
  not authorization owners.
- The managed shell instructs Codex to use `--sandbox danger-full-access` and
  Claude Code to apply `sandbox.enabled=false`. This disables only the nested
  OS sandbox that macOS cannot reliably establish; ordinary permission prompts
  and hooks remain active, and neither setting can bypass the outer boundary.
- `finish` validates the lease/marker, unchanged branch/base, clean source,
  Git locks, detached managed HEAD, tracked/untracked changes, and ignored
  files. It also compares source ignored paths with the prepared candidate tree
  immediately before integration. A file/directory collision stops and
  preserves the worktree, so ignored source content cannot be overwritten or
  removed by `updateInstead`.
- A broker-owned temporary index and object directory create the candidate in
  lease scratch. A local `receive-pack` quarantines those objects, accepts only
  a fast-forward of the checked-out original branch, and updates its clean
  worktree. Failed receives do not promote the candidate into the source object
  store. The managed worktree is removed only after commit, tree, branch, and
  clean-worktree readback succeed.
- At `create`, the broker pins a canonical trusted Git executable, captures the
  user identity, resolves only source/common-Git-owned local config and hook
  paths, and records their digest. The outer OS policy makes that executable,
  Goldband runtime, source config/hooks, global Git config inputs, and installed
  launcher/runtime paths read-only to the agent.
- At `finish`, every broker Git subprocess uses the pinned executable and an
  allowlisted environment with isolated `HOME`/XDG config, ignored system and
  global Git config, fixed identity, trusted `PATH`, and explicit hook/fsmonitor
  settings. The local receiver additionally pins the source-owned `hooksPath`,
  rejects non-fast-forwards, and uses `updateInstead`. The client-side
  `pre-push` hook remains disabled; receiver-side hooks still run only from the
  recorded source-owned hook root.
- Integration and cleanup are recoverable states. Before durable integration,
  every failure preserves the worktree. After integration, the lease remains
  until cleanup and evidence persistence succeed. If the broker process stops
  after preparing a scratch candidate but before receive, the next `finish`
  discards that candidate and rebuilds it from the still-present worktree.

Assumptions:

- The user starts agents from the shell opened by `create` and runs `finish`
  only after exiting it.
- Seatbelt and bubblewrap continue to enforce restrictions on all descendants;
  a same-permission host user outside the sandbox is intentionally trusted.
- Source-branch movement and source-worktree edits are external concurrent
  changes and must stop, not merge heuristically.

Consequences:

- Direct `git commit`, `--no-verify`, absolute-path Git, scripts,
  `commit-tree`, `update-ref`, and index writes share one filesystem denial
  instead of depending on command parsing.
- Tests that need temporary files receive a lease-owned scratch directory.
  Tests needing arbitrary writes outside the worktree may fail and must not be
  granted Git metadata access as a workaround.
- A failed receive discards the scratch candidate and Git's receive quarantine,
  so the source repository gains neither an unreachable commit nor a temporary
  ref. The editable worktree remains available for retry.
- Windows installation can distribute the CLI, but `create` fails closed there
  until a verified native boundary is implemented.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| PreToolUse or `pre-commit` only | `--no-verify`, absolute Git paths, scripts, and plumbing commands bypass command-level checks. |
| chmod/ACL under the same user | The agent can restore permissions; it is not a durable authority boundary. |
| An environment-variable finish override | Agent-controlled environment is not authorization. |
| A normal task branch per worktree | Expands the public model and leaves refs the agent can mutate. |
| Automatic active-agent detection | Host session death is not reliable enough; the user explicitly starts finish. |

Failure signals:

- A boundary probe can write the `.git` pointer, worktree Git directory,
  common Git directory, source worktree, or lease-control state.
- A managed agent changes refs or index state with any Git executable or
  indirect script.
- A managed agent can modify the pinned Git executable, Goldband broker runtime,
  installed launcher/runtime, global Git config, or recorded source hook/config
  inputs after `create`.
- `finish` proceeds after source movement, dirty state, ignored files, Git lock
  contention, an ignored source/candidate collision, changed broker config,
  invalid marker/manifest, or failed readback.
- Claude and Codex installs expose different CLI or hook/runtime assets.

Revisit triggers:

- Codex or Claude exposes a stable host-owned broker API that can replace the
  inherited shell boundary without weakening it.
- Windows gains a verified filesystem sandbox with equivalent descendant and
  Git-metadata restrictions.
- Git gains an atomic worktree-aware transaction that can replace the current
  prepare/fast-forward/readback sequence.

## 2026-07-15: Installed Workflow Prompts Are Thin Manifest Contracts

Decision: generate every installed
`workflows/<capability>/<action>.workflow.md` from manifest-owned prompt contract
fields. Do not install generated legacy `SKILL.md` files as workflow prompts.

Implementation contract:

- Each capability owns concise relevant context, hard boundaries, and
  verification in `goldband.manifest.json`; the action description is its goal.
- `scripts/lib/workflow-contracts.mjs` validates and renders the prompt contract.
  Missing fields or prohibited shared boilerplate fail generation.
- `goldband-loop/generated/capability-actions.json` records `contractPath`.
  `goldband-loop/setup` installs only that path and fails when it is absent.
- Browser guidance is a separate on-demand manual selected by manifest-owned
  routing. It is not embedded in every workflow.
- The old per-workflow `SKILL.md`/`SKILL.md.tmpl`, resolver preamble, model
  overlays, and `sourceTemplate` field are retired. Programmatic runtime and
  installation both resolve the manifest-owned `contractPath`.
- Generator tests enforce a 2 KiB per-contract limit and 64 KiB aggregate limit.
  Clean-install tests compare installed content byte-for-byte with generated
  contracts and reject executable shell blocks or universal preamble sections.

Why:

- Current frontier models need a clear outcome and boundaries, not repeated
  onboarding, tool-selection scripts, telemetry prose, or writing-style manuals.
- Runtime-owned state and safety behavior should not be approximated by copying
  the same prose into every prompt.
- A small migration cleanup list lets setup remove Goldband-managed legacy
  entries without retaining their prompt sources or generator architecture.

## 2026-07-12: Remove the Unity-Specific Skill Pack

Decision: remove `skills/projects/unity/` and its installer surfaces completely.
Goldband keeps portable engineering workflows, but no longer owns or distributes
a Unity-specific project skill pack.

Implementation contract:

- `pack-unity` and `unity` are removed rather than retained as compatibility
  aliases; invoking either now follows the normal unknown-option failure path.
- Installer state, validation, examples, architecture inventory, and generated
  assets must not reference the removed pack.
- General C#, game, mobile, performance, testing, and architecture work may use
  portable skills. Reintroducing a Unity-specific capability requires a new
  product decision and complete installer and validation wiring.

## 2026-07-11: Rules Are Enforced by Independent Review

Decision: `rules/*.md` remains the policy-content source of truth. A
metadata-only `rules/manifest.json` selects applicable Rules for programmatic
code review. Each review reads the current Rule text once into an immutable
snapshot shared by its core prompt, specialist prompts, and prompt telemetry.
The next review creates a fresh snapshot.

Implementation contract:

- `hooks/scripts/lib/rules-resolver.js` is a pure read-only resolver. It
  validates complete manifest coverage, applies manifest-owned group selectors,
  reads the current source text, and returns content hashes.
- Claude and Codex review use the same resolver contract. Generated plugin
  copies and installed adapters are projections, not independent policy owners.
- Review fails closed when the manifest is incomplete, a Rule is missing, or
  the Rules payload exceeds its explicit byte budget.
- Deterministic gates verify manifest coverage, review prompt injection,
  generated asset drift, and installed runtime dependencies.
- Codex materializes the review resolver at
  `~/.codex/review-runtime/rules-resolver.js`; this path is independent of
  whether `~/.codex/hooks` is a symlink or copied directory.
- Semantic properties such as single authoritative truth, dead code, islands,
  and architecture boundaries belong to independent code review. They are not
  approximated by regex style gates or writer self-attestation.
- PreToolUse and Stop do not load, classify, or audit Rules. Goldband does not
  infer workspace ownership from arbitrary shell commands and does not maintain
  writer leases or semantic completion receipts.

## 2026-07-06: App Surface Support Uses Shared Config or Separate Adapters

Decision: support app surfaces without rewriting the existing CLI setup paths.
Codex app support uses the same shared Codex config surfaces as Codex CLI, while
Claude app support uses a separate MCP-based adapter instead of Claude Code
settings or hooks.

Why:

- Codex app, Codex CLI, and the Codex IDE extension share agent configuration,
  skills, and MCP settings through Codex config layers.
- Codex plugins are useful for a portable subset: skills plus optional app/MCP
  integration. They do not replace the installer-managed full Codex setup.
- Claude Desktop and Claude web/mobile connector support are app surfaces, not
  Claude Code runtime surfaces. They need a local extension or remote MCP
  connector, not copied Claude Code hooks.
- Goldband Loop remains installer-managed. It is too broad for the portable app
  adapter contract.

Implementation contract:

- `scripts/sync-app-support-assets.mjs` generates `.codex-plugin/plugin.json`,
  `.agents/plugins/marketplace.json`, `plugin-assets/codex-plugin/`, the Claude
  Desktop extension source, the remote connector template, and
  `docs/reports/app-support-expected-assets.json`.
- `scripts/build-claude-app-adapters.mjs` builds the local
  `goldband-local-extension.mcpb` package from the generated Claude Desktop
  extension source.
- `scripts/check-app-support.mjs` verifies generated drift, Codex plugin shape,
  repo marketplace shape, Claude Desktop package buildability, remote connector
  template shape, wrapper fail-closed behavior, and wording boundaries.
- `install.sh status` reports Codex app shared-config readiness, Codex plugin
  package availability, Claude Desktop local extension package/readback, and
  Claude remote connector template/readback separately.

External facts checked on 2026-07-06:

- Codex manual documents that Codex app agents inherit the same configuration
  as IDE and CLI, and that MCP configuration lives in `config.toml`:
  https://developers.openai.com/codex/codex-manual.md
- Codex manual documents plugins as bundles for skills, app integrations, and
  MCP servers, with repo and personal marketplace support:
  https://developers.openai.com/codex/codex-manual.md
- Claude support docs document remote MCP custom connectors for Claude web,
  mobile, and Desktop:
  https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- Claude support docs document local MCP servers for Claude Desktop and link
  Desktop Extensions for `.mcpb` packaging:
  https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop

## 2026-07-06: Claude Plugin as Primary Claude Core Distribution

Decision: distribute goldband's core Claude Code surface through a local
`goldband@goldband` plugin, while keeping `install.sh` as the developer, Codex,
and Goldband Loop workflow-runtime path. Codex plugin distribution is possible
for a Codex-specific subset, but it is not the current full-setup path.

Why:

- Claude Code plugins can package commands, skills, hooks, and marketplace
  metadata, which matches the external-user core surface better than manual
  installer setup.
- Goldband Loop is a heavier runtime with Playwright/browser/iOS dependencies;
  it remains installer-managed and is explicitly out of plugin scope.
- Codex has a plugin ecosystem, but this Claude plugin packages Claude Code
  assets. A Codex plugin could package a portable subset such as skills, MCP
  config, or app/workflow integrations.
- Goldband's Codex full setup also manages host-level assets:
  `codex/config.toml`, `codex/requirements.toml`, `codex/rules/`,
  `codex/hooks.json`, `codex/hooks/`, `codex/profiles/`,
  `codex/permission-profiles/`, `codex/agents/`, and Goldband Loop runtime
  assets. Those remain installer-managed until a Codex-specific distribution is
  designed and verified.
- Do not present Codex plugin support as Claude/Codex plugin parity or as a
  replacement for `install.sh codex-full`.

Implementation contract:

- `scripts/sync-plugin-assets.mjs` is the only writer for generated plugin
  assets under `plugin-assets/claude-code-plugin/`.
- `.claude-plugin/marketplace.json` points Claude Code at the generated plugin
  root; the repo root is not installed as the plugin package.
- `docs/reports/plugin-expected-assets.json` is the machine-readable expected
  asset list used by both drift and clean-home verification.
- `scripts/check-plugin-distribution.mjs` validates generated artifact drift,
  temp-HOME plugin install, installed command/skill/hook lists, and verifies the
  plugin cache does not contain `goldband-loop/`.
- `install.sh status` reports plugin/installer duplicate assets and exits
  non-zero rather than presenting a mixed install as all green.

External facts checked on 2026-07-06:

- Claude Code plugin docs document plugin directories, manifests, commands,
  skills, hooks, MCP servers, and marketplaces:
  https://code.claude.com/docs/en/plugins-reference
- Claude Code plugin marketplace docs document `.claude-plugin/marketplace.json`
  and `claude plugin marketplace add ./` for local marketplace installation:
  https://code.claude.com/docs/en/plugin-marketplaces
- Codex manual documents Codex plugins as bundles for Codex skills, apps, and
  MCP servers, with local marketplace support:
  https://developers.openai.com/codex/codex-manual.md

## 2026-07-05: Telemetry v1 and OTLP Export Boundary

Decision: keep JSONL as the telemetry source of truth and add OTLP as an
offline export layer.

Why:

- Hook execution must stay fast, offline, and dependency-free.
- Existing rotation and retention behavior already belongs to JSONL storage.
- OTLP export can be retried, scheduled, or dry-run without changing hook
  behavior.

Implementation contract:

- `scripts/lib/telemetry-schema.cjs` owns the v1 normalizer and validator.
- `schemas/telemetry.v1.schema.json` is the JSON Schema documentation artifact.
- Claude and Codex adapters write `schema_version`, `run_id`, and `event_id` on
  every new usage event while preserving legacy `sessionId`.
- `scripts/export-telemetry-otlp.mjs` reads JSONL and emits OTLP/HTTP JSON. It
  is not installed as a default daemon and does not run from hooks.

Run ID priority:

1. Explicit `run_id` / `runId` from the event.
2. Host hook `session_id` / `sessionId`.
3. Host env: `CLAUDE_SESSION_ID` for Claude, `CODEX_SESSION_ID` for Codex.
4. `GOLDBAND_RUN_ID` for explicit caller-controlled export/test runs.
5. `GOLDBAND_RUN_ID_FILE` for a caller-provided per-session marker file.
6. Claude transcript path hash when present.
7. `unknown`.

Codex note: the current Codex manual documents hooks and supported lifecycle
events, but this implementation did not find a public manual section that
documents a stable hook input session field. Goldband therefore treats
`session_id`, `sessionId`, and `CODEX_SESSION_ID` as the local observed adapter
contract. If a session launcher can provide `GOLDBAND_RUN_ID_FILE`, Goldband
will read or create a durable UUID there. Without a stable input or marker file,
it falls back to `unknown` rather than inventing a process-local ID.

Dependency choice: do not add `@opentelemetry/*` packages in this phase. The
OTLP spec supports OTLP/HTTP payloads encoded as JSON protobuf, so the exporter
builds the small traces payload directly. This avoids adding a dependency tree
to a repo whose default install surface does not need exporter runtime code.

External facts checked on 2026-07-05:

- Claude Code hooks reference documents `session_id`, `transcript_path`,
  `cwd`, and `hook_event_name` in hook inputs:
  https://docs.anthropic.com/en/docs/claude-code/hooks
- Codex manual hooks section documents hooks, lifecycle events, config shape,
  and command hook behavior:
  https://developers.openai.com/codex/codex-manual.md
- OpenTelemetry OTLP spec 1.10.0 documents OTLP/HTTP JSON-encoded protobuf and
  `/v1/traces` as the default trace path:
  https://opentelemetry.io/docs/specs/otlp/
- OpenTelemetry GenAI semantic conventions have moved to
  `open-telemetry/semantic-conventions-genai` and are marked Development:
  https://github.com/open-telemetry/semantic-conventions-genai

## 2026-07-08: Knowledge Lifecycle Trust Boundary

Decision: keep curated knowledge as local markdown plus `index.json`, and make
automatic capture candidate-only until explicit review promotes it.

Why:

- Workflow evidence, hook telemetry, and telemetry miner output are useful raw
  signals, but they can include stale context, host-specific noise, or
  prompt-injection shaped text.
- Default recall feeds future agent context, so it must not treat unreviewed
  candidates as trusted rules.
- A second persistent store would make lifecycle and install behavior harder to
  verify across Claude, Codex, MCP, and workflow templates.

Implementation contract:

- Automatic capture writes `status: candidate` with a deterministic
  `<source_type>-<YYYYMMDD>-<hash8>` id based on source type, sanitized source
  pointer, and summary.
- Duplicate candidate ids are skipped and never overwrite a file that may have
  been manually edited.
- `goldband-knowledge-review` is the explicit review surface for list, show,
  promote, edit, retire, and graduate actions.
- Default CLI, resolver, and MCP recall use `status=active`; candidate recall
  requires explicit candidate review or `--status candidate`.
- Frontmatter carries `source_evidence`, `trust_level`, `reviewed_by`,
  `last_verified`, `staleness`, and `graduated_to`.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Auto-promote verified workflow findings | Too easy to turn host-specific or stale findings into future rules without human review. |
| Store knowledge in a vector database | Outside the local-first, inspectable first-party runtime boundary for this phase. |
| Merge learnings, telemetry candidates, and curated knowledge into one store | Blurs raw evidence, append-only memory, and reviewed knowledge lifecycles. |

Failure signals:

- Default recall returns candidate entries without explicit candidate status.
- Knowledge entries accumulate without review, graduation, or retirement.
- `install.sh status` claims host parity when a host only has advisory or CLI
  exposure.
- Sanitizer tests stop covering secret-shaped and instruction-like content.

## 2026-07-13: Capability Manifest and Model-Native Prompt Boundary

Decision: expose one capability-based interface, `$goldband <capability>
<action>`, with no aliases for historical workflow names. Keep capability and
policy metadata in `goldband.manifest.json`; generate registry, routing hints,
inventory, policy projection, router menu, and capability docs from it.

Prompt contract:

- Shared prompts contain only the goal, relevant context, hard boundaries, and
  verification that can change the result.
- The model owns semantic reasoning, decomposition, tool selection, and
  adaptation.
- Runtime owns routing, authorization, outward-facing and irreversible action
  gates, typed evidence, stop conditions, state, and observability.
- Browser instructions and workflow contracts are read on demand. They are not
  embedded in the root skill or repeated in every prompt.

Why:

- OpenAI's prompting guidance recommends starting from the desired result,
  adding only useful context and a few boundaries, and leaving room for the
  model to choose tools and adjust its approach.
- The old catalog duplicated names and policy across generated skills, hooks,
  registry code, inventory, and docs. Those copies drifted and consumed model
  context without adding deterministic enforcement.
- Keeping old aliases would preserve the duplicate public contract and prevent
  missing migrations from failing visibly.

Migration contract:

- Standard installs expose only `goldband`.
- Installer cleanup removes Goldband-managed historical skill entrypoints.
- Internal documents use `workflows/<capability>/<action>.workflow.md`.
- Unknown historical names fail; they never redirect silently.
- `node scripts/generate-goldband-surfaces.mjs --check` is the freshness gate.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Preserve every old name as an alias | Keeps the catalog and migration burden alive indefinitely. |
| Keep routing tables handwritten per host | Recreates drift between Claude, Codex, hooks, runtime, and docs. |
| Put every workflow and browser instruction in root `SKILL.md` | Pays the context cost before the instructions are relevant and over-constrains model-native reasoning. |

## 2026-07-13: CI Boundary Owners Must Verify Their Completion Contracts

Decision: deterministic infrastructure boundaries own their complete outcome.
Callers and tests must not compensate for an incomplete owner contract with
sleep calls, partial spot checks, or undeclared tool dependencies.

Implementation contract:

- `process-supervisor.mjs` does not resolve forced termination until the whole
  process group is gone or a bounded cleanup verification fails explicitly.
- Codex high-risk shell policy separates unquoted shell command boundaries
  before command-local flags and targets are classified. Cross-command flag
  leakage is never treated as evidence of a destructive command.
- `check-codex-portability.sh` uses only declared baseline dependencies. Missing
  inputs and scanner errors fail closed with a distinct infrastructure error.
- `generated/capability-actions.json` owns the complete installed workflow
  document set. Clean-install verification compares the exact projection for
  both Claude and Codex instead of checking one representative file.
- Workflow installs record the canonical source path together with a contract
  fingerprint derived from the capability contract and its projection logic.
  `install.sh status` verifies against that same source, reports drift even when
  the human-readable version did not change, and fails explicitly when the
  recorded source is no longer available.

Assumptions:

- POSIX process groups remain the process-tree authority on macOS and Linux;
  Windows continues to use `taskkill /T`.
- The shell hook is a conservative lexical policy adapter, not a general shell
  interpreter. Compound rules that intentionally span a pipe remain explicit.
- `cksum`, `awk`, and `grep` are available in supported installer and CI shells.

Consequences:

- CI failures identify the owning boundary: cleanup, policy classification,
  portability scanning, or install projection.
- Forced process cleanup can take up to the bounded confirmation window before
  returning, and a surviving tree becomes an explicit failure.
- Changing workflow projection logic makes existing installs stale until the
  relevant workflow installer is rerun.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Add a delay to the flaky descendant test | Moves lifecycle responsibility into consumers and remains timing-dependent. |
| Allow the hook false positive manually | Leaves the classifier structurally unable to distinguish command boundaries. |
| Install `rg` in CI only | Keeps an unnecessary undeclared dependency in a baseline portability gate. |
| Check only `review/code.workflow.md` and the version marker | Cannot detect partial or same-version stale installs. |

Failure signals:

- A supervisor result returns while `process.kill(pid, 0)` still succeeds for a
  descendant in the supervised group.
- Safe adjacent shell commands can combine their flags into a denial.
- A missing portability scanner or input still prints `[OK]`.
- `install.sh status` reports green for a legacy flat workflow layout.
- A runtime installed through `GOLDBAND_LOOP_DIR` is compared against a
  different repository, or its missing recorded source is silently ignored.

Revisit triggers:

- Supported platforms provide a stronger native process-tree completion API.
- Shell policy expands to constructs that require a maintained parser rather
  than the current bounded lexical adapter.
- Workflow projections move out of `goldband-loop/setup` into a standalone
  materializer with its own stable contract version.

## 2026-07-13: Hooks Emit Only for Actionable Runtime Decisions

Decision: hook output is reserved for an enforcement decision, a state
transition that requires attention, or advice tied to the current action.
Generic workflow reminders and durable engineering policy stay in workflow
entrypoints, skills, and repository instructions instead of lifecycle hooks.

Implementation contract:

- `SessionStart`, `SessionEnd`, `PreCompact`, `PostCompact`, and generic
  `PostToolUseFailure` reminders are not registered and emit no output when
  evaluated directly.
- Hook events with no implementation are not registered merely to display a
  status message.
- Context restore remains an explicit Goldband workflow. Starting or resuming
  an unrelated session does not imply that restoration is needed.
- Prompt routing requires a capability-specific trigger. Generic words such as
  `檢查` do not activate review guidance by themselves.
- Context saturation guidance is emitted once when entering warning severity
  and once when entering critical severity, not every fixed number of calls.
- Ordinary `Stop` events do not produce desktop notifications or repeat style
  scans. Permission and elicitation notifications, immediate edit advisories,
  and deterministic stop blockers remain active.

Assumptions:

- Hosts already preserve their own session and compaction continuity.
- Durable verification policy is loaded through system, repository, and skill
  contracts, so repeating it on the first prompt adds noise rather than safety.
- A silent allow outcome is distinguishable from a failed hook through exit
  status and existing verification tests.

Consequences:

- New sessions and compaction transitions stay quiet unless a real decision is
  required.
- Hook authors must justify output against an explicit action or state change.
- Users invoke context restore when resuming handoff-sensitive work instead of
  receiving the reminder in every session.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Deduplicate generic reminders once per session | Still interrupts unrelated sessions and requires persistent marker state for no runtime decision. |
| Keep all reminders but shorten their text | Reduces message size without fixing frequency or ownership. |
| Disable every advisory hook | Removes useful permission, safety, and action-specific feedback together with the noise. |

Failure signals:

- Starting, resuming, compacting, or ending an otherwise idle session injects
  Goldband guidance.
- A generic request containing `檢查` suggests an unrelated review workflow.
- Warning-level context monitoring repeats without a severity transition.
- An ordinary assistant stop produces a desktop notification or repeats a
  repository-wide style advisory.

Revisit triggers:

- A host stops preserving required state across resume or compaction and the
  failure cannot be solved at the state owner.
- A lifecycle transition gains a concrete user decision or deterministic
  enforcement contract that cannot be expressed elsewhere.

## 2026-07-16: Capability Surface Requires Proven Runtime Ownership

Decision: reduce the formal capability inventory from 51 actions to 23. Expose
19 public actions and retain four high-risk actions only as hidden experimental
inventory. A runnable action must declare one runtime owner in the manifest;
an experimental action cannot claim an owner.

Implementation contract:

- Remove 28 overlapping action names instead of preserving aliases. Their
  useful behavior becomes a mode, lens, command, or stage of the remaining
  review, plan, browser, document, safety, and iOS owners.
- Generated routing and activation hints contain only public actions.
  Experimental actions remain in the engineering inventory and thin contract
  projection, but are not discoverable or runnable.
- Typed owner steps validate structured input, write JSONL evidence, persist
  state atomically where state exists, and return explicit completed or blocked
  readback.
- Compatibility actions remain mock-only and fail closed in real mode.
- High-risk work cannot hide outward side effects inside a workflow child
  process. In particular, `system/upgrade` owns preflight and readback while the
  host's native tool and approval layer owns `git pull` and setup execution.

The resulting inventory is 15 typed, four compatibility, and four experimental
registered-only actions. The experimental set is `release/land`,
`release/setup`, `knowledge/setup`, and `knowledge/sync`.

Why:

- A prompt contract and formal name are not runtime capability. Without an
  owner, validated state, evidence, and a stop condition, the interface
  overstates product maturity.
- Separate lifecycle from runtime maturity. This keeps high-risk work visible
  to maintainers without advertising unfinished operations to users.
- Folding lenses and phases into stable owners reduces routing ambiguity and
  migration cost while preserving the underlying behavior.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep all 51 actions and label 46 experimental | Leaves the oversized public vocabulary and duplicate ownership model intact. |
| Change only manifest runtime labels | Produces typed-looking entries with no action-specific validation, state, or evidence owner. |
| Preserve removed actions as compatibility aliases | Violates the no-alias capability decision and keeps old contracts alive indefinitely. |
| Let `system/upgrade` run `git pull` after an input boolean | A JSON field is not native host approval and would hide an outward side effect inside Bun. |

Failure signals:

- Router or activation output contains an experimental action.
- A runnable manifest action has no owner, or a registered-only action claims
  one.
- Removed action names return through active documentation or generated
  contracts.
- A typed owner accepts malformed real-mode input, writes non-atomic state, or
  reports completion without readback evidence.
- High-risk runtime code executes a network, release, setup, or sync side
  effect behind the host permission boundary.

Revisit triggers:

- Release obtains a deployment-neutral approval, rollback, and readback owner.
- GBrain setup and sync obtain secret-safe interaction schemas plus resumable
  checkpoint and round-trip verification contracts.
- Compatibility actions gain action-specific typed schemas and real-mode
  evidence.

## 2026-07-16: Runtime Completion Must Reflect Effective Host State

Decision: host-scoped workflows may report completion only after reading back
the state that the host actually consumes. Public menus are generated per host,
and runtime invocation independently enforces manifest `hostSupport`.

Implementation contract:

- `safety/guard`, `safety/freeze`, and `safety/unfreeze` are Claude-only and
  delegate to the existing session-scoped careful-mode and freeze-mode owner.
  Completion requires owner readback; an actual PreToolUse `Edit` regression
  test proves freeze enforcement.
- `system/health` inspects the selected host's installed runtime under `HOME`,
  including required files, `.installed-source`, `.installed-contract`, and
  source/install fingerprint drift. Source checkout health is not installation
  health.
- `plan/create` remains Claude-only. Codex menus, hints, and planner guidance do
  not advertise it, while runtime rejects a Codex invocation.
- `document/generate` owns a typed `audit` mode with required unified-diff input,
  deterministic coverage and PR-section artifacts, and a native approval gate
  for PR mutation. The workflow does not generate documentation or mutate PRs.
- Context checkpoint indexes include repository/worktree identity and branch;
  restore selects the current branch's latest checkpoint.
- Active-document tests validate local Markdown link targets, not only
  capability invocation strings.

Failure signals:

- A safety action is completed while the corresponding hook decision still
  allows the protected operation.
- An empty or stale installed runtime passes `system/health` because source
  files are healthy.
- A host menu advertises an action excluded by its manifest `hostSupport`.
- Documentation audit mutates a PR without native approval or claims it wrote
  docs that it only analyzed.
- Saving branch B makes branch A's latest checkpoint unreachable.

## 2026-07-16: High-Risk Operations Require Verifiable Runtime Gates

Decision: keep one manifest-owned safety contract for each of the nine
high-risk operations identified before capability convergence. A retired action
name may remain only as an internal operation ID mapped to its active action and
mode; it does not become a public route or compatibility alias.

Implementation contract:

- `release/land`, `release/setup`, `release/canary`, `browser/cookies`,
  `knowledge/setup`, `knowledge/sync`, `system/upgrade`, `ios/qa`, and
  `ios/sync` each declare authorization, preconditions, side effects, readback,
  enforcement state, and gate owner in `goldband.manifest.json`.
- Every high-risk action must have a primary gate. Nested high-risk modes on a
  lower-risk action require their own operation gate.
- A registered-only action cannot declare `runtime-owner` enforcement. A
  runtime-owned gate must match the action's declared runtime owner.
- `blocked-before-runtime` is executable policy: browser cookie commands and
  the iOS sync mode stop during runtime admission before an owner step runs.
- `system/upgrade` and read-only `ios/qa` have operation-specific verifiers.
  Definition fails when their declared preconditions, side effects, readback,
  authorization, or owner drift from the implemented verifier contract.
- Runtime input validation happens before the owner. A gate writes successful
  `verified` evidence only after the owner output and trusted artifact satisfy
  every declared readback. A blocked or mock-only owner writes `pending` with
  `skipped` status, never successful gate evidence.
- `ios/qa` requires an explicit project, scheme, device scope, and supplied QA
  checks. It never fabricates mock passing evidence and reports untested device
  coverage in the trusted QA artifact.
- `system/upgrade` requires an explicit preflight or readback phase. Preflight
  remains pending through native approval; only a matching completed preflight,
  version/head transition, and setup readback can verify the gate.
- Generated capability contracts and documentation include the safety
  inventory so installer fingerprints and source checks detect drift.

Why:

- A prompt instruction to ask for approval is not an enforcement boundary.
- Restoring removed action aliases would undo capability convergence, while
  forgetting their risk contracts would make future modes easier to integrate
  unsafely.
- Owner identity alone is not safety evidence. Contract inputs, owner output,
  provenance-bound artifacts, and readback must agree before verification.

Failure signals:

- A high-risk action has no primary gate or two actions claim the same safety
  operation.
- A registered-only operation claims an owner or becomes runnable.
- Cookie import or iOS synchronization reaches an owner step while its gate is
  blocked.
- A typed high-risk action records `verified` before its declared readback is
  validated, or a blocked/mock execution records successful gate evidence.
- A runtime-owner gate declares a contract item its operation-specific verifier
  does not implement.
- Retired operation IDs reappear in generated menus or routing hints.

Revisit triggers:

- A blocked operation gains a typed owner that implements every declared
  precondition, authorization boundary, side effect, and readback requirement.
- A high-risk operation is removed entirely rather than retained as a mode of
  an active action.

## 2026-07-20: Interactive Review Must Enter the Typed Runtime

Decision: an interactive Codex or Claude `$goldband review code` invocation
must launch the executable review owner before reporting findings. The thin
workflow contract selects the runtime; it does not perform a second manual
review in the parent agent.

Implementation contract:

- `bin/goldband review code --host <codex|claude>` is the public launcher. It
  forces real mode and defaults to the whole current worktree when the user
  does not name a narrower scope.
- The launcher resolves `workflows/run.ts` from the active source root or the
  installed runtime's `.installed-source`; missing runtime ownership fails
  explicitly.
- User-supplied prompt text never proves runtime ownership. Runtime-owned child
  prompts use the dedicated non-router `GOLDBAND_RUNTIME_TASK=review/code`
  header, perform the supplied review inline, and never invoke `$goldband`
  again.
- The launcher probes the evidence root before starting. If the default
  `~/.goldband` root is blocked by the caller's filesystem sandbox, it uses a
  private temporary state root and reports the evidence as ephemeral. An
  explicitly configured state root remains fail-closed when it is not writable.
- A Codex parent session requests host-native sandbox escalation for the
  launcher command before execution. Codex applies its command sandbox to all
  descendants, while the nested `codex exec` CLI must initialize Codex state
  and app-server resources. This one parent-session admission is separate from
  child reviewer command approval; the child remains read-only with approval
  set to `never`.
- Codex subprocesses use `--ask-for-approval never` with the read-only sandbox.
  Core and specialist prompts prohibit `require_escalated`; blocked dynamic
  verification is reported as unavailable instead of attempting an approval
  flow that non-interactive `codex exec` cannot service.
- Codex reviewers also use `--ignore-user-config`, an explicit empty
  `mcp_servers` override, and `--ephemeral`. Authentication still comes from
  `CODEX_HOME`, but user/project customization cannot expose external MCP tools
  or persist a reviewer session.
- Claude subprocesses use `--safe-mode` plus a read-only tool allowlist so
  repository or user hooks, plugins, MCP servers, and other executable
  customizations cannot create side effects. The prompt tells the reviewer to
  inspect applicable `AGENTS.md` and `CLAUDE.md` files explicitly with read-only
  tools because safe mode disables their automatic loading.
- Review input is bounded to 2 MiB. Git collection uses an explicit larger
  process buffer and converts overflow into a scope-narrowing error instead of
  leaking the host runtime's `ENOBUFS` failure.
- Review scope is validated by one shared contract at both the public launcher
  and typed runtime boundary. `--base --worktree` is the only valid combined
  primary scope; `--include-untracked` is a modifier but cannot be combined
  with `--diff-file`, which is already a complete supplied artifact.
- Complete-pass deadlines use `performance.now()` from pass creation through
  every Git and host timeout. Wall-clock timestamps remain evidence metadata
  only, so system-clock changes cannot extend the runtime budget.
- Untracked paths are collected with `git ls-files -z` and parsed on NUL
  boundaries. Legal filenames containing newlines, tabs, quotes, or backslashes
  therefore reach the same containment and content checks as ordinary paths.
- Core and specialist prompts are delivered over child stdin, never as command
  arguments. The full 2 MiB input contract therefore does not depend on the
  host operating system's smaller `ARG_MAX` limit.
- `--diff-file` and untracked-file collection accept only stable regular files.
  They reject symbolic links and special files, validate the opened inode, and
  read through that same no-follow file descriptor. Descriptor metadata is
  checked again after the final read so pathname swaps and same-inode writes
  both fail closed instead of producing mixed review input.
- An automatic launcher or runtime failure is terminal. The parent agent must
  not silently fall back to an untyped manual review or claim complete
  coverage.
- Ordinary review keeps automatic specialist selection. A strict or exhaustive
  request explicitly adds `--specialists all`, whose incomplete coverage fails
  closed.
- A real host call defaults to twelve minutes. A complete review pass is bounded
  to twelve minutes with specialists off, twenty minutes in auto mode, and
  thirty minutes only for explicit `--specialists all` coverage. Validated CLI
  overrides may narrow or extend those budgets within 60 to 1800 seconds; the
  host-call timeout cannot exceed the pass timeout.

Assumptions:

- Codex and Claude continue to honor selected skill contracts and can execute
  the installed `bin/goldband` launcher.
- The workflow installer keeps `.installed-source` authoritative for copied
  minimal runtimes.
- Real host review remains read-only and structured through the existing host
  adapters.

Consequences:

- Interactive review now uses deterministic diff collection, typed finding
  validation, runtime evidence, and the selected specialist policy.
- A normal review invocation may take longer and consume additional host model
  calls; exhaustive specialist review costs more and remains explicit.
- Normal auto reviews fail within a bounded twenty-minute pass instead of silently
  inheriting the exhaustive thirty-minute ceiling. Timeout telemetry makes
  later tuning evidence-driven rather than another hard-coded guess.
- An optional auto specialist reaching the pass deadline degrades to a recorded
  coverage diagnostic while preserving completed core findings. Explicit
  exhaustive coverage still fails closed when any specialist is incomplete.
- Hosts outside Codex and Claude continue to use their supported prompt path
  until they gain a real typed adapter.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep the thin skill as a manual checklist | Leaves runtime entry, scope, evidence, and specialist dispatch dependent on model discretion. |
| Launch the runtime from a prompt-routing hook | Generic review hints can fire for explanatory questions and are not the owner of long-running model subprocesses. |
| Put a raw `bun workflows/run.ts` command in every installed contract | Couples prompt surfaces to source layout and breaks copied minimal runtimes. |
| Silently fall back when the launcher fails | Produces a review that looks complete without typed runtime evidence. |
| Keep one two-minute timeout for every mode | The measured real Codex pass exhausted it before producing findings, while it provided no whole-pass budget for specialist fan-out. |
| Give every review a thirty-minute timeout | Makes ordinary review stalls too slow to diagnose and hides prompt or dispatch regressions. |

Failure signals:

- `$goldband review code` returns findings without a real-host runtime report or
  artifacts.
- A runtime-owned reviewer starts another `goldband review code` process.
- A copied installation cannot resolve the executable workflow source.
- Launcher failure is followed by an untyped manual approval.
- Auto review approaches its twenty-minute deadline or repeatedly exhausts the
  twelve-minute host-call budget.

Revisit triggers:

- Codex or Claude provides a native skill-to-executable binding that removes
  the need for a prompt-directed launcher.
- A host supports typed review directly without spawning its CLI adapter.
- Measured cost or latency justifies a different default specialist policy.
- At least twenty comparable real-host runs provide a stable latency
  distribution that justifies replacing the initial timeout budgets.

## 2026-07-21: Codex Config Freshness Follows Key Ownership

Decision: treat the generated Codex config as a shared file with key-level
ownership. Goldband requires every key/value emitted by `codex/config.toml` and
`codex/local/config.toml` to remain present with the expected value, but it does
not claim additional keys or tables written by Codex App. Host-maintained
`marketplaces.*.last_updated` values are explicitly volatile and excluded from
freshness comparison.

Implementation contract:

- `is_current_generated_codex_config` keeps the generated header as the file
  identity check, validates the complete installed file with Python `tomllib`,
  then compares a deterministic projection of Goldband-owned TOML records
  instead of comparing the complete file text.
- Missing Python 3.11+ `tomllib` support makes syntax health `unverifiable` and
  exits `2`; syntax validation never degrades to a permissive text scan.
- Additional root keys, table keys, MCP servers, plugins, and desktop settings
  are allowed because absence from Goldband source means Goldband does not own
  them.
- Missing or changed Goldband-owned records still report `stale` and make
  `install.sh status` exit `2`.
- Every Goldband-owned table/key must occur exactly once; duplicate managed
  keys fail closed even when one duplicate retains the expected value.
- Codex profile files retain their stricter source comparison because they are
  policy artifacts, not shared App configuration. Only their declared runtime
  state sections are excluded.
- App-support status reuses the same freshness predicate; it does not maintain
  a second ownership policy.

Assumptions:

- Goldband's generated main config continues to use single-line TOML
  assignments for owned values.
- A Python 3.11+ entrypoint is available as `python3`, `python`, or Windows
  `py -3` when a green config health verdict is required.
- Codex App may add or reorder valid TOML content but does not remove or rewrite
  Goldband-owned values without creating meaningful drift.
- Marketplace update timestamps remain host-maintained metadata rather than
  Goldband policy.

Consequences:

- Codex App integrations can evolve without causing false stale status or
  encouraging users to overwrite working App configuration.
- Invalid installed TOML is reported separately from source drift, before any
  ownership comparison can return `[OK]`.
- Goldband still detects policy drift in models, approvals, sandboxing,
  features, agents, local project trust, and other source-declared values.
- New multiline Goldband-owned values require extending the projection parser
  and its regression coverage before they can be used safely.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep whole-file comparison and enumerate every App-generated block to strip | Couples Goldband to volatile App implementation details and recreates false positives whenever the App adds a field. |
| Treat the generated marker as sufficient | Misses real changes to Goldband-owned policy. |
| Reinstall the repo config whenever App content appears | Can erase valid MCP, plugin, browser, Computer Use, and desktop state. |
| Copy current App additions into `codex/local/config.toml` | Freezes volatile host state into repo-local policy and still drifts on later App updates. |
| Treat lines with no `=` as invalid in the AWK projection | Catches one malformed shape but still misses duplicate keys, malformed arrays, strings, and other TOML syntax errors. |

Failure signals:

- `install.sh status` reports stale after Codex App only adds or reorders keys.
- Invalid installed TOML is reported `[OK]` or is reduced to ordinary managed
  drift instead of the explicit `invalid` state.
- A changed or missing Goldband-owned key still reports `[OK]`.
- A profile policy change is ignored as if it were App-owned state.
- An owned multiline TOML value is introduced without a parser/test update.

Revisit triggers:

- Codex provides a documented native split between user policy and App runtime
  state files.
- Goldband adopts a portable TOML parser as an installer dependency.
- Codex App begins rewriting Goldband-owned keys semantically without preserving
  their textual value representation.

## 2026-07-21: Review Impact Graph Is Parent-Runtime Infrastructure

Decision: Goldband owns a bounded, persistent file dependency-impact graph in
the typed `review/code` parent runtime. It is built only when at least two files
changed, before host dispatch, and is passed to core and specialist prompts as
advisory inspection context. It is not an MCP server, child-reviewer plugin, or
independent source of findings.

Implementation contract:

- Git-backed `collect-diff` scopes emit exact changed paths alongside the
  authoritative diff; supplied patch artifacts derive paths from file headers.
- One changed file returns `skipped: single-file` before repository inventory or
  graph-cache access. Zero paths and changes without supported source types have
  separate explicit skip reasons.
- Multi-file review inventories Git-tracked files plus reviewed changed paths,
  parses bounded regular source files without following symlinks, resolves
  common local dependency forms, and walks reverse impact to depth two.
- The cache is stored under Goldband state, keyed by the real repository root,
  validated on load, updated atomically, and reused by file identity and
  metadata signature. It never modifies the reviewed repository.
- Graph status is `analyzed`, `degraded`, or `skipped`. Limits and unreadable or
  unstable inputs become diagnostics rather than silently implying complete
  coverage.
- Core and specialist prompts state that graph output is structural hinting
  only. The diff remains complete review scope, and a blocking finding still
  requires current source evidence and a reachable failure path.
- Automatic specialist selection may add `testing` when a changed source file
  has no observed reverse test dependency, and `maintainability` when the
  bounded impact set is wide or truncated.
- Each pass emits an impact JSON artifact and telemetry for skip reason, parsed
  and reused files, edges, affected files, tests, truncation, and diagnostics.

Assumptions:

- Common local import patterns provide useful prioritization without claiming a
  language-complete semantic graph.
- Git-tracked inventory is the safest default repository boundary; only
  untracked paths already admitted into the review diff may enter the graph.
- File metadata signatures are adequate for cache invalidation because a file
  is reread whenever identity, size, modification time, or change time differs.

Consequences:

- Multi-file review can inspect indirect consumers and likely test coverage
  earlier without giving child reviewers network, MCP, or persistent state.
- Single-file changes retain direct-review context efficiency and avoid a full
  repository scan.
- Unsupported languages, dynamic imports, aliases, generated wiring, and
  relationships beyond the depth/output bounds can be absent; that absence is
  never treated as proof of safety.
- The parent runtime now owns a cache and graph artifact lifecycle that must
  remain bounded, injection-safe, and covered by workflow tests.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Install the referenced graph MCP or parser stack into each reviewer child | Violates child isolation, adds external runtime dependencies, and duplicates persistent state across host adapters. |
| Run graph construction for every review | The repository scan can cost more context and latency than direct inspection for a one-file change. |
| Let graph reachability define review scope or findings | Static extraction is incomplete and would turn missing edges into false assurance. |
| Keep only an in-memory graph | Repeats repository parsing on every review and discards useful bounded reuse. |
| Use a language-complete parser immediately | Adds a large dependency and maintenance surface before Goldband has measured language-specific precision needs. |

Failure signals:

- A one-file review creates or reads the persistent graph index.
- A graph path is used to omit a changed diff path or to report a blocker
  without current source evidence.
- Ignored or unrelated untracked files enter the graph.
- Cache corruption, file churn, or repository size produces silent partial
  coverage instead of `degraded` evidence.
- Review latency or prompt size materially regresses on ordinary multi-file
  changes.

Revisit triggers:

- Real review telemetry shows graph construction or prompt overhead outweighs
  useful affected-path discovery.
- A supported language repeatedly misses high-value edges that require a proper
  parser or project configuration resolver.
- Measured repository scale requires incremental background indexing, a tighter
  bound, or an explicit opt-out.
- Host runtimes gain a trustworthy native dependency graph with equivalent
  isolation, bounds, and evidence semantics.

## 2026-07-21: Codex Workflows Use Installer-Owned Exact Admissions

Decision: supersede the parent-escalation clause of “Interactive Review Must
Enter the Typed Runtime” for Codex. A global Codex install materializes a
Goldband workflow launcher outside the active workspace and installs exact
machine-local `allow` rules for only that launcher’s `review code --host codex`
prefix and enumerated browser inspection commands. Interactive Codex runs those
trusted admissions normally and never asks for `require_escalated` approval.

Implementation contract:

- `goldband-loop/setup --host codex` bundles the public launcher and typed
  workflow owner, browser client, bundled browser server, Rules resolver, and
  an immutable Rules snapshot into
  `~/.codex/goldband/workflow-runtime`; these are real files, not links into the
  Goldband checkout.
- The installer records the absolute Bun and launcher paths in
  `~/.codex/skills/goldband/.workflow-launcher.json` and generates
  `~/.codex/rules/goldband-workflows.rules` from the same values.
- The snapshot records the installed Codex CLI by absolute path. The launcher
  removes caller-provided override state and the host adapter uses the pinned
  executable instead of resolving `codex` from the reviewed process `PATH`.
- The rules fix the Bun executable, materialized launcher, capability, action,
  `--host`, and `codex` argv prefix. Review scope and timeout suffixes remain
  available. Browser rules additionally fix an enumerated inspection command;
  navigation and wait commands do not match automatic admission.
- Codex CLI browser work always enters Goldband's browser owner. It never probes
  Codex App Browser/Chrome bindings. The owner admits navigation and inspection
  commands while rejecting outward-effect operations, but navigation remains
  on Codex's native approval path because it can reach localhost/private origins.
- The workflow reads and executes the installed marker exactly. It never
  substitutes `bin/goldband` from the current workspace or falls back to a
  manual review.
- Reinstall stages a complete snapshot, swaps the previous runtime to a backup,
  and restores it if activation fails. Status validates the same pinned Codex
  executable used by review and probes policy through that executable. Uninstall
  removes the snapshot and Goldband-owned rule.
- Missing or inconsistent launcher state fails closed with a reinstall
  instruction. A broader or more restrictive host/admin policy remains outside
  this contract and may still override the generated rule.

Assumptions:

- Codex continues to interpret an exact `allow` rule as permission to run the
  matching command outside the sandbox without prompting.
- The user trusts the Goldband installer to refresh its own runtime; reviewed
  repositories do not have write access to the installed snapshot or rule.
- The nested reviewer retains its existing read-only sandbox and `never`
  approval policy after the parent launcher is admitted.

Consequences:

- `$goldband review code` no longer enters a contradictory flow where the user
  approves escalation but the session’s `approval_policy=never` rejects the
  same request.
- `$goldband browser session` works in Codex CLI without an app-hosted browser
  provider. Inspection commands can run without prompting; navigation requires
  Codex's normal approval because the Chromium daemon can reach local services.
- Updating Goldband must rebuild the trusted snapshot; source edits alone do
  not change the admitted executable until reinstall.
- The install adds the bundled workflow entrypoints, browser client/server, and
  review assets under `~/.codex/goldband`.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Allow `bin/goldband` by relative path | A workspace can replace that path and inherit the allow decision. |
| Allow the installed skill’s symlinked `bin/goldband` | The link resolves back into the writable Goldband checkout and has the same spoofing boundary. |
| Keep asking for `require_escalated` | Sessions with `approval_policy=never` cannot honor the prompt even after textual user consent. |
| Use Codex App Browser/Chrome plugins from CLI | The CLI session has no registered browser provider even when plugin metadata is installed. |
| Allow every `bun`, `browse`, or `codex exec` invocation | Grants a general sandbox escape far beyond the typed workflows. |

Failure signals:

- Either exact installed workflow command does not resolve to `allow` in
  `codex execpolicy check`.
- A source-tree launcher or unrelated Goldband command matches the generated
  rule.
- Reinstall leaves the marker, snapshot, and rule pointing to different paths.
- Review or browser work asks the user for sandbox escalation despite a healthy
  installation.

Revisit triggers:

- Codex gains a native trusted skill executable or scoped child-agent API that
  removes the outer command admission entirely.
- Codex changes rule precedence, matching, or sandbox behavior.
- The typed runtime no longer needs host state outside the parent sandbox.

## 2026-07-22: Review Runtime Forbids Independent Specialist Agents

Decision: supersede the automatic-specialist default in the earlier interactive
review decision. Every `review/code` run launches exactly one core reviewer.
Independent specialist dispatch is removed from the production owner, and both
the public launcher and shared runtime contract reject `--specialists auto|all`
before any review host starts.

Context:

- A specialist is another full host-model call with its own prompt and a copy of
  the complete review diff, not a zero-cost checklist inside the core reviewer.
- Machine-local evidence on 2026-07-22 recorded 26 review passes selecting 129
  specialists. The core prompts alone contained more than 43 MB before counting
  the duplicated specialist prompts.
- The core reviewer already receives the shared rubric and can evaluate the full
  finding taxonomy in one reusable repository context.
- Automatic keyword and impact-graph routing can identify possible review lenses,
  but it cannot authorize another full model call or prove user consent to the
  quota cost.

Implementation contract:

- `review.ts` contains one host call and no specialist prompt preparation,
  selection, concurrency, or dispatch path.
- `review-runtime-contract.ts` is the shared execution gate. Omitted mode and
  the legacy `off` no-op are valid; `auto` and `all` fail before diff collection
  or host dispatch.
- The public `bin/goldband` launcher does not advertise the option and applies
  the same rejection before it starts the workflow runtime.
- The manifest and checklist assign every review category to the one core
  reviewer in the same repository-reading context.
- Real-host regression coverage counts exactly one host invocation; bypass tests
  prove rejected modes produce zero host invocations.

Assumptions:

- One core reviewer with the complete shared rubric is the correct default for
  ordinary code review.
- Independent second opinions need a separate, explicit capability with its own
  visible cost contract; they are not a hidden mode of ordinary code review.

Consequences:

- Ordinary review no longer hides parallel model fan-out or repeatedly sends the
  same diff to multiple child reviewers.
- Specialist names remain only as optional finding metadata for compatibility;
  they no longer correspond to child processes in this workflow.
- A single reviewer may miss an issue that an independent second opinion would
  find. That tradeoff is explicit rather than paid silently on every review.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep `auto` as the default and add a warning | A warning does not prevent hidden quota use or prove informed consent. |
| Keep automatic fan-out but cap it at one specialist | Still turns a normal review into multiple host calls and leaves an agent-opened bypass. |
| Keep `auto` or `all` as opt-in flags | The runtime cannot prove the parent agent did not add the flag itself; prompt-level consent is not enforcement. |
| Keep dormant dispatch code behind a guard | A future caller or refactor can bypass the guard; deleting the production path gives one authoritative owner. |
| Let the parent agent decide whether to append `auto` | Makes quota behavior prompt-dependent instead of runtime-enforced. |

Failure signals:

- Any `review/code` path contains more than one host invocation.
- `--specialists auto|all` reaches diff collection or host dispatch instead of
  failing at the boundary.
- Default telemetry reports a selected specialist.
- Generated contracts or CLI help advertise independent specialist dispatch.

Revisit triggers:

- The runtime can reuse one model context across lenses without starting another
  host call or resending the full diff.
- A separate user-visible cross-review capability gains an enforceable quota
  authorization contract and bounded inputs.
