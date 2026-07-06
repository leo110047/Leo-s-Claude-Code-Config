import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);

export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
export const DEFAULT_DAYS = 30;
export const DEFAULT_LIMIT = 20;
export const CLASSIFICATION_CONFIDENCE = 'inferred';

export const TAXONOMY = {
  'false-positive-deny': {
    meaning: 'A deny candidate that may have blocked a safe operation.',
    action: 'Human-label the case before changing the rule.',
  },
  'true-deny': {
    meaning: 'A deny candidate that appears aligned with a safety rule.',
    action: 'Keep replay coverage stable and watch for repeated regressions.',
  },
  'workflow-drift': {
    meaning: 'Workflow evidence stopped outside the declared happy path.',
    action:
      'Inspect the workflow for typed-runtime migration or clearer stop states.',
  },
  'cross-review-rejection': {
    meaning:
      'Cross-review asked for changes, escalated, or blocked completion.',
    action:
      'Review rejection reasons and tighten implementer/reviewer handoff.',
  },
  'mode-enforcement-block': {
    meaning: 'Careful or freeze mode blocked a requested operation.',
    action: 'Check whether the mode policy was useful or too broad.',
  },
};
