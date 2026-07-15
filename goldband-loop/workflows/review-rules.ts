import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ReviewSpecialist } from './review-engine';

type RuleRecord = {
  id: string;
  sourceFile: string;
  content: string;
  contentHash: string;
};

export type RulesBundle = {
  repoRoot: string;
  rules: RuleRecord[];
  ruleIds: string[];
  contentHash: string;
};

export type RulesSnapshot = {
  repoRoot: string;
  rulesDir: string;
  manifest: { rules: Array<{ id: string }> };
  rulesById: Readonly<Record<string, RuleRecord>>;
};

type RulesResolver = {
  createRulesSnapshot(options: Record<string, unknown>): RulesSnapshot;
  resolveRules(options: Record<string, unknown>): RulesBundle;
  formatRulesBundle(bundle: RulesBundle): string;
};

export type ReviewPromptTelemetry = {
  host: string;
  rulesCount: number;
  rulesBytes: number;
  promptBytes: number;
  selectedSpecialists: ReviewSpecialist[];
  aggregateRulesBytes: number;
};

// Measured 2026-07-11 all-groups baseline: core 23,262 bytes; largest
// specialist 17,785 bytes; all specialists plus core 124,353 bytes. These
// limits provide about 41% core and 32% full-fan-out headroom without silent
// truncation.
export const MAX_REVIEW_RULES_BYTES = 32 * 1024;
export const MAX_REVIEW_AGGREGATE_RULES_BYTES = 160 * 1024;

const require = createRequire(import.meta.url);

function loadRulesResolver(): RulesResolver {
  const candidates = [
    '../../hooks/scripts/lib/rules-resolver',
    join(homedir(), '.codex', 'review-runtime', 'rules-resolver.js'),
    join(homedir(), '.codex', 'hooks', 'shared', 'rules-resolver.js'),
    join(homedir(), '.claude', 'hooks', 'scripts', 'lib', 'rules-resolver.js'),
  ];
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      return require(candidate) as RulesResolver;
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Goldband review Rules resolver unavailable: ${failures.join(' | ')}`);
}

const rulesResolver = loadRulesResolver();

function specialistScope(specialist: ReviewSpecialist): string {
  if (specialist === 'security') return 'security auth permission provider boundary';
  if (specialist === 'api-host-parity') return 'installer git provider adapter host parity';
  return specialist;
}

export function assertRulesPayloadBudget(
  bundle: RulesBundle,
  label: string,
): string {
  const text = rulesResolver.formatRulesBundle(bundle);
  const actualBytes = Buffer.byteLength(text);
  if (actualBytes > MAX_REVIEW_RULES_BYTES) {
    throw new Error(
      `review Rules payload exceeds budget for ${label}: selected=${bundle.ruleIds.join(',')} actualBytes=${actualBytes} limit=${MAX_REVIEW_RULES_BYTES}`,
    );
  }
  return text;
}

export function coreReviewRules(
  repoRoot: string,
  diff: string,
  snapshot?: RulesSnapshot,
) {
  const bundle = rulesResolver.resolveRules({
    repoRoot,
    phase: 'review',
    scope: diff,
    snapshot,
  });
  return { bundle, text: assertRulesPayloadBudget(bundle, 'core') };
}

export function specialistReviewRules(
  repoRoot: string,
  specialist: ReviewSpecialist,
  snapshot?: RulesSnapshot,
) {
  const bundle = rulesResolver.resolveRules({
    repoRoot,
    phase: 'review',
    scope: specialistScope(specialist),
    snapshot,
  });
  return { bundle, text: assertRulesPayloadBudget(bundle, specialist) };
}

export function createReviewRulesSnapshot(repoRoot: string): RulesSnapshot {
  return rulesResolver.createRulesSnapshot({ repoRoot });
}

export function buildReviewPromptTelemetry(options: {
  host: string;
  corePrompt: string;
  coreBundle: RulesBundle;
  specialistPrompts: Array<{ prompt: string; bundle: RulesBundle }>;
  selectedSpecialists: ReviewSpecialist[];
}): ReviewPromptTelemetry {
  const bundleBytes = (bundle: RulesBundle) =>
    Buffer.byteLength(rulesResolver.formatRulesBundle(bundle));
  const coreRulesBytes = bundleBytes(options.coreBundle);
  const aggregateRulesBytes =
    coreRulesBytes +
    options.specialistPrompts.reduce(
      (total, item) => total + bundleBytes(item.bundle),
      0,
    );
  if (aggregateRulesBytes > MAX_REVIEW_AGGREGATE_RULES_BYTES) {
    throw new Error(
      `review aggregate Rules payload exceeds budget: specialists=${options.selectedSpecialists.join(',')} actualBytes=${aggregateRulesBytes} limit=${MAX_REVIEW_AGGREGATE_RULES_BYTES}`,
    );
  }
  return {
    host: options.host,
    rulesCount: options.coreBundle.rules.length,
    rulesBytes: coreRulesBytes,
    promptBytes:
      Buffer.byteLength(options.corePrompt) +
      options.specialistPrompts.reduce(
        (total, item) => total + Buffer.byteLength(item.prompt),
        0,
      ),
    selectedSpecialists: options.selectedSpecialists,
    aggregateRulesBytes,
  };
}
