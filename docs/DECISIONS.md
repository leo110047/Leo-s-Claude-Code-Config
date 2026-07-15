# Goldband Decisions

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
