# Escalation: Stop, Ask, or Proceed

## Baseline Policy

Default to acting autonomously on work that is reversible, inside the stated
scope, and verifiable in the current turn. Asking is reserved for decisions
that genuinely belong to the user. Stopping is mandatory when a tripwire below
fires. This rule converts "when to give up or check in" from judgment into
mechanics so it does not depend on the model's own confidence.

## Proceed Without Asking

- The action is reversible, in scope, and its result can be verified now.
- The user already authorized this class of action in this session or in a
  durable instruction.

## Ask Before Acting

- The action is irreversible or outward-facing: force-push, publish, release,
  data deletion, spending money, messaging other people.
- Two materially different interpretations of the request are both
  implementable and lead to different work.
- The correct fix requires expanding scope beyond what the user named.

## Hard Stop Tripwires

Stop editing, report findings, and ask when any of these fire:

- Two consecutive fix attempts did not change the failing signal. Do not try a
  third variation of the same hypothesis; write down what was tried and what
  was observed instead.
- You are about to weaken, skip, or delete a test, assertion, type, or lint
  rule so that a check passes.
- You discover mid-task that the plan or request rests on a false premise.
- A fix appears to work but you cannot clearly explain the causal mechanism.
- The diff keeps growing into files unrelated to the stated task.

## Calibration

- Confidence is not evidence. The repository outranks your memory of the
  repository; re-read a file before editing it.
- When your explanation and fresh tool output disagree, the tool output wins.
- Prefer "unknown, and here is how I would verify" over a fluent guess.

## When Stopping

Leave the working tree clean or clearly described. Report: hypotheses tried,
evidence observed, what is verified versus suspected, and the single question
or decision that unblocks the work.
