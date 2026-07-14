/**
 * Resolvers for the Implementation Tasks emission (#1454).
 *
 *   {{TASKS_SECTION_EMIT:<phase>}} — per-review task emission + JSONL write
 *   {{TASKS_SECTION_AGGREGATE}}    — aggregation across all review phases
 *
 * The executable wire contract lives in scripts/task-emission-schema.ts and is
 * installed as bin/goldband-task-emission. Prompts call that runtime instead of
 * reconstructing the contract with jq.
 */

import {
  TASK_PHASES,
  type TaskPhase,
} from '../task-emission-schema';
import type { TemplateContext, ResolverFn } from './types';

const VALID_PHASES = new Set<string>(TASK_PHASES);

export const generateTasksSectionEmit: ResolverFn = (
  ctx: TemplateContext,
  args?: string[],
) => {
  const phase = args?.[0];
  if (!phase || !VALID_PHASES.has(phase)) {
    throw new Error(
      `TASKS_SECTION_EMIT requires one of ${TASK_PHASES.join(', ')} — got ${phase}`,
    );
  }

  return `## Implementation Tasks

Before closing this review, synthesize the findings above into a flat list of
build-actionable tasks. Each task derives from a specific finding — no padding.
Emit the markdown section AND write a JSONL artifact that \`/autoplan\` can
aggregate across phases.

### Markdown section (always emit)

\`\`\`markdown
## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~2h / CC: ~15min)** — <component> — <imperative title>
  - Surfaced by: <section name> — <specific finding text or line reference>
  - Files: <paths to touch>
  - Verify: <test command or manual check>
- [ ] **T2 (P2, human: ~30min / CC: ~5min)** — ...
\`\`\`

Rules:
- P1 blocks ship; P2 should land same branch; P3 is a follow-up TODO.
- If a finding produced no actionable task, do not invent one.
- If a section had zero findings, emit \`_No new tasks from <section>._\`
- Effort uses the AI-compression table from CLAUDE.md.

### JSONL artifact (always write, even if zero tasks)

\`/autoplan\` reads this file to aggregate across phases. The
\`goldband-task-emission\` runtime owns serialization and validation. Do not use
\`jq\`, \`echo\`, or \`printf\` to construct JSONL rows.

\`\`\`bash
eval "$(${ctx.paths.binDir}/goldband-slug 2>/dev/null)"
TASKS_DIR="\${HOME}/.goldband/projects/\${SLUG:-unknown}"
mkdir -p "$TASKS_DIR"
TASKS_FILE="$TASKS_DIR/tasks-${phase}-$(date +%Y%m%d-%H%M%S).jsonl"
TASK_EMISSION_BIN="${ctx.paths.binDir}/goldband-task-emission"
[ ! -x "$TASK_EMISSION_BIN" ] && [ -x "${ctx.paths.binDir}/goldband-task-emission.exe" ] && TASK_EMISSION_BIN="${ctx.paths.binDir}/goldband-task-emission.exe"
COMMIT=$(git rev-parse HEAD 2>/dev/null || echo unknown)
BRANCH=$(git branch --show-current 2>/dev/null || echo unknown)
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"

if [ ! -x "$TASK_EMISSION_BIN" ]; then
  echo "goldband task emission runtime missing: $TASK_EMISSION_BIN" >&2
  exit 1
fi

# An empty file means "review ran with no tasks". Repeat ONE append command per
# task identified during this review after setting TASK_ID, PRIORITY, COMPONENT,
# TITLE, SOURCE_FINDING, EFFORT_HUMAN, EFFORT_CC, and FILES_JSON.
: > "$TASKS_FILE"
"$TASK_EMISSION_BIN" append \
  --file "$TASKS_FILE" \
  --phase '${phase as TaskPhase}' \
  --run-id "$RUN_ID" \
  --branch "$BRANCH" \
  --commit "$COMMIT" \
  --id "$TASK_ID" \
  --priority "$PRIORITY" \
  --component "$COMPONENT" \
  --files-json "$FILES_JSON" \
  --effort-human "$EFFORT_HUMAN" \
  --effort-cc "$EFFORT_CC" \
  --title "$TITLE" \
  --source-finding "$SOURCE_FINDING"
\`\`\`

\`FILES_JSON\` must be a JSON array such as
\`["browse/src/sanitize.ts","browse/src/server.ts"]\`. If serialization or
validation fails, stop and report the runtime error; do not write a substitute
row or silently skip the task.
`;
};

export const generateTasksSectionAggregate: ResolverFn = (
  ctx: TemplateContext,
) => {
  return `## Implementation Tasks aggregator

Before rendering the Final Approval Gate output block below, aggregate the
per-phase task lists each review skill wrote.

\`\`\`bash
eval "$(${ctx.paths.binDir}/goldband-slug 2>/dev/null)"
TASKS_DIR="\${HOME}/.goldband/projects/\${SLUG:-unknown}"
TASK_EMISSION_BIN="${ctx.paths.binDir}/goldband-task-emission"
[ ! -x "$TASK_EMISSION_BIN" ] && [ -x "${ctx.paths.binDir}/goldband-task-emission.exe" ] && TASK_EMISSION_BIN="${ctx.paths.binDir}/goldband-task-emission.exe"
BRANCH=$(git branch --show-current 2>/dev/null || echo unknown)
# Commit window: last 5 commits on this branch. Drops stale standalone reviews.
COMMITS_RECENT=$(git log --format=%H -n 5 2>/dev/null | tr '\\n' '|' | sed 's/|$//')

if [ ! -x "$TASK_EMISSION_BIN" ]; then
  echo "goldband task emission runtime missing: $TASK_EMISSION_BIN" >&2
  exit 1
fi
if ! AGGREGATED_TASKS=$("$TASK_EMISSION_BIN" aggregate \
  --tasks-dir "$TASKS_DIR" \
  --branch "$BRANCH" \
  --commits "$COMMITS_RECENT"); then
  echo "task aggregation failed; fix the reported JSONL contract error before continuing" >&2
  exit 1
fi
\`\`\`

The runtime validates every JSONL row, keeps only the current branch and recent
commit window, selects the latest \`run_id\` per phase, dedupes by exact
\`(component, sorted(files), title)\`, and sorts by priority then phase.

Inside the Final Approval Gate output template below, render the contents of
\`$AGGREGATED_TASKS\` in the
\`### Implementation Tasks (aggregated across phases)\` section. This is not a
template placeholder; the agent substitutes the runtime output before printing
the message to the user.
`;
};
