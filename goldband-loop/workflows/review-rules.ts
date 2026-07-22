import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  selectedSpecialists: [];
  aggregateRulesBytes: number;
};

// Measured 2026-07-11 core baseline: 23,262 bytes. This limit provides
// headroom without allowing silent truncation.
export const MAX_REVIEW_RULES_BYTES = 32 * 1024;

const require = createRequire(import.meta.url);

type TrustedRulesRuntime = {
  resolverScript: string;
  rulesDirectory: string;
};

function loadTrustedRulesRuntime(): TrustedRulesRuntime | undefined {
  const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const configFile = join(runtimeRoot, 'trusted-runtime.json');
  if (!existsSync(configFile)) return undefined;

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `trusted review Rules configuration is invalid: ${configFile}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (config.schemaVersion !== 2) {
    throw new Error(`trusted review Rules configuration has an unsupported schema: ${configFile}`);
  }

  const requirePath = (field: string, kind: 'file' | 'directory'): string => {
    const value = config[field];
    if (typeof value !== 'string' || !isAbsolute(value) || !existsSync(value)) {
      throw new Error(`trusted review Rules configuration field ${field} is invalid: ${configFile}`);
    }
    const resolved = realpathSync(value);
    const stats = statSync(resolved);
    if ((kind === 'file' && !stats.isFile()) || (kind === 'directory' && !stats.isDirectory())) {
      throw new Error(`trusted review Rules configuration field ${field} is not a ${kind}: ${configFile}`);
    }
    return resolved;
  };

  return {
    resolverScript: requirePath('rulesResolverScript', 'file'),
    rulesDirectory: requirePath('rulesDirectory', 'directory'),
  };
}

const trustedRulesRuntime = loadTrustedRulesRuntime();

function loadRulesResolver(): RulesResolver {
  const candidates = [
    trustedRulesRuntime?.resolverScript,
    '../../hooks/scripts/lib/rules-resolver',
    join(homedir(), '.codex', 'review-runtime', 'rules-resolver.js'),
    join(homedir(), '.codex', 'hooks', 'shared', 'rules-resolver.js'),
    join(homedir(), '.claude', 'hooks', 'scripts', 'lib', 'rules-resolver.js'),
  ].filter((candidate): candidate is string => Boolean(candidate));
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

function withTrustedRulesDirectory(
  options: Record<string, unknown>,
): Record<string, unknown> {
  return trustedRulesRuntime
    ? { ...options, rulesDir: trustedRulesRuntime.rulesDirectory }
    : options;
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
  const bundle = rulesResolver.resolveRules(withTrustedRulesDirectory({
    repoRoot,
    phase: 'review',
    scope: diff,
    snapshot,
  }));
  return { bundle, text: assertRulesPayloadBudget(bundle, 'core') };
}

export function createReviewRulesSnapshot(repoRoot: string): RulesSnapshot {
  return rulesResolver.createRulesSnapshot(
    withTrustedRulesDirectory({ repoRoot }),
  );
}

export function buildReviewPromptTelemetry(options: {
  host: string;
  corePrompt: string;
  coreBundle: RulesBundle;
}): ReviewPromptTelemetry {
  const bundleBytes = (bundle: RulesBundle) =>
    Buffer.byteLength(rulesResolver.formatRulesBundle(bundle));
  const coreRulesBytes = bundleBytes(options.coreBundle);
  return {
    host: options.host,
    rulesCount: options.coreBundle.rules.length,
    rulesBytes: coreRulesBytes,
    promptBytes: Buffer.byteLength(options.corePrompt),
    selectedSpecialists: [],
    aggregateRulesBytes: coreRulesBytes,
  };
}
