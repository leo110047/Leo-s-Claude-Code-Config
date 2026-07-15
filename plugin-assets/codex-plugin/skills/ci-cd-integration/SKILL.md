---
name: ci-cd-integration
description: |
  Use when setting up or changing CI pipelines, GitHub Actions workflows,
  build/test/deploy gates, release automation, CI secrets handling, or build caching.

  Best fit for delivery pipeline design and automation, not application architecture.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# CI/CD Integration

Shape CI/CD changes before editing workflows. Keep this entrypoint to ownership,
gates, permissions, and verification; load YAML recipes from `reference/` only
after the runtime and deploy model are known.

## Gotchas

- Do not collapse build, test, release, and deploy into one opaque job when
  failures need different owners or rollback paths.
- Do not trust green local scripts as CI proof; clean-environment runs matter.
- Do not leak secrets through logs, artifacts, caches, debug output, or PR
  workflows.

## Decision Checks

- Outcome: name the affected build, test, release, deploy, cache, permission,
  secret, artifact, or branch-protection behavior.
- Ownership: split stages when failures need different responders or rollback.
- Environment: verify dependencies, services, credentials, and platform versions.
- Security: keep permissions least-privilege.
- Rollback: deploy changes need promotion, health checks, and rollback behavior.

## References

- `reference/github-actions-recipes.md`: workflow templates, matrices,
  composite actions, caching, and PR automation.
- `reference/deployment-strategies.md`: blue-green, canary, rolling, and
  rollback details.

## Completion Check

- The pipeline change has an explicit build, test, deploy, or release outcome.
- Verification ran in a clean or CI-equivalent environment when feasible.
- Unverified remote CI, environment gates, or deployment steps are reported.
