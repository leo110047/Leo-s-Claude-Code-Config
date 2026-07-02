# Codex Permission Profiles Migration

This is the migration target for replacing legacy `sandbox_mode` with Codex
permission profiles.

## Current State

`codex/config.toml` still uses:

```toml
sandbox_mode = "workspace-write"
approval_policy = "on-request"
```

Keep this model until every active Codex client is verified to support
permission profiles.

## Target

The target template is:

- `codex/permission-profiles/goldband-workspace.config.toml`

It defines `default_permissions = "goldband_workspace"` and denies common
secret-file names inside workspace roots while preserving normal workspace
editing. Avoid broad source-code terms such as `**/*token*`; they can block
legitimate token-related implementation files.

## Migration Gate

Do not switch the default config until these checks pass:

1. `codex --version` is at least `0.138.0` on CLI, App, IDE, and Windows clients
   that will use this repo.
2. A scratch `CODEX_HOME` run confirms the profile loads without falling back to
   legacy `sandbox_mode`.
3. A probe workspace confirms `.env`, `.env.*`, `.pem`, `.key`, SSH private key
   names, `credentials.json`, `secrets.json`, and service-account JSON files are
   not readable by sandboxed commands.
4. Normal edit, test, lint, and build workflows still run inside workspace
   roots.
5. `codex/requirements.toml` is migrated from `allowed_sandbox_modes` to
   `allowed_permission_profiles` only after the same client-version check.

## Cutover Shape

When the gate passes:

1. Remove `sandbox_mode` and `[sandbox_workspace_write]` usage from active Codex
   config layers.
2. Move the `goldband_workspace` permission table into the active user or
   managed config.
3. Set `default_permissions = "goldband_workspace"`.
4. Update `codex/requirements.toml` to allow only the built-in profiles and
   custom profiles that are intentionally supported.
5. Re-run installer and status tests on POSIX and Windows.
