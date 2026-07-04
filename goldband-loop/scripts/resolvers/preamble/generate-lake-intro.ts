

export function generateLakeIntro(): string {
  return `If \`LAKE_INTRO\` is \`no\`: say "goldband follows the **Completeness Principle** — do the complete thing when AI makes marginal cost near-zero."

\`\`\`bash
touch ~/.goldband/.completeness-intro-seen
\`\`\`

Always run \`touch\`.`;
}
