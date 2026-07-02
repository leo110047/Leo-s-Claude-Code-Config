# MCP Templates

These templates provide dual-host MCP starting points without enabling any
token-backed server by default.

## Files

- `claude.mcp.json.template`: Claude-style `.mcp.json` template.
- `codex.config.toml.template`: Codex `config.toml` MCP table template.

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
