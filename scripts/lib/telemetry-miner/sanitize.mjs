import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stableIdFrom } = require('../telemetry-schema.cjs');
const {
  detectSecrets,
} = require('../../../hooks/scripts/lib/hook-router/secret-patterns.js');

const ID_KEYS = new Set([
  'event_id',
  'parent_event_id',
  'run_id',
  'runId',
  'sessionId',
  'session_id',
  'artifactId',
]);

export function sanitizeEvent(event) {
  const preScan = detectSecrets(JSON.stringify(event));
  if (preScan.length > 0) {
    return {
      retained: false,
      reason: 'secret-pattern-detected',
      secretScan: preScan,
    };
  }

  const value = sanitizeValue(event, []);
  const postScan = detectSecrets(JSON.stringify(value));
  if (postScan.length > 0) {
    return {
      retained: false,
      reason: 'secret-pattern-detected-after-sanitize',
      secretScan: postScan,
    };
  }

  return {
    retained: true,
    value,
    report: {
      secret_scan: 'clean',
      path_rewrites: true,
      id_anonymization: true,
      content_truncation: true,
    },
  };
}

export function anonymizedId(value, prefix = 'evt') {
  if (value === null || value === undefined || value === '') return null;
  return stableIdFrom(String(value), prefix);
}

export function sanitizePath(value) {
  return sanitizeString(String(value || ''), 'path');
}

function sanitizeValue(value, keyPath) {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitizeValue(item, [...keyPath, String(index)]),
    );
  }
  if (value && typeof value === 'object') return sanitizeObject(value, keyPath);
  if (typeof value === 'string') {
    return sanitizeString(value, keyPath[keyPath.length - 1]);
  }
  return value;
}

function sanitizeObject(value, keyPath) {
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith('__')) continue;
    if (ID_KEYS.has(key)) {
      output[key] = anonymizedId(
        item,
        key.toLowerCase().includes('run') ? 'run' : 'evt',
      );
    } else {
      output[key] = sanitizeValue(item, [...keyPath, key]);
    }
  }
  return output;
}

function sanitizeString(value, key) {
  let output = value
    .replace(/\/Users\/[^/"'\s,)]+(?:\/([^\s"',)]*))?/g, posixUserPath)
    .replace(
      /[A-Za-z]:\\Users\\[^\\/"'\s,)]+(?:\\([^"'\s,)]*))?/g,
      windowsUserPath,
    )
    .replace(/\/private\/var\/folders\/[^\s"',)]*/g, '/tmp/sanitized')
    .replace(/\/private\/tmp\/[^\s"',)]*/g, '/tmp/sanitized')
    .replace(/\/var\/folders\/[^\s"',)]*/g, '/tmp/sanitized');

  if (/content|new_string|old_string|prompt|commandPreview/i.test(key || '')) {
    output = output.slice(0, 240);
  }
  return output;
}

function posixUserPath(_match, rest) {
  return rest ? `/repo/${rest}` : '/repo';
}

function windowsUserPath(_match, rest) {
  if (!rest) return '/repo';
  return `/repo/${rest.replaceAll('\\', '/')}`;
}
