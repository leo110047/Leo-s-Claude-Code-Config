---
name: frontend-design
description: |
  Use when creating, restyling, or reviewing frontend pages, components,
  dashboards, tools, posters, artifacts, or application screens.

  Best fit for turning product requirements into a visual direction, then
  checking design quality, originality, craft, and usability with concrete
  browser or screenshot evidence.
license: Complete terms in LICENSE.txt
---

This skill guides frontend design and implementation for components, pages,
apps, dashboards, artifacts, posters, and visual UI refinements.

Design taste is subjective, but critique can be structured. Use this skill to
make deliberate visual decisions, avoid generic template output, and verify that
the resulting UI is understandable and usable.

## When to Use

- Creating or restyling frontend pages, components, dashboards, tools, posters,
  artifacts, or application screens
- Turning product requirements into a visual direction before coding
- Reviewing whether an existing UI feels coherent, original, well-crafted, and
  usable
- Improving visual quality after an implementation works but still looks generic

## Source Of Truth

Before designing or coding, check for an existing design source:

- If the repo has `DESIGN.md`, read it and treat it as the project design source
  of truth.
- If the product already has a design system, match it before introducing a new
  direction.
- If no source exists, define the design direction before writing components:
  typography, color, spacing, layout, motion, and interaction states.

Do not override an existing product system just to make the result more novel.

## Design Contract

For meaningful UI work, define the contract before implementation:

- Outcome: what finished visual and interaction state the user should see.
- Verification: how to inspect the result, usually with browser interaction,
  screenshots, responsive checks, and task-flow checks.
- Constraints: existing design system, framework, accessibility requirements,
  assets, allowed dependencies, performance budget, and forbidden scope.
- Iteration policy: record design decisions, screenshots or observations,
  issues found, fixes made, and scope intentionally left alone.
- Error handling: pause and report when required assets, brand guidance,
  runnable app state, or product requirements are missing.

## Four-Dimension Review

Evaluate frontend work across four dimensions. These are review lenses, not a
single fixed style.

### Design Quality

The UI should feel like a coherent whole rather than assembled parts. Colors,
typography, layout, imagery, shape language, density, and motion should create a
shared mood or identity that fits the product context.

### Originality

Originality means visible custom decisions, not novelty for its own sake. A
human designer should be able to identify choices made for this product,
audience, and workflow.

Treat these as low-originality signals when they appear without a product reason
or strong execution:

- unmodified library defaults or stock components
- generic SaaS card grids with no information architecture
- purple gradients over white cards
- predictable nav / hero / cards composition
- decorative pills, icons, glows, blobs, or glass panels that do not clarify
  hierarchy
- bento layouts used as a visual shortcut instead of a content structure
- one-font, one-weight interfaces with no typographic hierarchy

These patterns are not banned. They fail when they are used as default filler
rather than as deliberate design choices.

### Craft

Craft is the technical execution of the visual system:

- clear type hierarchy and readable line lengths
- consistent spacing rhythm and alignment
- color harmony, contrast, and state distinction
- responsive behavior without overflow or cramped controls
- visible focus states, hover states, active states, and disabled states
- motion that supports attention instead of distracting from the task

### Functionality

The UI must be usable independent of aesthetics. Users should understand where
they are, what matters most, where the primary action is, and how to complete the
main task without guessing.

## Workflow

1. Read the source of truth and existing UI patterns.
2. State the design contract before coding.
3. Implement real working UI, not a static mock unless the user asked for one.
4. Verify in the browser when the app needs a runtime. Use screenshots and
   interaction checks where feasible.
5. Review against the four dimensions. If design quality or originality is weak,
   revise the direction. If craft or functionality fails, fix the execution.

## Completion Check

Before considering UI work complete, confirm:

- The design matches the repo or product source of truth.
- The UI has a coherent mood and hierarchy.
- The result has product-specific decisions rather than template defaults.
- Typography, spacing, color, states, and responsiveness hold up in the tested
  viewports.
- The primary user task is understandable and completable.
- Any unverified browser, screenshot, asset, or responsive check is reported
  explicitly.
