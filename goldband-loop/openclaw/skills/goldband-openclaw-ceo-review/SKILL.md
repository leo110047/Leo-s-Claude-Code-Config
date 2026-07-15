---
name: goldband-openclaw-ceo-review
description: Use when asked to review a plan, challenge a proposal, run a CEO review, poke holes in an approach, think bigger about scope, or decide whether to expand or reduce the plan.
---

# CEO Plan Review

Review the plan. Do not implement it.

Your job is to decide whether the plan is the right scope, the right shape, and
the right next move. Keep the active prompt compact: use this file for the
default review, and load `references/deep-ceo-review-rubric.md` only when the
plan is large, ambiguous, high-risk, user-facing, security-sensitive, or when the
user asks for a full CEO gauntlet.

## Operating Standard

Prefer the simplest viable architecture. Add process, phases, agents, diagrams,
observability, or cross-cutting review only when it clearly reduces real risk or
the user explicitly asks for that depth.

Evaluate scope with these criteria:

1. **Outcome fit:** Does the plan solve the user's real problem directly, or a
   proxy problem?
2. **Existing leverage:** What existing code, workflow, or product surface
   should be reused instead of rebuilt?
3. **Complexity test:** Is each new abstraction, service, workflow, or step
   justified by measured risk, repeated use, or a stable ownership boundary?
4. **Blast radius:** What can break, who notices, and how easy is rollback?
5. **Verification:** What evidence would prove this plan worked after
   implementation?
6. **Scope choice:** Should the user expand, hold, reduce, or reframe the plan?

## Modes

Pick one mode and state why:

- **SCOPE EXPANSION:** Use when the goal is exploratory and the user wants the
  most ambitious version. Propose expansions as opt-in choices.
- **SELECTIVE EXPANSION:** Use when the baseline is good but clear optional
  improvements exist. Keep the baseline intact.
- **HOLD SCOPE:** Use for bug fixes, refactors, production work, or plans with a
  clear requested boundary.
- **SCOPE REDUCTION:** Use when the plan is oversized for the outcome, timeline,
  or available evidence.

The user controls scope. Never silently add or remove work.

## Review Flow

1. Read the plan and any relevant repo instructions or current files needed to
   verify claims.
2. State the mode, the desired outcome, and the core risk in 3-5 sentences.
3. Compare 2-3 approaches when the path is not obvious. One should be the
   minimal viable approach. Only include an ideal architecture when its extra
   complexity has a clear payoff.
4. Review the plan against the six operating criteria above.
5. Ask one blocking question at a time only when the answer changes the
   recommended path.
6. End with a concise recommendation: proceed, revise, reduce, split, or stop.

## When To Load The Deep Rubric

Load `references/deep-ceo-review-rubric.md` if any of these are true:

- The plan crosses multiple systems, teams, data stores, or external providers.
- The change affects authentication, authorization, secrets, payments, customer
  data, legal/compliance, deploy/release automation, or irreversible actions.
- The user asks for exhaustive review, 10x product thinking, diagrams, full
  failure-mode mapping, or CEO heuristics.
- You cannot make a confident recommendation from the compact criteria.

When you load the deep rubric, use only the sections relevant to the risk. Do
not run every checklist by default.

## Output

Use this structure:

**CEO REVIEW SUMMARY**
- **Mode:** selected mode and why
- **Recommendation:** proceed, revise, reduce, split, or stop
- **Strongest evidence:** the 2-3 facts that most shaped the recommendation
- **Scope decision:** what stays in, what is optional, what should be cut
- **Blocking questions:** only questions that change the recommendation
- **Verification bar:** what proof implementation must produce
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED

Save the summary to `memory/` for future reference.

## Hard Rules

- Do not edit files, stage, commit, push, merge, deploy, or change external
  state.
- Do not claim facts about the repo without reading current evidence.
- Do not force exhaustive process when compact criteria are enough.
- Do not treat token generation as free; include verification, maintenance,
  runtime cost, and failure blast radius in the scope decision.
