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
    .map((row) => ({
      id: row.id || '',
      path: row.path || '',
      summary: row.summary || row.title || '',
      type: row.type || '',
      domains: row.domains || [],
      status: row.status || '',
      confidence: row.confidence ?? null,
      updated: row.updated || '',
    }));

  return jsonToolResult({
    indexPath,
    count: results.length,
    results,
  });
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
  // optional filters, then confidence/update ordering. Keep this in sync with
  // goldband-loop/lib/knowledge.ts when the public query semantics change.
  return rows
    .filter((row) => status === 'all' || row.status === status)
    .filter((row) => !input.domain || row.domains?.includes(input.domain))
    .filter((row) => !input.type || row.type === input.type)
    .filter((row) => tokens.length === 0 || matchesTokens(row, tokens))
    .sort((a, b) => {
      const confidenceDelta = (b.confidence || 0) - (a.confidence || 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return String(b.updated || '').localeCompare(String(a.updated || ''));
    });
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
