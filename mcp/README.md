# MCP Templates

These templates provide dual-host MCP starting points without enabling any
token-backed server by default.

## Files

- `claude.mcp.json.template`: Claude-style `.mcp.json` template.
- `codex.config.toml.template`: Codex `config.toml` MCP table template.
- `token-backed-servers.json`: token-backed MCP inventory used by status
  checks.
- `../codex/local/mcp.env.example`: ignored local env template for token
  presence checks.

## Token-Backed Setup Flow

Token-backed servers are still opt-in. Do not commit credentials.

1. Copy `codex/local/mcp.env.example` to `codex/local/mcp.env`.
2. Fill only the local env file, or export the same variables in the shell that
   launches Codex/Claude.
3. Copy the selected MCP table from `mcp/codex.config.toml.template` or
   `mcp/claude.mcp.json.template` into the host config and set that server to
   enabled.
4. Check token presence without printing secrets:

```bash
node scripts/check-mcp-token-status.mjs --mcp-env-file codex/local/mcp.env --print-smoke
```

5. Run the printed MCP Inspector command before documenting the server as
   supported.

## Validation

First validate local syntax:

```bash
python3 -m json.tool mcp/claude.mcp.json.template
```

For any server a user actually enables, run an MCP Inspector smoke test before
documenting it as supported:

```bash
npx @modelcontextprotocol/inspector <server-command>
```

The smoke test must verify that the server starts and exposes the expected tool
list. Token-backed servers such as GitHub or Sentry require user-provided
credentials and must not be enabled by default.

## Current Smoke Test Status

Verified with MCP Inspector on 2026-07-02:

- `context7`: starts successfully and exposes `resolve-library-id` and
  `query-docs`.
- `playwright`: starts successfully and exposes browser automation tools.

Not verified by default:

- `github`: requires a user-provided GitHub token.
- `sentry`: requires user-provided Sentry credentials.
