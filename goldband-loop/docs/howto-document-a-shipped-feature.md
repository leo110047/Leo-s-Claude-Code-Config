# How to audit documentation for a shipped feature

Use `$goldband document generate` in `audit` mode to compare a unified diff with the repository's active Markdown documentation. The runtime produces two local artifacts: a machine-readable coverage report and a PR-body section for review. It does not write documentation files or update a pull request.

## Prerequisites

- Goldband is installed for the current host.
- The feature diff is available as a unified diff file inside the working directory.
- Run from the repository root so active documentation can be inventoried correctly.

## Steps

### 1. Capture the diff

For example:

```bash
git diff origin/main...HEAD > feature.diff
```

### 2. Run the formal audit contract

Invoke `$goldband document generate` with `mode=audit` and `diffFile=feature.diff`. The host adapter may collect these inputs directly or place them in the workflow input JSON.

The audit reads the diff, separates changed source and documentation files, and records the active tutorial, how-to, reference, and explanation files it can identify by deterministic filename conventions.

### 3. Inspect the artifacts

The result contains:

- `documentation-coverage.json`: changed files, changed documentation, Diataxis inventory, and `coverageStatus`.
- `documentation-pr-section.md`: a reviewable summary that can be copied into a PR body.

`documentation-review-required` means source changed without a documentation file in the supplied diff. It is a review signal, not proof that documentation is necessarily required.

### 4. Apply outward-facing changes separately

If a PR-body update is requested, the workflow stops with `status: blocked`, returns the prepared section, and declares `native-host-required`. Apply it only through the host's native approval flow. The runtime never invokes GitHub or GitLab by itself.

If the audit exposes a real documentation gap, author the missing content as a separate implementation task, verify it, regenerate the diff, and rerun the audit.

## Verification

Confirm that:

1. Both artifact paths exist in the workflow result.
2. The coverage JSON names the exact diff that was audited.
3. Every changed file listed in the diff appears in `changedFiles`.
4. Requesting a PR update does not mutate the PR and returns the native-approval boundary.

## Related

- [Tutorial: run your first documentation audit](./tutorial-document-generate.md)
- [Why Goldband uses Diataxis as an audit vocabulary](./explanation-diataxis-in-goldband.md)
- [`document/generate` contract](../generated/workflow-contracts/document/generate.workflow.md)
