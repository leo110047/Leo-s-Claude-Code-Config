import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runKnowledgeQuery } from '../src/knowledge-query.js';

test('knowledge-query returns matching entry paths and summaries', () => {
  const knowledgeHome = writeKnowledgeIndex([
    entry({
      id: 'qa-fixture-replay',
      domains: ['qa', 'browser'],
      confidence: 8,
      summary: 'Use synthetic browser fixtures before staging QA.',
      path: '/tmp/knowledge/qa-fixture-replay.md',
    }),
    entry({
      id: 'review-race-check',
      domains: ['review'],
      confidence: 9,
      summary: 'Check status transition races outside the diff.',
      path: '/tmp/knowledge/review-race-check.md',
    }),
  ]);

  const result = runKnowledgeQuery({
    knowledgeHome,
    domain: 'qa',
    keyword: 'fixture staging',
  });

  assert.equal(result.structuredContent.count, 1);
  assert.deepEqual(result.structuredContent.results[0], {
    id: 'qa-fixture-replay',
    path: '/tmp/knowledge/qa-fixture-replay.md',
    summary: 'Use synthetic browser fixtures before staging QA.',
    type: 'practice',
    domains: ['qa', 'browser'],
    status: 'active',
    confidence: 8,
    updated: '2026-07-06',
  });
});

test('knowledge-query handles missing index as empty result set', () => {
  const knowledgeHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-mcp-kb-'),
  );
  const result = runKnowledgeQuery({ knowledgeHome, keyword: 'anything' });

  assert.equal(result.structuredContent.count, 0);
  assert.deepEqual(result.structuredContent.results, []);
});

function writeKnowledgeIndex(entries: object[]) {
  const knowledgeHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-mcp-kb-'),
  );
  const knowledgeDir = path.join(knowledgeHome, 'knowledge');
  fs.mkdirSync(knowledgeDir, { recursive: true });
  fs.writeFileSync(
    path.join(knowledgeDir, 'index.json'),
    JSON.stringify(
      {
        schema_version: 1,
        generated_at: '2026-07-06T00:00:00.000Z',
        entries,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  return knowledgeHome;
}

function entry(overrides: Record<string, unknown>) {
  return {
    id: 'default-entry',
    title: 'Default entry',
    type: 'practice',
    domains: ['general'],
    scope: 'global',
    status: 'active',
    confidence: 5,
    updated: '2026-07-06',
    summary: 'Default summary.',
    path: '/tmp/knowledge/default.md',
    ...overrides,
  };
}
