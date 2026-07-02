---
name: security-checklist
description: |
  Use when working on authentication, authorization, input validation, secret
  handling, sensitive data storage, API hardening, deployment security, or
  security review.

  Prefer `/goldband-cso` or the workflow CSO skill for deep security review.
  Best fit for defensive security checks and secure coding, not offensive
  testing.
allowed-tools:
  - Read
  - Grep
  - Glob
---

# Security Checklist

This is a thin shared-policy entrypoint. Deep security review belongs in
`/goldband-cso` / workflow so Claude and Codex do not carry duplicate OWASP and
STRIDE playbooks in portable skills.

## Scope

Use this skill when changes touch:

- Authentication, authorization, tenancy, roles, sessions, or service accounts.
- User-controlled input, uploads, parsing, deserialization, templates, SQL, shell,
  or external fetches.
- Secrets, tokens, PII, payment data, medical data, audit logs, or telemetry.
- Deployment exposure, CORS, CSP, TLS, CI secrets, or destructive admin actions.

## Workflow Handoff

Use `/goldband-cso` when available for threat modeling, OWASP/STRIDE review,
large PRs, auth changes, file upload handling, payment/admin flows, or production
security gates.

Use this skill directly only for local defensive checks or when workflow is not
installed.

## Baseline Review

1. Identify the trust boundary, actors, sensitive assets, and permitted actions.
2. Confirm authentication is present on every protected route and background
   action.
3. Confirm authorization checks tenant, resource owner, role, and action. Deny
   by default when context is missing.
4. Validate external input at the boundary with schemas or parsers.
5. Keep secrets out of source, logs, telemetry, screenshots, and fixtures.
6. Use parameterized APIs for SQL, shell, templates, and external fetches.
7. Make security failures explicit, auditable, and testable.

## Completion Check

Before considering security work complete, state:

- The trust boundary reviewed.
- The controls verified.
- The tests, scanners, or inspections run.
- Any security assumptions that remain unverified.
