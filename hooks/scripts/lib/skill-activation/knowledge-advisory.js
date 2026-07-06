const fs = require('fs');
const os = require('os');
const path = require('path');

const DOMAINS = [
  'qa',
  'review',
  'security',
  'design',
  'planning',
  'docs',
  'ios',
  'browser',
  'general',
];

const DOMAIN_HINTS = {
  qa: ['qa', 'test', 'testing', 'bug', 'regression', 'fixture', 'e2e'],
  review: ['review', 'diff', 'pr', 'pull request', 'merge', 'sql', 'race'],
  security: ['security', 'auth', 'secret', 'xss', 'csrf', 'owasp'],
  design: ['design', 'ui', 'visual', 'layout', 'typography'],
  planning: ['plan', 'architecture', 'scope', 'implementation'],
  docs: ['docs', 'documentation', 'readme', 'prompt'],
  ios: ['ios', 'swift', 'xcode', 'simulator'],
  browser: ['browser', 'playwright', 'chrome', 'staging', 'localhost'],
  general: [],
};

function buildKnowledgeAdvisory(prompt, options = {}) {
  const index = readKnowledgeIndex(options.goldbandHome);
  if (!index || !Array.isArray(index.entries)) return null;

  const normalizedPrompt = normalize(prompt);
  if (!normalizedPrompt) return null;

  const domains = inferDomains(normalizedPrompt);
  const tokens = tokenize(normalizedPrompt);
  // Prompt-time advisory is intentionally stricter than CLI/MCP search: active
  // entries only, domain-gated, and scored by prompt tokens to avoid injecting
  // unreviewed candidates or broad graduated guidance into every prompt.
  const rows = index.entries
    .filter((row) => row && row.status === 'active')
    .filter((row) => domainMatches(row, domains))
    .map((row) => ({ row, score: scoreRow(row, tokens, domains) }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || String(a.row.id).localeCompare(String(b.row.id)),
    )
    .slice(0, 3)
    .map((item) => item.row);

  if (rows.length === 0) return null;

  const paths = rows.map((row) => {
    const summary = String(row.summary || row.title || row.id || '').trim();
    return `${row.path}: ${summary}`;
  });

  return {
    key: rows.map((row) => row.id || row.path).join('|'),
    text: `知識庫有 ${rows.length} 條相關記錄：${paths.join(' | ')}`,
    rows,
  };
}

function readKnowledgeIndex(home) {
  const root =
    typeof home === 'string' && home.trim()
      ? home.trim()
      : process.env.GOLDBAND_HOME || path.join(os.homedir(), '.goldband');
  const indexPath = path.join(root, 'knowledge', 'index.json');
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    return null;
  }
}

function inferDomains(normalizedPrompt) {
  const matches = [];
  for (const domain of DOMAINS) {
    const hints = DOMAIN_HINTS[domain] || [];
    if (hints.some((hint) => normalizedPrompt.includes(hint))) {
      matches.push(domain);
    }
  }
  return matches.length > 0 ? matches : ['general'];
}

function domainMatches(row, domains) {
  const rowDomains = Array.isArray(row.domains) ? row.domains : [];
  return (
    rowDomains.includes('general') ||
    domains.some((domain) => rowDomains.includes(domain))
  );
}

function scoreRow(row, tokens, domains) {
  const rowDomains = Array.isArray(row.domains) ? row.domains : [];
  let score =
    domains.filter((domain) => rowDomains.includes(domain)).length * 3;
  const haystack = [
    row.id,
    row.title,
    row.summary,
    row.type,
    row.scope,
    ...(Array.isArray(row.domains) ? row.domains : []),
  ]
    .join(' ')
    .toLowerCase();
  for (const token of tokens) {
    if (token.length >= 3 && haystack.includes(token)) score += 1;
  }
  return score;
}

function normalize(prompt) {
  return String(prompt || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(prompt) {
  return normalize(prompt)
    .split(/[^a-z0-9._-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

module.exports = {
  buildKnowledgeAdvisory,
};
