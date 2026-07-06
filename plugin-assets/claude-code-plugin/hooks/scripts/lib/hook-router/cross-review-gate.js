let core = null;
let coreLoadAttempted = false;

function loadCore() {
  if (coreLoadAttempted) return core;
  coreLoadAttempted = true;
  if (core) return core;
  try {
    core = require('../../../../goldband-loop/cross-review/core.cjs');
  } catch (error) {
    if (
      error &&
      error.code === 'MODULE_NOT_FOUND' &&
      String(error.message || '').includes(
        'goldband-loop/cross-review/core.cjs',
      )
    ) {
      core = null;
      return core;
    }
    throw error;
  }
  return core;
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
  return loadedCore ? loadedCore.armFromPrompt(input, options) : null;
}

module.exports = {
  armFromPrompt,
  evaluateCrossReviewGate,
};
