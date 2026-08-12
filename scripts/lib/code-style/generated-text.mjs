import { config, run, ToolError } from './config.mjs';
import { fileContent, toRepoRelative } from './files.mjs';

const STYLE_CONFIG_FILE = '.goldband-style.json';

export function loadLargeGeneratedTextPolicy(mode) {
  const buffer = fileContent(STYLE_CONFIG_FILE, mode);
  if (!buffer) return new Map();
  requireTrackedPath(STYLE_CONFIG_FILE, 'style config');

  const document = parseDocument(buffer);
  if (document.schemaVersion !== 1) {
    throw contractError('schemaVersion must be 1');
  }
  if (!Array.isArray(document.largeGeneratedTextFiles)) {
    throw contractError('largeGeneratedTextFiles must be an array');
  }

  const policy = new Map();
  for (const [index, entry] of document.largeGeneratedTextFiles.entries()) {
    const normalized = validateEntry(entry, index);
    if (policy.has(normalized.path)) {
      throw contractError(`duplicate generated text path: ${normalized.path}`);
    }
    policy.set(normalized.path, normalized);
  }
  return policy;
}

export function allowsLargeGeneratedText(policy, file, size) {
  const entry = policy.get(file);
  return Boolean(entry && size <= entry.maxBytes);
}

function parseDocument(buffer) {
  try {
    const document = JSON.parse(buffer.toString('utf8'));
    if (!document || Array.isArray(document) || typeof document !== 'object') {
      throw new Error('root must be an object');
    }
    return document;
  } catch (error) {
    throw contractError(`invalid JSON: ${error.message}`);
  }
}

function validateEntry(entry, index) {
  const label = `largeGeneratedTextFiles[${index}]`;
  if (!entry || Array.isArray(entry) || typeof entry !== 'object') {
    throw contractError(`${label} must be an object`);
  }
  const file = requireExactPath(entry.path, `${label}.path`);
  const generator = requireExactPath(entry.generator, `${label}.generator`);
  if (file === STYLE_CONFIG_FILE || file === generator) {
    throw contractError(`${label} must name a separate generated file`);
  }
  if (!Number.isSafeInteger(entry.maxBytes)) {
    throw contractError(`${label}.maxBytes must be an integer`);
  }
  if (entry.maxBytes <= config.maxTextBytes) {
    throw contractError(
      `${label}.maxBytes must exceed the ordinary text limit ${config.maxTextBytes}`,
    );
  }
  if (entry.maxBytes > config.maxGeneratedTextBytes) {
    throw contractError(
      `${label}.maxBytes ${entry.maxBytes} exceeds the generated text hard cap ${config.maxGeneratedTextBytes}`,
    );
  }
  requireTrackedPath(file, 'generated text file');
  requireTrackedPath(generator, 'generator');
  return { path: file, generator, maxBytes: entry.maxBytes };
}

function requireExactPath(value, label) {
  if (typeof value !== 'string' || !value) {
    throw contractError(`${label} must be a non-empty repo-relative path`);
  }
  if (/[\u0000-\u001f*?[\]{}]/.test(value)) {
    throw contractError(`${label} must be exact; globs are not allowed`);
  }
  const normalized = toRepoRelative(value);
  if (!normalized || normalized !== value) {
    throw contractError(`${label} must be a normalized repo-relative path`);
  }
  return normalized;
}

function requireTrackedPath(file, label) {
  const result = run('git', [
    'ls-files',
    '--stage',
    '-z',
    '--',
    `:(top,literal)${file}`,
  ]);
  const entries = result.stdout.split('\0').filter(Boolean);
  if (result.status === 0 && entries.length === 1) {
    const match = entries[0].match(/^(\d{6}) [0-9a-f]+ 0\t(.*)$/s);
    if (match && ['100644', '100755'].includes(match[1]) && match[2] === file) {
      return;
    }
  }
  throw contractError(
    `${label} must be one exact regular file tracked in the Git index: ${file}`,
  );
}

function contractError(message) {
  return new ToolError(`${STYLE_CONFIG_FILE}: ${message}`);
}
