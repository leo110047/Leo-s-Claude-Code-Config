# Advanced Topics

Future-facing ideas that are plausible for this repo, but not fully wired today.

## Better Skill Usage Truth

Current prompt telemetry can tell us:
- which rules matched
- which suggestions were emitted

It still cannot prove a markdown skill was actually used, because current hook payloads do not expose active skill lists.

## Dedicated Prompt-Suggestion Test Harness

Today, prompt suggestions are tested with direct script invocation. A stronger next step would be a small fixture runner for:
- prompt text
- expected top-N skills
- expected conflict suppression

## Authoritative Claude Code Reference Skill

This repo would benefit from a dedicated reference skill for:
- plugin manifest fields
- hook payload shapes
- plugin env vars
- install/merge expectations

That would be more valuable than continuing to overload `skill-developer` with both process guidance and low-level API reference.

## Stronger Telemetry Review

Current telemetry is enough to spot:
- under-suggested skills
- unused code-backed scripts
- mode enforcement rates

The next step is better reporting, not more raw event volume.
