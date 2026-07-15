import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const DESIGNS_DIR = path.resolve(import.meta.dir, '../docs/designs');
const STATUS_PATTERN = /^\*\*Status:\*\* (Active|Implemented|Superseded|Abandoned) — \S.+$/m;

describe('design document lifecycle', () => {
  test('every design document declares one canonical status with a reason', () => {
    const violations: string[] = [];
    const files = fs
      .readdirSync(DESIGNS_DIR)
      .filter((file) => file.endsWith('.md') && file !== 'README.md')
      .sort();

    for (const file of files) {
      const header = fs
        .readFileSync(path.join(DESIGNS_DIR, file), 'utf8')
        .split('\n')
        .slice(0, 12)
        .join('\n');
      const matches = header.match(new RegExp(STATUS_PATTERN.source, 'gm')) ?? [];

      if (matches.length !== 1) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });
});
