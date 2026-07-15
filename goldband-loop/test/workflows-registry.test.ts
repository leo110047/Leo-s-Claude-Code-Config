import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineWorkflow } from '../workflows/definition';
import {
  CORE_WORKFLOWS,
  WORKFLOW_REGISTRY,
  registeredOnlyWorkflows,
} from '../workflows/registry';
import { ALL_HOST_NAMES } from '../hosts';

const ROOT = resolve(import.meta.dir, '..');
const INACTIVE_DOC_DIRECTORIES = new Set(['designs', 'plans', 'reports']);

function activeDocumentationFiles(relativeDirectory: string): string[] {
  return readdirSync(resolve(ROOT, relativeDirectory), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        return INACTIVE_DOC_DIRECTORIES.has(entry.name)
          ? []
          : activeDocumentationFiles(relativePath);
      }
      return entry.isFile() && entry.name.endsWith('.md') ? [relativePath] : [];
    });
}

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

  test('active documentation exposes only the capability interface', () => {
    expect(existsSync(resolve(ROOT, 'docs/skills.md'))).toBe(false);

    const activeDocs = [
      '../README.md',
      '../README.en.md',
      '../CONTRIBUTING.md',
      '../ARCHITECTURE.md',
      '../OPERATIONS.md',
      '../DESIGN.md',
      '../AGENTS.md',
      '../CLAUDE.md',
      'README.md',
      'CONTRIBUTING.md',
      'ARCHITECTURE.md',
      'BROWSER.md',
      'DESIGN.md',
      'ETHOS.md',
      'AGENTS.md',
      'CLAUDE.md',
      'USING_GBRAIN_WITH_GOLDBAND.md',
      ...activeDocumentationFiles('../docs'),
      ...activeDocumentationFiles('docs'),
    ];
    const manifest = JSON.parse(
      readFileSync(resolve(ROOT, '../goldband.manifest.json'), 'utf8'),
    ) as {
      capabilities: Array<{
        id: string;
        actions: Array<{ id: string; source: string }>;
      }>;
    };
    const validActions = new Set(
      manifest.capabilities.flatMap((capability) =>
        capability.actions.map((action) => `${capability.id}/${action.id}`),
      ),
    );
    const retiredFlatCommands = new Set([
      ...manifest.capabilities.flatMap((capability) =>
        capability.actions
          .map((action) => action.source.match(/^([^/]+)\/SKILL\.md\.tmpl$/)?.[1])
          .filter((command): command is string => Boolean(command)),
      ),
      'automate',
      'ship',
    ]);
    const staleReferences: string[] = [];

    for (const relativePath of activeDocs) {
      const content = readFileSync(resolve(ROOT, relativePath), 'utf8');
      for (const legacyInterface of [
        '$goldband <workflow>',
        '/goldband <workflow>',
      ]) {
        if (content.includes(legacyInterface)) {
          const line = content.slice(0, content.indexOf(legacyInterface)).split('\n').length;
          staleReferences.push(`${relativePath}:${line}: ${legacyInterface}`);
        }
      }
      const invocationPattern =
        /(?:\$|\/)goldband(?:[ \t]+([a-z][a-z0-9-]*))?(?:[ \t]+([a-z][a-z0-9-]*))?/gi;
      for (const match of content.matchAll(invocationPattern)) {
        if (!match[1]) continue;
        const action = match[2]
          ? `${match[1].toLowerCase()}/${match[2].toLowerCase()}`
          : '';
        if (validActions.has(action)) continue;
        const line = content.slice(0, match.index).split('\n').length;
        staleReferences.push(`${relativePath}:${line}: ${match[0]}`);
      }
      for (const command of retiredFlatCommands) {
        const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(?<![\\w-])/${escaped}(?![\\w/-])`, 'g');
        for (const match of content.matchAll(pattern)) {
          const prefix = content.slice(Math.max(0, (match.index ?? 0) - 8), match.index);
          if (/(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s$/.test(prefix)) continue;
          const line = content.slice(0, match.index).split('\n').length;
          staleReferences.push(`${relativePath}:${line}: ${match[0]}`);
        }
      }
    }
    expect(staleReferences).toEqual([]);

    const contributing = readFileSync(resolve(ROOT, 'CONTRIBUTING.md'), 'utf8');
    expect(contributing).toContain(`for ${ALL_HOST_NAMES.length} hosts`);
    expect(contributing).toContain(`All ${ALL_HOST_NAMES.length} hosts`);
    const supportedHosts = contributing
      .split('\n')
      .find((line) => line.startsWith('**Supported hosts:**'))
      ?.toLowerCase() ?? '';
    for (const host of ALL_HOST_NAMES) {
      expect(supportedHosts).toContain(host);
    }

    for (const relativePath of ['README.md', 'AGENTS.md', 'CLAUDE.md']) {
      const content = readFileSync(resolve(ROOT, relativePath), 'utf8');
      expect(content).toContain('../docs/generated/capabilities.md');
      expect(content).toContain('$goldband <capability> <action>');
      expect(content).toContain('/goldband <capability> <action>');
      expect(content).not.toMatch(
        /(?<![\w-])goldband-(?:review|qa|ship)(?![\w-])/,
      );
    }

    for (const adapter of ['AGENTS.md', 'CLAUDE.md']) {
      const lineCount = readFileSync(resolve(ROOT, adapter), 'utf8').split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(60);
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
