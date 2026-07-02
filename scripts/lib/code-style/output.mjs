export function outputResult(result, format) {
  const content =
    format === 'json' ? JSON.stringify(result, null, 2) : formatText(result);
  process.stdout.write(`${content}\n`);
}

function formatText(result) {
  const lines = [];
  lines.push(`goldband style gate: checked ${result.files.length} file(s)`);

  if (result.violations.length === 0 && result.advisories.length === 0) {
    lines.push('OK: no violations');
    return lines.join('\n');
  }

  appendIssueSection(lines, 'Violations', result.violations);
  appendIssueSection(lines, 'Advisory', result.advisories);
  return lines.join('\n');
}

function appendIssueSection(lines, title, issues) {
  if (issues.length === 0) return;
  lines.push('', `${title}:`);
  for (const issue of issues) {
    lines.push(formatIssue(issue));
  }
}

function formatIssue(issue) {
  const location = issue.file
    ? `${issue.file}${issue.line ? `:${issue.line}` : ''}`
    : '(repo)';
  return `  - [${issue.rule}] ${location}: ${issue.message}`;
}
