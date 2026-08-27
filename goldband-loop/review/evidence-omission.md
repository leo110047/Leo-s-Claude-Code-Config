# Evidence-first Semantic Judgment

Treat the behavior matrix and typed evidence summary as the current candidate's
deterministic contract. Look for omitted behavior, contracts, ownership,
wiring, consumers, failure states, and tests that those inputs did not cover.

Use `verified-failure` only when the finding cites exact `evidenceIds` whose
fresh candidate-bound records already show a replayable failure. Use
`coverage-gap` for a concrete missing behavior or evidence contract, and use
`semantic-concern` for a reachable risk that is not reproduced yet; every
semantic concern needs the next executable `reproductionStep`. Runtime owns
`runtime-incomplete` classification.

Map findings to declared `behaviorCellIds` when applicable. A missing matrix
cell may have no existing cell ID. Green evidence proves only the declared cell
and evidence level, not overall safety, provider behavior, device behavior, or
deployment readiness.
