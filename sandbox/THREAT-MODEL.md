# goldband Sandbox Threat Model

This sandbox is a second line of defense for local agent runs. It does not
replace the hook router, Codex permissions, Claude permissions, or human review.
It gives goldband a documented container-first execution story with a small,
testable filesystem boundary.

## Relationship to Official Options

Anthropic documents several Claude Code isolation options: the built-in
sandboxed Bash tool, a sandbox runtime, development containers, custom
containers, virtual machines, and Claude Code on the web. Their docs state that
the Bash sandbox constrains only Bash commands, while containers or VMs put the
whole Claude Code process, hooks, MCP servers, and file tools inside the
boundary. Anthropic also documents dev containers as a way to run Claude Code
inside Docker, with warnings that mounted workspaces remain writable and network
egress can still leak data.

OpenAI's Codex manual documents OS-enforced local sandboxing for Codex CLI and
IDE runs, with `workspace-write` as the common local default and network access
off unless enabled. It also documents cloud/container behavior separately:
Codex cloud runs in isolated OpenAI-managed containers, setup can use network,
and the agent phase is offline by default unless internet access is enabled for
that environment.

goldband's sandbox is intentionally narrower than a managed VM or remote sandbox:
it is a local Docker/Podman container that bakes goldband into the image,
installs goldband into a clean container HOME at build time, and bind-mounts only
the declared target project at run time.

Sources:

- Anthropic Claude Code development containers: https://code.claude.com/docs/en/devcontainer
- Anthropic Claude Code sandbox environments: https://code.claude.com/docs/en/sandbox-environments
- Anthropic Claude Code network configuration: https://code.claude.com/docs/en/network-config
- OpenAI Codex manual, `Sandbox`, `Agent approvals & security`, and
  `Agent internet access` sections: https://developers.openai.com/codex/codex-manual.md

## Mount Contract

`sandbox/sandbox.sh run <project-dir>` mounts:

- the target project read-write at `/workspace/project`
- an explicit `--env-file FILE`, if provided
- an explicit named cache volume at `/home/goldband/.cache`, if provided

The goldband repo is copied into the image at build time and made non-writable
at `/opt/goldband`. `run` does not bind-mount the host goldband checkout and
does not rerun `install.sh`, so container-side Linux build artifacts do not
overwrite the macOS host checkout.

`/opt/goldband` is intentionally read-only at runtime. Runtime state is expected
to live under `/home/goldband`, including installed Claude/Codex skills,
goldband telemetry, and workflow state. The automated test exercises installed
Goldband Loop helper commands with a separate `GOLDBAND_HOME` and verifies that
their writes land in container HOME rather than `/opt/goldband`. It is still not
a provider-backed end-to-end Claude or Codex agent task.

It does not mount:

- the host goldband repo
- the user's host HOME
- `~/.ssh`
- cloud provider credential directories
- Docker or Podman sockets
- arbitrary host paths

The container HOME is `/home/goldband`. goldband is installed there during image
build through the existing `install.sh all-with-workflow` path. Runtime starts
from that baked install.

## Image Build Context

The Docker build context is the goldband repository root, not the user's target
project. `.dockerignore` excludes known host overlays, generated state, Git
history, local Codex configuration, and common secret file patterns before
local log files, and common secret file patterns before `COPY . /opt/goldband`
runs.

This is a deny-list, not a proof that every future secret-like filename is
excluded. A newly named local secret inside the goldband repo can still enter an
image layer if it does not match the ignore rules. Keep credentials out of the
repo tree, pass needed runtime credentials explicitly with `--env` or
`--env-file`, and treat image rebuilds as a point where local untracked files
must be considered.

## Network Posture

The first version does not implement a network allowlist. It uses the default
Docker or Podman egress behavior of the host runtime. That means containerized
Claude Code, Codex, package managers, hooks, MCP servers, and shell commands can
reach the network unless the runtime or host network is configured separately.

This is documented posture, not network isolation. There is no allow/deny
network test in `scripts/test-sandbox.sh` because no network allowlist is
enforced by this implementation.

Use `--env-file` or explicit `--env KEY=VALUE` only for credentials that are
safe to expose to processes inside the container. Do not mount host credential
files. Prefer repository-scoped or short-lived tokens.

## What It Helps With

- Accidental writes outside the mounted project directory.
- Accidental reads from host HOME, SSH keys, browser profiles, and cloud config
  that are not mounted.
- Keeping goldband installer output, Claude config, Codex config, telemetry, and
  session state inside a clean container HOME.
- Layering filesystem isolation with the existing hook router deny/advisory
  checks, rather than choosing one or the other.

## What It Does Not Protect

- Anything mounted read-write, including the target project.
- The host goldband source if you choose the goldband repo itself as
  `<project-dir>`. In that case it is intentionally the target project.
- Data exfiltration over the default container network.
- Credentials passed through `--env-file` or `--env`.
- Container runtime escapes, kernel vulnerabilities, or Docker/Podman daemon
  misconfiguration.
- Malicious dependencies downloaded during image build or commands run inside
  the mounted project.
- Host services reachable from the container network.
- API/provider data flow. Files the agent reads can still be sent to the model
  provider according to the active Claude Code or Codex configuration.

## Verification Boundary

`scripts/test-sandbox.sh` verifies:

- the image builds
- `install.sh all-with-workflow` works in a clean container HOME during image build
- `node scripts/check-goldband-loop-inventory.mjs` passes during image build,
  before `/opt/goldband` is made non-writable
- `claude --version` and `codex --version` run inside the image
- the hook router golden dataset still blocks representative unsafe behavior
- a direct hook-router deny event is recorded in the container HOME telemetry
- installed Goldband Loop helper commands write config and timeline state under
  container HOME while `/opt/goldband` is read-only
- host overlays and secret-like local files are not baked into the image
- `/opt/goldband` is not writable at runtime
- the mounted project is writable from the container
- an absolute host path that is not mounted is not writable from the container
- `sandbox/sandbox.sh run <dir>` works on the happy path
- `sandbox/sandbox.sh run <dir> -- command` preserves quoted arguments
- `sandbox/sandbox.sh` fails clearly when no Docker/Podman runtime is available

Those tests prove only the listed boundaries. They do not prove complete host
security.
