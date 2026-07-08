import { getHostConfig } from '../../hosts/index';
import {
  generateCrossProjectLearningsSetup,
  generateLearningsSearchBash,
} from './learnings';
import type { TemplateContext } from './types';

const QUERY_SAFE_RE = /^[A-Za-z0-9 _-]+$/;
const DOMAIN_BY_SKILL: Record<string, string> = {
  'goldband-qa': 'qa',
  qa: 'qa',
  'goldband-review': 'review',
  review: 'review',
  'goldband-cso': 'security',
  cso: 'security',
  'goldband-design-review': 'design',
  'design-review': 'design',
  'goldband-plan-eng-review': 'planning',
  'plan-eng-review': 'planning',
};

export function generatePriorKnowledge(ctx: TemplateContext, args?: string[]): string {
  const parsed = parseArgs(args || []);
  const domain = parsed.domain || DOMAIN_BY_SKILL[ctx.skillName] || 'general';
  const query = parsed.query || domain;
  assertSafe('domain', domain);
  assertSafe('query', query);

  const binDir = ctx.host === 'codex' ? '$GOLDBAND_BIN' : ctx.paths.binDir;
  const learningsArgs = query ? [`query=${query}`] : [];
  const gbrainBlock = gbrainSupported(ctx)
    ? `
if command -v gbrain >/dev/null 2>&1; then
  echo ""
  echo "GBRAIN:"
  gbrain search "${query}" 2>/dev/null | head -5 || true
fi`
    : '';

  return `## Prior Knowledge

Before starting, check one consolidated recall surface. This combines project
learnings, curated local knowledge, and optional GBrain context when this host
supports it. Read only the listed paths that look relevant.

\`\`\`bash
echo "LEARNINGS:"
${generateLearningsSearchBash(ctx, learningsArgs)}
echo ""
echo "KNOWLEDGE:"
${binDir}/goldband-knowledge search --domain "${domain}" --status active --query "${query}" --limit 5 2>/dev/null || echo "KNOWLEDGE: no matching entries"${gbrainBlock}
\`\`\`

${generateCrossProjectLearningsSetup(ctx)}

If the curated knowledge search prints \`KNOWLEDGE: no matching entries\`, say
"知識庫無相關條目" once and continue. If entries are listed, cite the path and
one-line summary before deciding whether to read the full entry. When a finding
or fix uses a prior learning, keep the existing visible note:
\`Prior learning applied: [key] (confidence N/10, from [date])\`.`;
}

function parseArgs(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of args) {
    const index = arg.indexOf('=');
    if (index === -1) continue;
    out[arg.slice(0, index)] = arg.slice(index + 1);
  }
  return out;
}

function assertSafe(name: string, value: string): void {
  if (value && !QUERY_SAFE_RE.test(value)) {
    throw new Error(
      `{{PRIOR_KNOWLEDGE:${name}=...}} value must match ${QUERY_SAFE_RE}. Got: ${JSON.stringify(value)}`,
    );
  }
}

function gbrainSupported(ctx: TemplateContext): boolean {
  const suppressed = new Set(getHostConfig(ctx.host).suppressedResolvers || []);
  return !suppressed.has('GBRAIN_CONTEXT_LOAD');
}
