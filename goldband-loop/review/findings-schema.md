# Shared Finding Shape

Normal `/review` and specialist runtime output use this shape:

```json
{
  "file": "path/to/file.ts",
  "line": 42,
  "severity": "critical|high|medium|low|info",
  "category": "correctness-contract|testing|security|performance|migration-data|api-host-parity|maintainability|ux-design|specialist-runtime|specialist-skipped|host-capability",
  "summary": "One-sentence problem.",
  "failureScenario": "Concrete way this fails for a user, maintainer, workflow, or gate.",
  "evidence": "Specific diff/code/test/config evidence.",
  "recommendation": "What should change. Text only for /review.",
  "suggestedVerification": "Command, test, readback, or manual check that proves the fix.",
  "blocking": true,
  "specialist": "testing",
  "contributingSpecialists": ["testing", "correctness-contract"]
}
```

Rules:

- Use `null` for optional fields that do not apply when a JSON schema requires
  the key.
- Do not output patches or apply fixes.
- Do not output cross-review verdict markers from normal `/review`.
- Cross-review adapters may map `category` to `ruleId`, but the shared finding
  evidence and failure scenario must remain intact.
