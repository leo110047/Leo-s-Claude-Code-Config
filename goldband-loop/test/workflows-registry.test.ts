import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineWorkflow } from '../workflows/definition';
import {
  CORE_WORKFLOWS,
  WORKFLOW_REGISTRY,
  registeredOnlyWorkflows,
} from '../workflows/registry';

const ROOT = resolve(import.meta.dir, '..');

describe('workflow registry', () => {
  test('covers every installed workflow skill and the root plan command', () => {
    const inventory = JSON.parse(
      readFileSync(resolve(ROOT, 'inventory.json'), 'utf8'),
    );
    const registryNames = new Set(WORKFLOW_REGISTRY.map((entry) => entry.name));
    for (const name of inventory.skills) {
      expect(registryNames.has(name)).toBe(true);
    }
    expect(registryNames.has('plan')).toBe(true);
  });

  test('all entries have contract fields and valid source pointers', () => {
    for (const entry of WORKFLOW_REGISTRY) {
      expect(entry.target.length).toBeGreaterThan(0);
      expect(entry.evaluationSignal.length).toBeGreaterThan(0);
      expect(entry.iterationCap).toBeGreaterThan(0);
      expect(entry.stopConditions.length).toBeGreaterThan(0);
      expect(entry.hostSupport.length).toBeGreaterThan(0);
      expect(entry.evidencePolicy).toContain('JSONL');
      expect(existsSync(resolve(ROOT, entry.sourceTemplate))).toBe(true);
    }
  });

  test('core set is integrated and non-core entries stay registered-only', () => {
    const core = new Set<string>(CORE_WORKFLOWS);
    for (const entry of WORKFLOW_REGISTRY) {
      const expected = core.has(entry.name) ? 'integrated' : 'registered-only';
      expect(entry.integrationStatus).toBe(expected);
    }
    expect(registeredOnlyWorkflows().length).toBeGreaterThan(40);
  });

  test('coverage report table matches registry contract fields', () => {
    const report = readFileSync(resolve(ROOT, 'workflows/COVERAGE.md'), 'utf8');
    const tableRows = new Map<string, string[]>();
    for (const line of report.split('\n')) {
      const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
      const [name] = cells;
      if (!name || name === 'Workflow' || name.startsWith('---')) continue;
      const normalizedName = name.replaceAll('`', '');
      if (WORKFLOW_REGISTRY.some((entry) => entry.name === normalizedName)) {
        tableRows.set(normalizedName, cells);
      }
    }

    expect(tableRows.size).toBe(WORKFLOW_REGISTRY.length);
    for (const entry of WORKFLOW_REGISTRY) {
      const cells = tableRows.get(entry.name);
      expect(cells).toBeDefined();
      if (!cells) continue;
      expect(cells[1]).toBe(entry.integrationStatus);
      expect(cells[2]).toBe(entry.entrypointType);
      expect(cells[3]).toBe(entry.riskLevel);
      expect(cells[4]).toBe(entry.nextStep);
    }
  });

  test('missing loop contract fields fail at definition time', () => {
    expect(() => defineWorkflow({
      name: 'broken',
      target: 'x',
      evaluationSignal: 'x',
      iterationCap: 0,
      stopConditions: ['target-met'],
      sourceTemplate: 'README.md',
      entrypointType: 'legacy-thin',
      integrationStatus: 'registered-only',
      hostSupport: ['claude'],
      riskLevel: 'low',
      evidencePolicy: 'x',
      migrationNotes: 'x',
      nextStep: 'x',
    })).toThrow('iterationCap');

    expect(() => defineWorkflow({
      name: 'broken',
      target: 'x',
      evaluationSignal: 'x',
      iterationCap: 1,
      stopConditions: [],
      sourceTemplate: 'README.md',
      entrypointType: 'legacy-thin',
      integrationStatus: 'registered-only',
      hostSupport: ['claude'],
      riskLevel: 'low',
      evidencePolicy: 'x',
      migrationNotes: 'x',
      nextStep: 'x',
    })).toThrow('stopConditions');
  });
});
