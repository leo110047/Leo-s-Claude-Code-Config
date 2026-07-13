const os = require('os');
const path = require('path');
const { requireFirst } = require('./module-loader');

let core = null;
let coreLoadAttempted = false;

function coreCandidates() {
  const home = os.homedir();
  return [
    process.env.GOLDBAND_ROOT
      ? path.join(process.env.GOLDBAND_ROOT, 'cross-review', 'core.cjs')
      : null,
    path.resolve(
      __dirname,
      '..',
      '..',
      'goldband-loop',
      'cross-review',
      'core.cjs',
    ),
    path.join(home, '.codex', 'skills', 'goldband', 'cross-review', 'core.cjs'),
    path.join(
      home,
      '.claude',
      'skills',
      'goldband',
      'cross-review',
      'core.cjs',
    ),
  ];
}

function loadCore() {
  if (coreLoadAttempted) return core;
  coreLoadAttempted = true;
  if (core) return core;
  try {
    core = requireFirst(coreCandidates());
  } catch (error) {
    if (error?.code !== 'GOLDBAND_RUNTIME_MODULE_MISSING') throw error;
    core = null;
  }
  return core;
}

function isCrossReviewRequest(input) {
  return /^\/(?:goldband-)?cross-review(?:\s|$)/i.test(
    String(input?.prompt || '').trim(),
  );
}

function evaluateCrossReviewGate(input, options) {
  const loadedCore = loadCore();
  if (!loadedCore) {
    return {
      decision: 'allow',
      blockedBy: null,
      logs: [],
    };
  }
  return loadedCore.evaluateCrossReviewGate(input, options);
}

function armFromPrompt(input, options) {
  const loadedCore = loadCore();
  if (loadedCore) return loadedCore.armFromPrompt(input, options);
  if (isCrossReviewRequest(input)) {
    throw new Error(
      'Goldband cross-review runtime is not installed; rerun the Goldband workflow installer.',
    );
  }
  return null;
}

module.exports = {
  armFromPrompt,
  evaluateCrossReviewGate,
};
