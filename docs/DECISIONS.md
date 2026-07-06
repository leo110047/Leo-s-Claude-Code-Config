# Goldband Decisions

## 2026-07-06: Always-On Judgment Rules for Weaker-Model Sessions

Decision: encode cross-cutting judgment as three new always-on rules —
`rules/escalation.md` (stop/ask/proceed contract with hard tripwires),
`rules/change-scope.md` (right-sizing fixes to the root cause), and
`rules/session-handoff.md` (what to persist where between sessions). Claude
loads them automatically through the `~/.claude/rules` symlink; Codex gets a
condensed `Judgment Defaults` section in `codex/AGENTS.md` because Codex has
no prose-rules autoload surface.

Why:

- Day-to-day sessions will run on smaller models. The failure modes that most
  need compensation are not style or security (already gated) but judgment:
  when to stop retrying, when to ask versus proceed, how large a fix should
  be, and what survives the end of a session.
- Rules are the highest-leverage injection point: they enter every session's
  context without the model having to decide to invoke a skill. A model that
  is confidently wrong will not invoke a corrective skill, so tripwires must
  be always-on.
- Tripwires are written as mechanics (counts, concrete triggers), not vibes,
  so a weaker model can apply them without judgment.

Implementation contract:

- Full policy text lives only in `rules/*.md`; `codex/AGENTS.md` carries a
  condensed mirror and must be updated when the rules change materially. The
  Claude adapter `claude/CLAUDE.md` intentionally does not duplicate rules.
- Always-on rules must stay lean: target under ~60 lines per rule; anything
  larger belongs in a skill or workflow, not in `rules/`.
- The plugin distribution regenerates `goldband-rules` from `rules/` via
  `node scripts/sync-plugin-assets.mjs`; run it after any rules change.
- The hook-router doc-file blocker allowlists `rules/` (with replay fixture
  `pretool-allow-rules-dir-write`) so policy files are not treated as ad hoc
  documentation.

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
