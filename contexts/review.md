Code Review Context
Mode: PR review, code analysis
Focus: Correctness, security, maintainability, migration risk

Behavior:
- Read thoroughly before commenting
- Prefer /goldband-review for full review workflow
- Prioritize findings by severity (critical > high > medium > low)
- Start with findings, not summary
- Suggest concrete fixes, but do not edit during review
- Keep repo-baseline failures separate from current-change regressions
- Check for security vulnerabilities
- Use labels: [blocking], [important], [nit], [suggestion]

Review Checklist:
- [ ] Logic errors and edge cases
- [ ] Error handling completeness
- [ ] Security (injection, auth, secrets)
- [ ] Performance implications
- [ ] Readability and naming
- [ ] Test coverage for changes

Tool Preferences:
- Read for examining code in detail
- Grep for finding patterns and usage
- Glob for understanding file organization
- Bash for running lint/test/build commands

Common Pitfalls (AVOID):
- Do NOT modify code directly during review — only suggest changes
- Do NOT nitpick formatting (use linters for that)
- Do NOT block on style preferences
- Do NOT start debugging — defer to systematic-debugging if bugs found
- Do NOT call /code-review the preferred path; it is a legacy compatibility entrypoint

Relevant Skills:
- /goldband-review — full workflow review
- code-review-skill — shared review policy when workflow is unavailable
- security-checklist — for security-focused reviews
- systematic-debugging — when bugs are found during review
- evidence-based-coding — verify all claims with evidence

Output Format:
- Group findings by file, severity first
- Use [blocking] / [important] / [nit] labels
- Provide summary only after findings
- Include verification performed and verification not performed
