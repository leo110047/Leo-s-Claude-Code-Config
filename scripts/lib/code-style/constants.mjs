export const CODE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.sh',
  '.bash',
  '.py',
  '.ps1',
]);

export const JS_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
]);

export const SHELL_EXTENSIONS = new Set(['.sh', '.bash']);
export const PY_EXTENSIONS = new Set(['.py']);

export const TEXT_SCAN_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  '.md',
  '.txt',
  '.json',
  '.toml',
  '.yaml',
  '.yml',
]);
