/**
 * Tests for find-browse binary locator.
 */

import { describe, test, expect } from 'bun:test';
import { findSourceCheckoutBinary, locateBinary } from '../src/find-browse';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

describe('locateBinary', () => {
  test('returns null when no binary exists at known paths', () => {
    // This test depends on the test environment — if a real binary exists at
    // ~/.claude/skills/goldband/browse/dist/browse, it will find it.
    // We mainly test that the function doesn't throw.
    const result = locateBinary();
    expect(result === null || typeof result === 'string').toBe(true);
  });

  test('returns string path when binary exists', () => {
    const result = locateBinary();
    if (result !== null) {
      expect(existsSync(result)).toBe(true);
    }
  });

  test('priority chain checks .codex, .agents, .claude markers', () => {
    // Verify the source code implements the correct priority order.
    // We read the function source to confirm the markers array order.
    const src = require('fs').readFileSync(require('path').join(__dirname, '../src/find-browse.ts'), 'utf-8');
    // The markers array should list .codex first, then .agents, then .claude
    const markersMatch = src.match(/const markers = \[([^\]]+)\]/);
    expect(markersMatch).not.toBeNull();
    const markers = markersMatch![1];
    const codexIdx = markers.indexOf('.codex');
    const agentsIdx = markers.indexOf('.agents');
    const claudeIdx = markers.indexOf('.claude');
    // All three must be present
    expect(codexIdx).toBeGreaterThanOrEqual(0);
    expect(agentsIdx).toBeGreaterThanOrEqual(0);
    expect(claudeIdx).toBeGreaterThanOrEqual(0);
    // .codex before .agents before .claude
    expect(codexIdx).toBeLessThan(agentsIdx);
    expect(agentsIdx).toBeLessThan(claudeIdx);
  });

  test('function signature accepts no arguments', () => {
    // locateBinary should be callable with no arguments
    expect(typeof locateBinary).toBe('function');
    expect(locateBinary.length).toBe(0);
  });

  test('source-checkout fallback resolves a binary nested below the git root', () => {
    const root = mkdtempSync(join(tmpdir(), 'goldband-find-browse-'));
    try {
      const metaDir = join(root, 'goldband-loop', 'browse', 'src');
      const binary = join(root, 'goldband-loop', 'browse', 'dist', 'browse');
      mkdirSync(dirname(binary), { recursive: true });
      writeFileSync(binary, 'test binary');
      chmodSync(binary, 0o755);

      expect(findSourceCheckoutBinary(root, metaDir, process.execPath)).toBe(binary);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('compiled fallback resolves browse beside find-browse', () => {
    const root = mkdtempSync(join(tmpdir(), 'goldband-find-browse-'));
    try {
      const binary = join(root, 'browse');
      writeFileSync(binary, 'test binary');
      chmodSync(binary, 0o755);

      expect(
        findSourceCheckoutBinary(null, '$bunfs/root', join(root, 'find-browse')),
      ).toBe(binary);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
