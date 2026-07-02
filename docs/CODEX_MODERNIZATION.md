# Codex Modernization Notes

## P5 Status

P5 is mostly implemented with conservative runtime adoption.

Implemented now: configuration cleanup, Codex agents/hooks installation,
packaging placeholders, MCP templates, opt-in Codex profile configs, managed
requirements packaging, token-backed MCP setup/status flow, and operations
documentation.

Not completed yet: migrating to beta `default_permissions` / `[permissions.*]`
permission profiles, enabling token-backed MCP servers by default, scheduled
automations, and active plugin marketplace distribution.

## Implemented

- Workflow-aligned read-only helpers: `codex/agents/reviewer.toml`,
  `codex/agents/explorer.toml`, and `codex/agents/planner.toml`.
- Global agent config: `codex/config.toml` declares `[agents]` role entries and
  points at the custom agent files.
- Hooks parity: `codex/hooks.json` installs a Codex-specific hook router for
  `UserPromptSubmit`, `SessionStart`, `PreToolUse`, `PermissionRequest`,
  `PostToolUse`, `SubagentStop`, `PreCompact`, `PostCompact`, and `Stop`.
  Deny behavior is limited to high-risk Bash
  commands or high-confidence secret/private-key patch content; non-risky
  cases continue with workflow hints or context reminders.
- Telemetry baseline: `[otel] exporter = "none"` and `log_user_prompt = false`.
- Codex profile files: `codex/profiles/*.config.toml` installs modern
  `codex --profile <name>` layers, including `readonly`, `standard`, `release`,
  `dangerous-local`, and `auto_review_experiment`.
- Auto-review opt-in: `codex/profiles/auto_review_experiment.config.toml` sets
  `approvals_reviewer = "auto_review"` while keeping
  `approval_policy = "on-request"` and `sandbox_mode = "workspace-write"`.
  It also configures a goldband local `[auto_review].policy` for secret,
  destructive-command, external-upload, and unclear-network boundaries. Runtime
  consumption still needs validation with a real auto-review approval request.
- Managed requirements packaging: `codex/requirements.toml` constrains
  approval policies, approval reviewers, sandbox modes, and web search modes.
  Install it explicitly with `./install.sh codex-requirements` on POSIX. The
  Windows installer only stages the same file under `~/.codex/requirements.toml`
  until the Windows Codex managed-requirements load path is verified.
- Plugin packaging placeholder: `.codex-plugin/plugin.json` plus
  `codex/plugin-marketplace/`.
- MCP templates: `mcp/claude.mcp.json.template` and
  `mcp/codex.config.toml.template`, plus token-backed inventory/status tooling
  in `mcp/token-backed-servers.json` and
  `scripts/check-mcp-token-status.mjs`.
- Removed stale `notice.model_migrations` from `codex/config.toml`.

## Intentionally Not Enabled by Default

- `approvals_reviewer = "auto_review"`: available only through the
  `auto_review_experiment` profile because it changes who reviews approval
  prompts, even though it does not loosen sandboxing.
- `default_permissions` and custom `[permissions.<name>]` profiles: keep current
  `sandbox_mode` model because Codex does not compose the old sandbox settings
  with beta permission profiles. `codex/requirements.toml` intentionally does
  not set `allowed_permission_profiles` yet. The migration target is staged in
  `codex/permission-profiles/goldband-workspace.config.toml` and documented in
  `docs/CODEX_PERMISSION_PROFILES_MIGRATION.md`.
- `codex/requirements.toml` does not constrain per-profile
  `[sandbox_workspace_write].network_access`; `dangerous-local` remains an
  explicit opt-in profile for network-enabled local work.
- Token-backed MCP servers: setup flow exists, but users must provide
  credentials and run MCP Inspector before enabling them.
- Scheduled automations: documented in `OPERATIONS.md`; not installed by the repo.

## Verification Targets

- `codex execpolicy check codex/rules/default.rules`
- `bash scripts/check-codex-portability.sh`
- temp-`HOME` installer run for `codex-full`
- temp/system-path installer run for `codex-requirements`
- JSON syntax checks for `codex/hooks.json`, plugin manifests, and marketplace
  prototype
- TOML syntax checks for `codex/config.toml`, `codex/profiles/*.config.toml`,
  `codex/permission-profiles/*.config.toml`, and `codex/requirements.toml`
- MCP Inspector smoke test for each MCP server before enabling it
