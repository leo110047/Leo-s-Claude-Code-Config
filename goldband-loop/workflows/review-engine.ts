import type { ReviewFinding } from './types';

const REVIEW_SEVERITIES: ReviewFinding['severity'][] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

export function aggregateReviewFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const byKey = new Map<string, ReviewFinding>();
  for (const finding of findings.map(normalizeReviewFinding)) {
    const key = stableFindingKey(finding);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeFindings(existing, finding) : finding);
  }
  return [...byKey.values()].sort(compareFindings);
}

function normalizeReviewFinding(finding: ReviewFinding): ReviewFinding {
  const severity = normalizeSeverity(finding.severity);
  const needsEvidenceDowngrade = (severity === 'critical' || severity === 'high') && !finding.evidence;
  const nextSeverity = needsEvidenceDowngrade ? 'info' : severity;
  return {
    ...finding,
    severity: nextSeverity,
    summary: needsEvidenceDowngrade
      ? `[unverified ${severity}] ${finding.summary}`
      : finding.summary,
    evidence: finding.evidence,
    blocking: Boolean(finding.blocking && !needsEvidenceDowngrade),
    contributingSpecialists: normalizeSpecialistList([
      ...(finding.contributingSpecialists ?? []),
      ...(finding.specialist ? [finding.specialist] : []),
    ]),
  };
}

export function unwrapFindings(parsed: unknown): ReviewFinding[] {
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { findings?: unknown }).findings)) {
    return (parsed as { findings: ReviewFinding[] }).findings;
  }
  if (Array.isArray(parsed)) return parsed as ReviewFinding[];
  throw new Error('review output must be an array or { findings: [...] }');
}

function mergeFindings(a: ReviewFinding, b: ReviewFinding): ReviewFinding {
  return {
    ...a,
    severity: higherSeverity(a.severity, b.severity),
    evidence: mostSpecific(a.evidence, b.evidence),
    recommendation: mostSpecific(a.recommendation, b.recommendation),
    suggestedVerification: mostSpecific(a.suggestedVerification, b.suggestedVerification),
    ruleId: mostSpecific(a.ruleId, b.ruleId),
    policySource: mostSpecific(a.policySource, b.policySource),
    blocking: Boolean(a.blocking || b.blocking),
    contributingSpecialists: normalizeSpecialistList([
      ...(a.contributingSpecialists ?? []),
      ...(b.contributingSpecialists ?? []),
      ...(a.specialist ? [a.specialist] : []),
      ...(b.specialist ? [b.specialist] : []),
    ]),
  };
}

function stableFindingKey(finding: ReviewFinding): string {
  if (finding.category === 'specialist-skipped') {
    return [
      finding.file,
      finding.category,
      finding.specialist ?? '',
      normalizeKeyText(finding.summary),
    ].join('\0');
  }

  return [
    finding.file,
    finding.line ?? '',
    finding.category ?? '',
    normalizeKeyText(finding.failureScenario ?? finding.summary),
  ].join('\0');
}

function compareFindings(a: ReviewFinding, b: ReviewFinding): number {
  return (
    REVIEW_SEVERITIES.indexOf(a.severity) - REVIEW_SEVERITIES.indexOf(b.severity) ||
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.category ?? '').localeCompare(b.category ?? '')
  );
}

function higherSeverity(a: ReviewFinding['severity'], b: ReviewFinding['severity']): ReviewFinding['severity'] {
  return REVIEW_SEVERITIES.indexOf(a) <= REVIEW_SEVERITIES.indexOf(b) ? a : b;
}

function normalizeSeverity(severity: ReviewFinding['severity']): ReviewFinding['severity'] {
  return REVIEW_SEVERITIES.includes(severity) ? severity : 'info';
}

function mostSpecific(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function normalizeSpecialistList(values: string[]): string[] | undefined {
  const list = [...new Set(values.filter(Boolean))].sort();
  return list.length > 0 ? list : undefined;
}

function normalizeKeyText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}
