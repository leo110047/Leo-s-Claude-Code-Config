# App Support Verification

Date: 2026-07-06

## Scope

This report records the first maintainable app-support foundation for goldband.
It covers:

- Codex app shared-config readback.
- Codex plugin portable subset.
- Claude Desktop local extension adapter.
- Claude remote MCP connector template.
- Wording-boundary verification.

It does not make the Codex plugin a replacement for `./install.sh codex-full`,
and it does not expose Claude Code hooks/settings as Claude app support.

## Support Matrix Evidence

| Surface | Status | Evidence |
| --- | --- | --- |
| Claude Code CLI | supported | Existing `goldband@goldband` plugin and `npm run test:plugin-distribution`. |
| Codex CLI | supported | Existing `./install.sh codex-full` path and `./install.sh status` Codex section. |
| Codex app | supported via shared config | `shell/install/app-support-status.sh` checks `~/.codex/config.toml`, `~/.codex/hooks.json`, `~/.codex/hooks/`, `~/.codex/AGENTS.md`, and `~/.agents/skills`. |
| Codex plugin | supported (portable subset) | `plugin-assets/codex-plugin/`, `.agents/plugins/marketplace.json`, and `npm run test:app-support`. |
| Claude Desktop app | supported (portable subset) | `app-adapters/claude-desktop/dist/goldband-local-extension.mcpb`, generated manifest, wrapper fail-closed check, and `npm run test:app-support`. |
| Claude web/mobile app | supported (portable subset) | `app-adapters/claude-remote/goldband-connector.template.json` and `npm run test:app-support`. |

## Generated Artifacts

`scripts/sync-app-support-assets.mjs` generates:

- `.codex-plugin/plugin.json`
- `.agents/plugins/marketplace.json`
- `plugin-assets/codex-plugin/`
- `app-adapters/claude-desktop/goldband-local-extension/`
- `app-adapters/claude-remote/goldband-connector.template.json`
- `docs/reports/app-support-expected-assets.json`

`scripts/build-claude-app-adapters.mjs` generates:

- `app-adapters/claude-desktop/dist/goldband-local-extension.mcpb`

## Verification Commands

```bash
npm run sync:app-support
npm run test:app-support
npm run lint:style
npm run test:plugin-distribution
```

`npm run test:app-support` verifies:

- Generated app-support artifacts are current.
- `.codex-plugin/plugin.json` is no longer a placeholder.
- Codex marketplace points at `plugin-assets/codex-plugin/`.
- Clean temp `HOME` Codex plugin flow succeeds with
  `codex plugin marketplace add ./`, `codex plugin list`, and
  `codex plugin add goldband@goldband-local`.
- Codex plugin includes the portable skills from `skills/global/`.
- Codex plugin and Claude Desktop extension do not include `goldband-loop/`.
- MCP wrappers fail closed when `GOLDBAND_REPO_DIR` is missing.
- Claude Desktop MCPB package can be built and includes `manifest.json`,
  `server/index.js`, and `README.md`.
- The freshly built Claude Desktop MCPB package byte-matches the committed
  `app-adapters/claude-desktop/dist/goldband-local-extension.mcpb`.
- Claude Desktop manifest tool metadata and the remote connector expected tool
  list match the first-party MCP server's `registerTool(...)` declarations.
- `repo_path_installed_from` recognizes both single-file and directory copy
  fallback installs.
- Claude remote connector template has required registration/security fields.
- README/docs do not overclaim Claude Desktop settings behavior, app symmetry,
  or Goldband Loop app packaging.

## External Facts Used

- Codex manual: Codex app agents inherit the same configuration as IDE and CLI,
  and MCP configuration lives in `config.toml`.
- Codex manual: plugins bundle skills, app integrations, and MCP servers, and
  can be exposed by repo or personal marketplace files.
- Claude support docs: Claude remote MCP custom connectors are the route for
  web/mobile/Desktop connector use.
- Claude support docs: Claude Desktop local MCP servers and Desktop Extensions
  are local app integration routes.

## Boundary Notes

- `./install.sh codex-full` remains the canonical Codex full setup.
- The Codex plugin is a portable subset: skills plus opt-in MCP wrapper.
- The Codex plugin MCP config uses explicit `cwd: "."` with
  `args: ["./mcp/goldband-mcp-wrapper.mjs"]`. Package shape and installation are
  verified; before enabling that MCP wrapper by default, run a live Codex MCP
  enablement probe to confirm Codex resolves `cwd: "."` to the installed plugin
  package root.
- The Claude Desktop extension launches the first-party local MCP server through
  `GOLDBAND_REPO_DIR`; it does not install Claude Code hooks.
- The remote connector template is a registration template; actual remote
  deployment and workspace registration are external operational steps and are
  reported as not installed by `./install.sh status` until a local marker exists.
