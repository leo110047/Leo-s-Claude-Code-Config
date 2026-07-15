import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');

const OPENCLAW_NATIVE_SKILLS = [
  'openclaw/skills/goldband-openclaw-investigate/SKILL.md',
  'openclaw/skills/goldband-openclaw-office-hours/SKILL.md',
  'openclaw/skills/goldband-openclaw-ceo-review/SKILL.md',
  'openclaw/skills/goldband-openclaw-retro/SKILL.md',
];

const CEO_REVIEW_SKILL = 'openclaw/skills/goldband-openclaw-ceo-review/SKILL.md';
const CEO_DEEP_RUBRIC =
  'openclaw/skills/goldband-openclaw-ceo-review/references/deep-ceo-review-rubric.md';
const OFFICE_HOURS_SKILL =
  'openclaw/skills/goldband-openclaw-office-hours/SKILL.md';
const OFFICE_HOURS_PLAYBOOK =
  'openclaw/skills/goldband-openclaw-office-hours/references/office-hours-playbook.md';
const MAX_COMPACT_CEO_SKILL_BYTES = 6000;
const MAX_COMPACT_OFFICE_HOURS_SKILL_BYTES = 3000;

function extractFrontmatter(content: string): string {
  expect(content.startsWith('---\n')).toBe(true);
  const fmEnd = content.indexOf('\n---', 4);
  expect(fmEnd).toBeGreaterThan(0);
  return content.slice(4, fmEnd);
}

describe('OpenClaw native skills', () => {
  test('frontmatter parses as YAML and keeps only name + description', () => {
    for (const skill of OPENCLAW_NATIVE_SKILLS) {
      const content = fs.readFileSync(path.join(ROOT, skill), 'utf-8');
      const frontmatter = extractFrontmatter(content);
      const parsed = Bun.YAML.parse(frontmatter) as Record<string, unknown>;

      expect(Object.keys(parsed).sort()).toEqual(['description', 'name']);
      expect(typeof parsed.name).toBe('string');
      expect(typeof parsed.description).toBe('string');
      expect((parsed.name as string).length).toBeGreaterThan(0);
      expect((parsed.description as string).length).toBeGreaterThan(0);
    }
  });

  test('CEO review keeps the always-loaded prompt compact and lazy-loads deep review material', () => {
    const skillPath = path.join(ROOT, CEO_REVIEW_SKILL);
    const rubricPath = path.join(ROOT, CEO_DEEP_RUBRIC);
    const skill = fs.readFileSync(skillPath, 'utf-8');
    const rubric = fs.readFileSync(rubricPath, 'utf-8');

    expect(Buffer.byteLength(skill, 'utf-8')).toBeLessThanOrEqual(
      MAX_COMPACT_CEO_SKILL_BYTES,
    );
    expect(skill).toContain('references/deep-ceo-review-rubric.md');
    expect(skill).toContain('Save the summary to `memory/`');
    expect(rubric).toContain('## Review Lenses');

    for (const staleAlwaysOnInstruction of [
      'Never condense, abbreviate, or skip any review section',
      'Diagrams are mandatory',
      'Every section gets evaluated',
      'Everything deferred must be written down',
    ]) {
      expect(skill).not.toContain(staleAlwaysOnInstruction);
    }
  });

  test('office-hours keeps the always-loaded prompt compact and lazy-loads its playbook', () => {
    const skillPath = path.join(ROOT, OFFICE_HOURS_SKILL);
    const playbookPath = path.join(ROOT, OFFICE_HOURS_PLAYBOOK);
    const skill = fs.readFileSync(skillPath, 'utf-8');
    const playbook = fs.readFileSync(playbookPath, 'utf-8');

    expect(Buffer.byteLength(skill, 'utf-8')).toBeLessThanOrEqual(
      MAX_COMPACT_OFFICE_HOURS_SKILL_BYTES,
    );
    expect(skill).toContain('references/office-hours-playbook.md');
    expect(skill).not.toContain('Ask these questions **ONE AT A TIME**');
    expect(playbook).toContain('## Startup / Intrapreneurship Questions');
  });
});
