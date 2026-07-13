/**
 * scripts/jargon-list.json — shape + content validation.
 *
 * This file is baked into generated SKILL.md prose at gen-skill-docs time.
 * Tests assert: valid JSON, expected shape, ~50 terms, no duplicates, no empty strings.
 */
import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const JARGON_PATH = path.join(ROOT, 'scripts', 'jargon-list.json');

describe('jargon-list.json', () => {
  test('file exists + parses as JSON', () => {
    expect(fs.existsSync(JARGON_PATH)).toBe(true);
    expect(() => JSON.parse(fs.readFileSync(JARGON_PATH, 'utf-8'))).not.toThrow();
  });

  test('has expected top-level shape', () => {
    const data = JSON.parse(fs.readFileSync(JARGON_PATH, 'utf-8'));
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('description');
    expect(data).toHaveProperty('terms');
    expect(Array.isArray(data.terms)).toBe(true);
    expect(typeof data.version).toBe('number');
  });

  test('contains ~50 terms (±20 tolerance)', () => {
    const data = JSON.parse(fs.readFileSync(JARGON_PATH, 'utf-8'));
    expect(data.terms.length).toBeGreaterThanOrEqual(30);
    expect(data.terms.length).toBeLessThanOrEqual(80);
  });

  test('all terms are non-empty strings', () => {
    const data = JSON.parse(fs.readFileSync(JARGON_PATH, 'utf-8'));
    for (const t of data.terms) {
      expect(typeof t).toBe('string');
      expect(t.trim().length).toBeGreaterThan(0);
    }
  });

  test('no duplicate terms (case-insensitive)', () => {
    const data = JSON.parse(fs.readFileSync(JARGON_PATH, 'utf-8'));
    const seen = new Set<string>();
    for (const t of data.terms) {
      const key = t.toLowerCase();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

});
