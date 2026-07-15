#!/usr/bin/env bun
/**
 * Generate goldband/llms.txt — a single discoverable index of every goldband
 * capability for AI agents.
 *
 * Inputs:
 *   - generated/capability-actions.json, normalized from goldband.manifest.json
 *   - browse/src/commands.ts COMMAND_DESCRIPTIONS
 *   - design/src/commands.ts COMMAND_DESCRIPTIONS (if present)
 *
 * Output: goldband/llms.txt at repo root.
 *
 * Refresh: invoked by `bun run gen:surfaces` after manifest surface generation.
 *
 * Convention: https://llmstxt.org/ (single-file index agents can crawl).
 */

import * as fs from 'fs';
import * as path from 'path';
import { COMMAND_DESCRIPTIONS as BROWSE_COMMANDS } from '../browse/src/commands';

const ROOT = path.resolve(import.meta.dir, '..');
const OUTPUT = path.join(ROOT, 'goldband', 'llms.txt');

interface SkillEntry {
  name: string;
  description: string;
}

/**
 * Best-effort import of the design CLI's COMMAND_DESCRIPTIONS. Only present
 * in a full goldband checkout; absent on minimal installs. Returns {} if the
 * module isn't found rather than throwing.
 */
async function readDesignCommands(): Promise<Record<string, { category: string; description: string; usage?: string }>> {
  const designCommandsPath = path.join(ROOT, 'design', 'src', 'commands.ts');
  if (!fs.existsSync(designCommandsPath)) return {};
  try {
    const mod: unknown = await import(designCommandsPath);
    const m = mod as { COMMAND_DESCRIPTIONS?: Record<string, { category: string; description: string; usage?: string }> };
    return m.COMMAND_DESCRIPTIONS ?? {};
  } catch {
    return {};
  }
}

/**
 * Render a one-line summary from a multi-paragraph description: take the
 * first sentence (up to '.', '!', or '?') and trim. Keeps llms.txt scannable.
 */
function oneLine(text: string): string {
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return first.replace(/\s+/g, ' ').trim();
}

interface GenerateOptions {
  /** Override repo root (for tests). */
  root?: string;
  /** When true, missing skill description should fail the build. */
  strict?: boolean;
}

export interface GenerateResult {
  content: string;
  skills: SkillEntry[];
  browseCommands: string[];
  designCommands: string[];
  warnings: string[];
}

export async function generateLlmsTxt(opts: GenerateOptions = {}): Promise<GenerateResult> {
  const root = opts.root ?? ROOT;
  const warnings: string[] = [];

  const contractPath = path.join(root, 'generated', 'capability-actions.json');
  if (!fs.existsSync(contractPath)) {
    throw new Error(
      `gen-llms-txt: missing generated capability contract: ${contractPath}; run generate-goldband-surfaces.mjs first`,
    );
  }
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8')) as {
    actions?: Array<{ name?: string; description?: string }>;
  };
  if (!Array.isArray(contract.actions)) {
    throw new Error('gen-llms-txt: generated capability contract has no actions');
  }
  const skills: SkillEntry[] = contract.actions.map((action, index) => {
    if (!action.name || !action.description) {
      throw new Error(
        `gen-llms-txt: capability action ${index} is missing name or description`,
      );
    }
    return { name: action.name, description: action.description };
  });
  skills.sort((a, b) => a.name.localeCompare(b.name));

  const browseCommands = Object.keys(BROWSE_COMMANDS).sort();
  const designCommands = Object.keys(await readDesignCommands()).sort();

  const lines: string[] = [];
  lines.push('# goldband');
  lines.push('');
  lines.push("> goldband is Goldband Loop: AI coding skills + a fast headless browser binary + a design CLI. This file indexes every capability so agents can discover and invoke them without crawling individual SKILL.md files.");
  lines.push('');
  lines.push('Conventions:');
  lines.push('- Capabilities use `$goldband <capability> <action>`; historical workflow names are not aliases.');
  lines.push('- Browse commands run as `browse <command> [args]` (or `$B` shorthand).');
  lines.push('- Design commands run as `design <command> [args]` (or `$D`).');
  lines.push('- Project-specific config lives in `CLAUDE.md`. Always read it first.');
  lines.push('');

  lines.push('## Capability actions');
  lines.push('');
  for (const skill of skills) {
    const summary = oneLine(skill.description);
    lines.push(`- \`$goldband ${skill.name.replace('/', ' ')}\`: ${summary}`);
  }
  lines.push('');

  lines.push('## Browse Commands');
  lines.push('');
  lines.push('Run with `browse <command> [args]`. Goldband guidance: `manuals/browser.md`.');
  lines.push('');
  const byCategory: Record<string, Array<{ name: string; description: string; usage?: string }>> = {};
  for (const cmd of browseCommands) {
    const meta = BROWSE_COMMANDS[cmd];
    const cat = meta.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ name: cmd, description: meta.description, usage: meta.usage });
  }
  for (const cat of Object.keys(byCategory).sort()) {
    lines.push(`### ${cat}`);
    for (const cmd of byCategory[cat]) {
      const usage = cmd.usage ? `\`${cmd.usage}\`` : `\`${cmd.name}\``;
      lines.push(`- ${usage}: ${oneLine(cmd.description)}`);
    }
    lines.push('');
  }

  if (designCommands.length > 0) {
    lines.push('## Design Commands');
    lines.push('');
    lines.push('Run with `design <command> [args]`.');
    lines.push('');
    const designMeta = await readDesignCommands();
    for (const cmd of designCommands) {
      const meta = designMeta[cmd];
      lines.push(`- \`${cmd}\`: ${oneLine(meta.description)}`);
    }
    lines.push('');
  }

  lines.push('## More');
  lines.push('');
  lines.push('- Repository: https://github.com/leo110047/goldband');
  lines.push('- Top-level guide: `SKILL.md`');
  lines.push('- Project ethos: `ETHOS.md`');
  lines.push('- This file is auto-generated by `bun run gen:surfaces`.');
  lines.push('');

  return {
    content: lines.join('\n'),
    skills,
    browseCommands,
    designCommands,
    warnings,
  };
}

export async function writeLlmsTxt(opts: GenerateOptions & { outputPath?: string } = {}): Promise<GenerateResult> {
  const result = await generateLlmsTxt(opts);
  const outputPath = opts.outputPath ?? OUTPUT;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, result.content, { encoding: 'utf-8' });
  return result;
}

// ─── CLI entry ──────────────────────────────────────────────
// Wrapped in an IIFE so top-level await doesn't make this module async-by-
// import so library consumers can call the generator without CLI side effects.
if (import.meta.main) {
  void (async () => {
    const strict = process.argv.includes('--strict');
    const dryRun = process.argv.includes('--dry-run');
    const result = dryRun
      ? await generateLlmsTxt({ strict })
      : await writeLlmsTxt({ strict });

    for (const w of result.warnings) console.error(`[gen-llms-txt] WARN: ${w}`);

    if (dryRun) {
      const existing = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf-8') : '';
      if (existing !== result.content) {
        console.error('[gen-llms-txt] OUT OF DATE — run `bun run gen:surfaces` to regenerate goldband/llms.txt');
        process.exit(1);
      }
      console.log('[gen-llms-txt] up to date');
    } else {
      console.log(`[gen-llms-txt] wrote ${OUTPUT}`);
      console.log(`[gen-llms-txt]   skills=${result.skills.length} browse=${result.browseCommands.length} design=${result.designCommands.length}`);
    }
  })();
}
