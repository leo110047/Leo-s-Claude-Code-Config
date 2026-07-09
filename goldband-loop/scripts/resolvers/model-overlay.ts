/**
 * Model overlay resolver — reads model-overlays/{model}.md and returns it
 * wrapped in a subordinate behavioral-patch section.
 *
 * Precedence:
 *   1. Exact match: ctx.model === 'gpt-5.4' → reads model-overlays/gpt-5.4.md
 *   2. INHERIT directive: if the file's first non-whitespace line is
 *      `{{INHERIT:claude}}`, the resolver reads model-overlays/claude.md first
 *      and concatenates it ahead of the rest of this file's content.
 *      This lets `gpt-5.4.md` build on top of `gpt.md` without duplication.
 *   3. Missing file: returns empty string (graceful degradation, no error).
 *   4. No ctx.model set: returns empty string.
 *
 * The returned block is subordinate to skill workflow, safety gates, and
 * AskUserQuestion instructions. The subordination language is part of the
 * wrapper heading so it appears with every overlay regardless of file content.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TemplateContext } from './types';

const OVERLAY_DIR = path.resolve(import.meta.dir, '../../model-overlays');

const INHERIT_RE = /^\s*\{\{INHERIT:([a-z0-9-]+(?:\.[0-9]+)*)\}\}\s*\n/;
const READ_ONLY_SKILLS = new Set(['review']);

export function readOverlay(model: string, seen: Set<string> = new Set()): string {
  if (seen.has(model)) return ''; // cycle guard
  seen.add(model);

  const filePath = path.join(OVERLAY_DIR, `${model}.md`);
  if (!fs.existsSync(filePath)) return '';

  const raw = fs.readFileSync(filePath, 'utf-8');
  const match = raw.match(INHERIT_RE);
  if (!match) return raw.trim();

  const baseModel = match[1];
  const base = readOverlay(baseModel, seen);
  const rest = raw.replace(INHERIT_RE, '').trim();

  if (!base) return rest;
  return `${base}\n\n${rest}`;
}

export function generateModelOverlay(ctx: TemplateContext): string {
  if (!ctx.model) return '';

  let content = readOverlay(ctx.model);
  if (!content) return '';
  if (READ_ONLY_SKILLS.has(ctx.skillName)) {
    content = content.replace(
      /\*\*Dedicated tools over Bash\.\*\* Prefer Read, Edit, Write, Glob, Grep over shell\nequivalents \(cat, sed, find, grep\)\. The dedicated tools are cheaper and clearer\./,
      '**Dedicated tools over Bash.** Prefer Read, Glob, and Grep over shell\ninspection equivalents (cat, sed, find, grep). This skill is read-only; do not use\nEdit or Write.'
    );
  }

  return `## Model-Specific Behavioral Patch (${ctx.model})

The following nudges are tuned for the ${ctx.model} model family. They are
**subordinate** to skill workflow, STOP points, AskUserQuestion gates, plan-mode
safety, and /ship review gates. If a nudge below conflicts with skill instructions,
the skill wins. Treat these as preferences, not rules.

${content}`;
}
