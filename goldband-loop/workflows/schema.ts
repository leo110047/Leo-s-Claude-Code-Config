import type { SchemaValidator } from './types';

export type ReviewFinding = {
  file: string;
  line?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  summary: string;
  evidence?: string;
  recommendation?: string;
};

const severities = new Set(['critical', 'high', 'medium', 'low', 'info']);

export const anySchema: SchemaValidator = {
  name: 'any',
  validate(value) {
    return value;
  },
};

export const objectSchema: SchemaValidator<Record<string, unknown>> = {
  name: 'object',
  validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('expected object output');
    }
    return value as Record<string, unknown>;
  },
};

export const textSchema: SchemaValidator<string> = {
  name: 'text',
  validate(value) {
    if (typeof value !== 'string') throw new Error('expected string output');
    return value;
  },
};

export const findingsSchema: SchemaValidator<ReviewFinding[]> = {
  name: 'review-findings',
  validate(value) {
    if (!Array.isArray(value)) throw new Error('expected findings array');
    return value.map(validateFinding);
  },
};

export function normalizeFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  const out: ReviewFinding[] = [];
  for (const finding of findings) {
    const key = [
      finding.file,
      finding.line ?? '',
      finding.severity,
      finding.summary,
    ].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

function validateFinding(value: unknown): ReviewFinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('finding must be an object');
  }
  const item = value as Record<string, unknown>;
  const file = requiredString(item.file, 'file');
  const severity = requiredString(item.severity, 'severity');
  if (!severities.has(severity)) throw new Error(`invalid severity: ${severity}`);
  const summary = requiredString(item.summary, 'summary');
  return {
    file,
    line: optionalLine(item.line),
    severity: severity as ReviewFinding['severity'],
    summary,
    evidence: optionalString(item.evidence),
    recommendation: optionalString(item.recommendation),
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`finding.${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('optional field must be string');
  return value.trim() || undefined;
}

function optionalLine(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('finding.line must be a positive integer');
  }
  return value;
}
