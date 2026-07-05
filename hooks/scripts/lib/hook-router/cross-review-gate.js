let core = null;

function loadCore() {
  if (core) return core;
  core = require('../../../../goldband-loop/cross-review/core.cjs');
  return core;
}

function evaluateCrossReviewGate(input, options) {
  return loadCore().evaluateCrossReviewGate(input, options);
}

function armFromPrompt(input, options) {
  return loadCore().armFromPrompt(input, options);
}

module.exports = {
  armFromPrompt,
  evaluateCrossReviewGate,
};
