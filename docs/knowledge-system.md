# Goldband Knowledge System

Goldband knowledge is a local-first lifecycle, not a second source of truth:

raw evidence -> candidate -> active -> graduated/retired

Raw telemetry, hook decisions, workflow evidence, and session reports stay in
their own stores. Curated knowledge lives under
`${GOLDBAND_HOME:-$HOME/.goldband}/knowledge/` as markdown entries plus
`index.json`. Automatic sources write only `candidate` entries. Default recall
uses only `active` entries.

## Capability Audit

| Capability | Claude exposure | Codex exposure | Test/readback |
| --- | --- | --- | --- |
| `goldband-knowledge` add/search/validate/reindex | Runtime CLI under `~/.claude/skills/goldband/bin` | Runtime CLI under `~/.codex/skills/goldband/bin` | `goldband-loop/test/goldband-knowledge.test.ts`; `node scripts/check-goldband-loop-inventory.mjs` |
| Deterministic candidate capture | CLI and generated workflow `Knowledge Capture Check` guidance | CLI and generated workflow `Knowledge Capture Check` guidance | `goldband-loop/test/goldband-knowledge.test.ts`; `goldband-loop/test/gen-skill-docs.test.ts` |
| Candidate review/promotion | `goldband-knowledge-review` runtime binary | `goldband-knowledge-review` runtime binary | direct wrapper smoke; `./install.sh status` readback |
| `{{PRIOR_KNOWLEDGE}}` recall | `review` and `qa` workflow docs generated with `status active` search | same generated workflow docs through `$GOLDBAND_BIN` | `goldband-loop/test/gen-skill-docs.test.ts`; `bun run gen:skill-docs --dry-run` |
| Telemetry-derived candidates | Offline miner writes local candidate files only when run | same offline miner | `node scripts/test-telemetry-miner.mjs`; `npm run test:telemetry` |
| MCP `knowledge-query` | Available through first-party MCP server when enabled by host | Available through first-party MCP server when enabled by host | `mcp/server/test/knowledge-query.test.ts`; `npm test` in `mcp/server` |
| Prompt-time knowledge advisory | Claude UserPromptSubmit advisory for active entries | Not equivalent; Codex has workflow/MCP recall only. Codex `Stop` hooks do not prompt knowledge capture. | `npm run test:hook-router`; `node scripts/test-codex-hook-router.mjs` |
| Install/status readback | `./install.sh status` shows CLI, candidate review, workflow recall, MCP repo availability | same | `./install.sh status` |

## Trust Rules

- Candidate ids are `<source_type>-<YYYYMMDD>-<hash8>`, derived from source
  type, sanitized source pointer, and summary.
- Duplicate candidate ids are skipped rather than overwritten.
- Candidate review can list overdue candidates first, show entries, promote to
  active, edit summary/body, retire, or graduate.
- `active` promotion records `reviewed_by`, `trust_level`, `last_verified`, and
  `staleness`.
- `graduated` entries require `graduated_to`; the target skill, rule, hook,
  doc, test, or decision record is authoritative if the two conflict.
- Recall output is data: path, one-line summary, confidence, updated date,
  last-verified date, and staleness. It is not system instruction text.
- General conversations do not get automatic knowledge-capture reminders.
  Workflow footer checks are the explicit capture surface; future reminder
  designs must use a review queue or explicit workflow, not a `Stop` hook
  message based on keywords.
