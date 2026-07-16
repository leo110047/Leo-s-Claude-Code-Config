# Tutorial: run your first documentation audit

This tutorial exercises the implemented `$goldband document generate` audit contract. It produces local coverage artifacts and does not generate documentation files or update a PR.

## What you need

- A repository with at least one committed file.
- Goldband installed for the host you are using.
- A unified diff file stored inside the repository.

## Step 1: Create a diff input

Make or select a small change, then save its unified diff:

```bash
git diff > documentation-audit.diff
```

If your working tree is clean, compare two revisions instead:

```bash
git diff HEAD~1 HEAD > documentation-audit.diff
```

## Step 2: Run the audit

Invoke `$goldband document generate` with these inputs:

- `mode`: `audit`
- `diffFile`: `documentation-audit.diff`

The workflow reads only the named diff and the repository's active Markdown inventory. It writes a coverage JSON artifact and a prepared Markdown section under Goldband's workflow artifact directory.

## Step 3: Read the result

Open `documentation-coverage.json`. The important fields are:

- `changedFiles`: every path parsed from the unified diff.
- `changedSource`: changed non-Markdown paths.
- `changedDocumentation`: changed Markdown paths.
- `diataxis`: available and changed files grouped as tutorial, how-to, reference, and explanation.
- `coverageStatus`: `covered` or `documentation-review-required`.

Then open `documentation-pr-section.md`. It is intentionally only a prepared section. If you request `updatePrBody: true`, the workflow must return `blocked` with `authorization=native-host-required`; it must not edit the PR.

## What you built

You now have deterministic documentation-audit evidence tied to a specific diff. Use the evidence to decide whether documentation work is required, then author and review that work separately.

## Related

- [How to audit documentation for a shipped feature](./howto-document-a-shipped-feature.md)
- [Why Goldband uses Diataxis](./explanation-diataxis-in-goldband.md)
- [`document/generate` contract](../generated/workflow-contracts/document/generate.workflow.md)
