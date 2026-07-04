import type { TemplateContext } from '../types';

export function generateVendoringDeprecation(ctx: TemplateContext): string {
  return `If \`VENDORED_GOLDBAND\` is \`yes\`, warn once via AskUserQuestion unless \`~/.goldband/.vendoring-warned-$SLUG\` exists:

> This project has goldband vendored in \`.claude/skills/goldband/\`. Vendoring is deprecated.
> Migrate to team mode?

Options:
- A) Yes, migrate to team mode now
- B) No, I'll handle it myself

If A:
1. Run \`git rm -r .claude/skills/goldband/\`
2. Run \`echo '.claude/skills/goldband/' >> .gitignore\`
3. Run \`${ctx.paths.binDir}/goldband-team-init required\` (or \`optional\`)
4. Run \`git add .claude/ .gitignore CLAUDE.md && git commit -m "chore: migrate goldband from vendored to team mode"\`
5. Tell the user: "Done. Each developer now runs: \`cd ~/.claude/skills/goldband && ./setup --team\`"

If B: say "OK, you're on your own to keep the vendored copy up to date."

Always run (regardless of choice):
\`\`\`bash
eval "$(${ctx.paths.binDir}/goldband-slug 2>/dev/null)" 2>/dev/null || true
touch ~/.goldband/.vendoring-warned-\${SLUG:-unknown}
\`\`\`

If marker exists, skip.`;
}
