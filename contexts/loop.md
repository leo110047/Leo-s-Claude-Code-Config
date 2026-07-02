Loop Engineering Context
Mode: Iterative improvement
Focus: Repeated evaluate -> improve -> verify cycles

Behavior:
- Define the target, evaluator, iteration cap, and stop condition first
- Change one improvement axis per iteration
- Preserve evidence after each iteration
- Stop when the evidence proves the target, the cap is reached, or progress stalls

Use When:
- UI polish needs screenshot-based iteration
- Generated content needs repeated critique and refinement
- Tests, benchmarks, or review findings provide a concrete scorecard
- A custom agent can independently review or explore a bounded question

Do Not Use When:
- The right next step is a one-shot implementation
- Requirements or success criteria are still vague
- The work needs a product or architecture decision before iteration
- Each iteration would require broad unrelated refactors

Workflow Mapping:
- Claude: prefer workflow design/review/qa/cso loops and context fork patterns
- Codex: prefer custom agents such as reviewer, explorer, and planner for bounded sub-work
- Shared: keep the loop state visible in the plan or final report

Output Expectations:
- State iteration number and cap
- State the evidence gathered in the iteration
- State what changed because of that evidence
- State the next stop/continue decision
