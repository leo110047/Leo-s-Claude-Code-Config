import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jsonToolResult } from './types.js';

export type KnowledgeQueryInput = {
  domain?: string;
  type?: string;
  keyword?: string;
  status?: 'active' | 'candidate' | 'graduated' | 'retired' | 'all';
  limit?: number;
  knowledgeHome?: string;
};

type KnowledgeIndexRow = {
  id?: string;
  title?: string;
  type?: string;
  domains?: string[];
  scope?: string;
  status?: string;
  confidence?: number;
  updated?: string;
  last_verified?: string | null;
  source_evidence?: string;
  trust_level?: string;
  reviewed_by?: string;
  staleness?: string;
  summary?: string;
  path?: string;
};

export function runKnowledgeQuery(input: KnowledgeQueryInput) {
  const indexPath = path.join(
    resolveKnowledgeHome(input),
    'knowledge',
    'index.json',
  );
  const rows = readRows(indexPath);
  const results = filterRows(rows, input)
    .slice(0, clampLimit(input.limit))
    .map(resultFromRow);

  return jsonToolResult({
    indexPath,
    count: results.length,
    results,
  });
}

function resultFromRow(row: KnowledgeIndexRow) {
  return {
    id: text(row.id),
    path: text(row.path),
    summary: text(row.summary || row.title),
    type: text(row.type),
    domains: row.domains || [],
    status: text(row.status),
    confidence: row.confidence ?? null,
    updated: text(row.updated),
    last_verified: row.last_verified || null,
    source_evidence: text(row.source_evidence),
    trust_level: text(row.trust_level),
    reviewed_by: text(row.reviewed_by),
    staleness: text(row.staleness),
  };
}

function text(value: string | null | undefined): string {
  return value || '';
}

function resolveKnowledgeHome(input: KnowledgeQueryInput): string {
  if (input.knowledgeHome) return input.knowledgeHome;
  return process.env.GOLDBAND_HOME || path.join(os.homedir(), '.goldband');
}

function readRows(indexPath: string): KnowledgeIndexRow[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

function filterRows(rows: KnowledgeIndexRow[], input: KnowledgeQueryInput) {
  const status = input.status || 'active';
  const tokens = tokenize(input.keyword || '');
  // MCP mirrors the CLI recall contract over index.json: active by default,
  // optional filters, then confidence/freshness ordering. Keep this in sync with
  // goldband-loop/lib/knowledge.ts when the public query semantics change.
  return rows
    .filter((row) => status === 'all' || row.status === status)
    .filter((row) => !input.domain || row.domains?.includes(input.domain))
    .filter((row) => !input.type || row.type === input.type)
    .filter((row) => tokens.length === 0 || matchesTokens(row, tokens))
    .sort((a, b) => {
      const confidenceDelta = (b.confidence || 0) - (a.confidence || 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return freshness(b).localeCompare(freshness(a));
    });
}

function freshness(row: KnowledgeIndexRow): string {
  return row.last_verified || row.updated || '';
}

function matchesTokens(row: KnowledgeIndexRow, tokens: string[]) {
  const haystack = [
    row.id,
    row.title,
    row.summary,
    row.type,
    row.scope,
    ...(row.domains || []),
  ]
    .join(' ')
    .toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function tokenize(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 10;
  return Math.max(1, Math.min(Number(limit), 50));
}
