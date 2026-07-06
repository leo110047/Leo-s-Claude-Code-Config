import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { classifyTelemetry } from './classify.mjs';
import { DEFAULT_LIMIT } from './constants.mjs';
import { defaultReviewDir } from './io.mjs';

export function extractKnowledgeCandidates(options = {}) {
  const classified = classifyTelemetry({
    ...options,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const rows = classified.classifications.slice(
    0,
    options.limit || DEFAULT_LIMIT,
  );
  const root = knowledgeRoot(options);
  const entriesDir = path.join(root, 'entries');
  fs.mkdirSync(entriesDir, { recursive: true });
  const written = rows.map((item) => writeKnowledgeCandidate(item, entriesDir));
  const index = writeKnowledgeIndex(root, written);
  return {
    schema_version: 'goldband.telemetry-derived-knowledge-candidates.v1',
    generatedAt: new Date().toISOString(),
    source: {
      dateRange: classified.dataWindow,
      classificationCount: classified.totalClassifications,
      sanitation: sanitationSummary(0),
    },
    knowledgeRoot: root,
    count: written.length,
    entries: written,
    indexPath: index,
  };
}

function knowledgeRoot(options) {
  if (!options.knowledgeHome) {
    return path.join(
      path.resolve(options.outDir || defaultReviewDir()),
      'knowledge-candidates',
      'knowledge',
    );
  }
  const home = path.resolve(options.knowledgeHome);
  return path.join(home, 'knowledge');
}

function writeKnowledgeCandidate(item, entriesDir) {
  const id = knowledgeCandidateId(item);
  const filePath = path.join(entriesDir, `${id}.md`);
  const row = {
    id,
    title: `Telemetry candidate: ${item.category}`,
    type: 'problem-solution',
    domains: domainsForClassification(item),
    scope: 'global',
    project_slug: '',
    canonical_remote: '',
    status: 'candidate',
    confidence: confidenceNumber(item),
    created: today(),
    updated: today(),
    source: 'telemetry-miner',
    last_verified: null,
    graduated_to: '',
    links: [],
    summary: summaryForClassification(item),
    path: filePath,
  };
  fs.writeFileSync(
    filePath,
    `${renderKnowledgeCandidate(row, item)}\n`,
    'utf8',
  );
  return row;
}

function writeKnowledgeIndex(root, entries) {
  const indexPath = path.join(root, 'index.json');
  const merged = mergeKnowledgeRows(readExistingKnowledgeRows(root), entries);
  const index = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: merged,
  };
  writeJsonAtomic(indexPath, index);
  return indexPath;
}

function renderKnowledgeCandidate(row, item) {
  const example = JSON.stringify(item.sanitized_example || {}, null, 2);
  return `---
id: ${row.id}
title: ${frontmatterString(row.title)}
type: ${row.type}
domains: [${row.domains.join(', ')}]
scope: ${row.scope}
project_slug: ""
canonical_remote: ""
status: ${row.status}
confidence: ${row.confidence}
created: ${row.created}
updated: ${row.updated}
source: ${row.source}
last_verified: null
graduated_to: ""
links: []
summary: ${frontmatterString(row.summary)}
---

## 情境
Telemetry miner classified a sanitized local event as \`${item.category}\`.
This is a candidate only; a human still needs to label whether the pattern is
real, useful, and worth promoting.

## 症狀
${row.summary}

## 根因
Unknown. The source is heuristic telemetry classification, not a completed
root-cause investigation.

## 解法
Review the sanitized event, decide whether the behavior should become a replay
fixture, workflow rule, skill guidance, or be discarded.

## 驗證方式
Evidence fields: ${(item.evidence_fields || []).join(', ') || 'none'}.
Needs human label: ${item.needs_human_label ? 'yes' : 'no'}.

\`\`\`json
${example}
\`\`\``;
}

function readExistingKnowledgeRows(root) {
  const entriesDir = path.join(root, 'entries');
  if (!fs.existsSync(entriesDir)) return [];
  return fs
    .readdirSync(entriesDir)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => knowledgeRowFromEntryFile(path.join(entriesDir, entry)))
    .filter(Boolean);
}

function mergeKnowledgeRows(existing, candidates) {
  const byId = new Map();
  for (const row of existing) {
    if (row?.id) byId.set(row.id, row);
  }
  for (const row of candidates) {
    byId.set(row.id, row);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const updated = String(b.updated || '').localeCompare(
      String(a.updated || ''),
    );
    if (updated !== 0) return updated;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function frontmatterString(value) {
  const text = String(value || '');
  if (/^[a-zA-Z0-9._/ -]*$/.test(text) && text.trim() === text) return text;
  return JSON.stringify(text);
}

function knowledgeRowFromEntryFile(filePath) {
  const data = readKnowledgeFrontmatter(filePath);
  if (!data) return null;
  return {
    id: data.id || '',
    title: data.title || '',
    type: data.type || '',
    domains: data.domains || [],
    scope: data.scope || '',
    project_slug: data.project_slug || '',
    canonical_remote: data.canonical_remote || '',
    status: data.status || '',
    confidence: Number(data.confidence || 0),
    updated: data.updated || '',
    summary: data.summary || '',
    path: filePath,
  };
}

function readKnowledgeFrontmatter(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const frontmatter = raw.match(/^---\n([\s\S]*?)\n---\n/);
    return frontmatter ? parseKnowledgeFrontmatter(frontmatter[1]) : null;
  } catch {
    return null;
  }
}

function parseKnowledgeFrontmatter(frontmatter) {
  const out = {};
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const raw = match[2].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      out[key] = raw
        .slice(1, -1)
        .split(',')
        .map((item) => unquoteFrontmatter(item.trim()))
        .filter(Boolean);
    } else if (/^\d+$/.test(raw)) {
      out[key] = Number(raw);
    } else if (raw === 'null') {
      out[key] = null;
    } else {
      out[key] = unquoteFrontmatter(raw);
    }
  }
  return out;
}

function unquoteFrontmatter(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function writeJsonAtomic(filePath, payload) {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function knowledgeCandidateId(item) {
  return `telemetry-${slugPart(item.category)}-${caseHash(item.source_event_id)}`;
}

function slugPart(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function domainsForClassification(item) {
  if (item.category === 'workflow-drift') return ['planning'];
  if (item.category === 'cross-review-rejection') return ['review'];
  if (item.sanitized_example?.detail?.toolName === 'Write') return ['docs'];
  return ['general'];
}

function confidenceNumber(item) {
  if (item.confidence === 'confirmed') return 8;
  return 4;
}

function summaryForClassification(item) {
  const name = item.sanitized_example?.name || item.category;
  return `${item.category} candidate from ${name}; verify before promotion.`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function caseHash(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || 'unknown'))
    .digest('hex')
    .slice(0, 12);
}

function sanitationSummary(discarded) {
  return {
    secretScanner: 'hooks/scripts/lib/hook-router/secret-patterns.js',
    pathRewrites: true,
    idAnonymization: true,
    contentTruncation: true,
    discarded,
  };
}
