# Loop Engineering

## Baseline Policy

Use an explicit loop only when the target can be evaluated repeatedly and each
iteration can make the target measurably more true. Do not use a loop to avoid
making a clear design decision.

## Required Behavior

- Define the target outcome, evaluation signal, iteration cap, and stop
  condition before the loop starts.
- Keep each iteration scoped to one hypothesis or improvement axis.
- Capture evidence after every iteration: command output, screenshot, metric,
  diff summary, review finding, or user-visible behavior.
- Stop when the target is met, the iteration cap is reached, the same blocker
  repeats, or the evaluation signal stops improving.
- Use workflow or custom agents for repeated critique/exploration work instead
  of embedding long loop instructions in portable skills.

## Failure Signals

- The loop keeps changing unrelated files.
- The evaluation signal is subjective or missing.
- Later iterations undo earlier verified improvements.
- Token, time, or external-service cost grows without a stronger stopping rule.
