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
  test('covers every manifest capability action', () => {
    const inventory = JSON.parse(
      readFileSync(resolve(ROOT, 'inventory.json'), 'utf8'),
    );
    const registryNames = new Set(WORKFLOW_REGISTRY.map((entry) => entry.name));
    const names = inventory.capabilities.flatMap((capability: { id: string; actions: Array<{ id: string }> }) =>
      capability.actions.map((action) => `${capability.id}/${action.id}`),
    );
    for (const name of names) {
      expect(registryNames.has(name)).toBe(true);
    }
    expect(registryNames.size).toBe(names.length);
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

  test('integrated workflows expose their capability action CLI in source guidance', () => {
    for (const name of CORE_WORKFLOWS) {
      const entry = WORKFLOW_REGISTRY.find((item) => item.name === name);
      expect(entry).toBeDefined();
      if (!entry) continue;
      const source = readFileSync(resolve(ROOT, entry.sourceTemplate), 'utf8');
      expect(source).toContain(`workflows/run.ts ${entry.capability} ${entry.action}`);
    }
  });

  test('coverage report table matches registry contract fields', () => {
    const report = readFileSync(resolve(ROOT, '../docs/generated/capabilities.md'), 'utf8');
    const tableRows = new Map<string, string[]>();
    for (const line of report.split('\n')) {
      const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
      const [capability, action] = cells;
      if (!capability || !action || capability === 'Capability' || capability.startsWith('---')) continue;
      const normalizedName = `${capability.replaceAll('`', '')}/${action.replaceAll('`', '')}`;
      if (WORKFLOW_REGISTRY.some((entry) => entry.name === normalizedName)) {
        tableRows.set(normalizedName, cells);
      }
    }

    expect(tableRows.size).toBe(WORKFLOW_REGISTRY.length);
    for (const entry of WORKFLOW_REGISTRY) {
      const cells = tableRows.get(entry.name);
      expect(cells).toBeDefined();
      if (!cells) continue;
      expect(cells[0].replaceAll('`', '')).toBe(entry.capability);
      expect(cells[1].replaceAll('`', '')).toBe(entry.action);
      expect(cells[3].replaceAll('`', '')).toBe(entry.integrationStatus === 'integrated' ? entry.entrypointType : 'registered-only');
      expect(cells[4].replaceAll('`', '')).toBe(entry.riskLevel);
    }
  });

  test('missing loop contract fields fail at definition time', () => {
    expect(() => defineWorkflow({
      capability: 'broken',
      action: 'test',
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
      capability: 'broken',
      action: 'test',
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
