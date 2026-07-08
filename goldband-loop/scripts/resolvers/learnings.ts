/**
 * Learnings resolver — cross-skill institutional memory
 *
 * Learnings are stored per-project at ~/.goldband/projects/{slug}/learnings.jsonl.
 * Each entry is a JSONL line with: ts, skill, type, key, insight, confidence,
 * source, branch, commit, files[].
 *
 * Storage is append-only. Duplicates (same key+type) are resolved at read time
 * by goldband-learnings-search ("latest winner" per key+type).
 *
 * Cross-project discovery is opt-in. The resolver asks the user once via
 * AskUserQuestion and persists the preference via goldband-config.
 */
import type { TemplateContext } from './types';

// Whitelist for query= macro values. Allows alphanumeric, space, hyphen, underscore.
// Anything else (e.g. $, backticks, quotes, ;) is a shell-injection vector when the
// emitted bash interpolates the value into `--query "${queryArg}"`. Static template
// queries hand-written in goldband are safe, but the resolver API must defend against
// future contributors writing dangerous values.
const QUERY_SAFE_RE = /^[A-Za-z0-9 _-]+$/;

export function generateLearningsSearch(ctx: TemplateContext, args?: string[]): string {
  if (ctx.host === 'codex') {
    // Codex: simpler version, no cross-project, uses $GOLDBAND_BIN
    return `## Prior Learnings

Search for relevant learnings from previous sessions on this project:

\`\`\`bash
${generateLearningsSearchBash(ctx, args)}
\`\`\`

If learnings are found, incorporate them into your analysis. When a review finding
matches a past learning, note it: "Prior learning applied: [key] (confidence N, from [date])"`;
  }

  return `## Prior Learnings

Search for relevant learnings from previous sessions:

\`\`\`bash
${generateLearningsSearchBash(ctx, args)}
\`\`\`

${generateCrossProjectLearningsSetup(ctx)}

If learnings are found, incorporate them into your analysis. When a review finding
matches a past learning, display:

**"Prior learning applied: [key] (confidence N/10, from [date])"**

This makes the compounding visible. The user should see that goldband is getting
smarter on their codebase over time.`;
}

export function generateLearningsSearchBash(ctx: TemplateContext, args?: string[]): string {
  const queryFlag = queryFlagFromArgs(args);
  if (ctx.host === 'codex') {
    return `$GOLDBAND_BIN/goldband-learnings-search --limit 10${queryFlag} 2>/dev/null || true`;
  }
  return `_CROSS_PROJ=$(${ctx.paths.binDir}/goldband-config get cross_project_learnings 2>/dev/null || echo "unset")
echo "CROSS_PROJECT: $_CROSS_PROJ"
if [ "$_CROSS_PROJ" = "true" ]; then
  ${ctx.paths.binDir}/goldband-learnings-search --limit 10${queryFlag} --cross-project 2>/dev/null || true
else
  ${ctx.paths.binDir}/goldband-learnings-search --limit 10${queryFlag} 2>/dev/null || true
fi`;
}

export function generateCrossProjectLearningsSetup(ctx: TemplateContext): string {
  if (ctx.host === 'codex') return '';
  return `If \`CROSS_PROJECT\` is \`unset\` (first time): Use AskUserQuestion:

> goldband can search learnings from your other projects on this machine to find
> patterns that might apply here. This stays local (no data leaves your machine).
> Recommended for solo developers. Skip if you work on multiple client codebases
> where cross-contamination would be a concern.

Options:
- A) Enable cross-project learnings (recommended)
- B) Keep learnings project-scoped only

If A: run \`${ctx.paths.binDir}/goldband-config set cross_project_learnings true\`
If B: run \`${ctx.paths.binDir}/goldband-config set cross_project_learnings false\`

Then re-run the search with the appropriate flag.`;
}

function queryFlagFromArgs(args?: string[]): string {
  // Empty query= falls through to no-query for backwards compatibility.
  const queryArg = (args || [])
    .filter((a) => a.startsWith('query='))
    .map((a) => a.slice(6))
    .filter(Boolean)[0];
  if (queryArg && !QUERY_SAFE_RE.test(queryArg)) {
    throw new Error(
      `{{LEARNINGS_SEARCH:query=...}} value must match ${QUERY_SAFE_RE} (alphanumeric, space, hyphen, underscore). Got: ${JSON.stringify(queryArg)}`,
    );
  }
  return queryArg ? ` --query "${queryArg}"` : '';
}

export function generateLearningsLog(ctx: TemplateContext): string {
  const binDir = ctx.host === 'codex' ? '$GOLDBAND_BIN' : ctx.paths.binDir;

  return `## Capture Learnings

If you discovered a non-obvious pattern, pitfall, or architectural insight during
this session, log it for future sessions:

\`\`\`bash
${binDir}/goldband-learnings-log '{"skill":"${ctx.skillName}","type":"TYPE","key":"SHORT_KEY","insight":"DESCRIPTION","confidence":N,"source":"SOURCE","files":["path/to/relevant/file"]}'
\`\`\`

**Types:** \`pattern\` (reusable approach), \`pitfall\` (what NOT to do), \`preference\`
(user stated), \`architecture\` (structural decision), \`tool\` (library/framework insight),
\`operational\` (project environment/CLI/workflow knowledge).

**Sources:** \`observed\` (you found this in the code), \`user-stated\` (user told you),
\`inferred\` (AI deduction), \`cross-model\` (both Claude and Codex agree).

**Confidence:** 1-10. Be honest. An observed pattern you verified in the code is 8-9.
An inference you're not sure about is 4-5. A user preference they explicitly stated is 10.

**files:** Include the specific file paths this learning references. This enables
staleness detection: if those files are later deleted, the learning can be flagged.

**Only log genuine discoveries.** Don't log obvious things. Don't log things the user
already knows. A good test: would this insight save time in a future session? If yes, log it.

For high-value, verified material that may graduate into a skill or rule, capture
a curated candidate instead of leaving it only in append-only learnings:

\`\`\`bash
${binDir}/goldband-knowledge capture-candidate --source-type workflow-evidence --source-evidence "workflow-runs/<workflow>.jsonl#event" --title "One-line title" --type practice --domains general --summary "One-line recall summary" --confidence N --body-file path/to/entry.md
\`\`\`

Use \`problem-solution\` for a pitfall with a known fix, \`decision\` for an
architectural or workflow choice, and \`practice\` for a verified reusable
method. This writes \`status: candidate\`; promote it only after explicit review.`;
}
