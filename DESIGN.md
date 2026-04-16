# goldband Design Guidance

This file is the project design source of truth for UI, frontend, visual, and presentation work in this repo.

Use it when:
- designing or implementing pages, components, dashboards, landing pages, mockups, posters, or other visual artifacts
- restyling existing UI
- generating design directions before coding

If a task is purely backend, infrastructure, docs-only, or non-visual, this file does not apply.

## Design Intent

goldband should feel:
- sharp, deliberate, and high-signal
- tool-like without looking like an internal admin panel
- opinionated without becoming noisy or gimmicky
- polished enough to look designed, not merely assembled

The target is not "pretty SaaS." The target is a clear point of view with disciplined execution.

## Baseline Visual Stance

When there is no stronger product-specific system, default to:
- editorial + utilitarian rather than generic dashboard chrome
- strong hierarchy and composition before components
- restrained palette with one assertive accent
- expressive typography with a clear display/body split
- intentional motion used sparingly for emphasis

Do not choose light or dark mode by habit alone. Pick the mode that best serves the product context and execute it with conviction.

## Required Design Decisions Before Coding

Before writing UI code, lock these five items:
- Typography: what is the display face, what is the body face, and why
- Color: what is the base palette, what is the accent, and what should never appear
- Spacing: what density model this interface uses
- Layout: what creates the first impression and the main visual rhythm
- Motion: where movement adds meaning and where it should stay absent

If these are still vague, stop generating components and decide them first.

## Anti-Slop Rules

Do not ship these unless the existing product already uses them:
- generic gray card-grid SaaS layouts
- default-looking system-font or Inter-first aesthetics
- trend-driven styling used as a shortcut instead of a real hierarchy or point of view
- pills everywhere with no hierarchy
- icon-in-colored-circle decoration as filler
- flat pages with no focal point, no depth, and no compositional risk
- random animation scattered across the page without a choreographed moment

## Typography

- Prefer type with character. Use a distinctive display face and a quieter body face.
- Common fonts are allowed, but they must not become an excuse for default-looking UI with no hierarchy or identity.
- Establish obvious contrast between display text, navigation, body text, metadata, and code/data.
- Avoid making every text style feel equally important.

## Color

- Use a limited palette with clear roles: background, foreground, surface, accent, and muted support tones.
- One confident accent is better than several weak accents.
- Popular palettes are allowed, but they must still create hierarchy, clarity, and a deliberate mood.
- If using dark mode, build depth with layered tones rather than near-black boxes on black.

## Layout And Composition

- Start from composition, not from a pile of cards.
- Every screen should have a visual anchor in the first viewport.
- Use asymmetry, overlap, framing, scale shifts, or aggressive whitespace when appropriate.
- If the interface is dense, make the density feel intentional and structured rather than cramped.
- Repeated components should create rhythm, not wallpaper.

## Components

- Components must support the page's hierarchy instead of flattening it.
- Do not treat cards as the default answer. Use them when they improve clarity, grouping, or rhythm.
- Buttons, chips, tags, and panels should not all share the same radius, weight, and contrast.
- Decorative elements need a job. If they do not improve hierarchy, identity, or comprehension, cut them.

## Motion

- Use a few meaningful motion beats instead of many small effects.
- Good defaults: staged entrance, hover state with intent, scroll reveal when it aids reading order.
- Respect reduced motion. Motion should degrade cleanly.

## Accessibility And Responsiveness

- High design quality includes accessibility and responsive behavior.
- Preserve contrast, keyboard affordance, focus visibility, and readable type scales.
- Mobile layouts must feel designed, not merely stacked.

## Existing Systems

- If the repo or target product already has a design system, match it instead of imposing this file blindly.
- If there is a conflict between an existing product system and this file, the existing product system wins.
- Use this file as the fallback and anti-slop guardrail when no stronger system exists.

## Review Standard

Before considering UI work complete, check:
- Does this have a clear visual point of view?
- Would a human designer recognize deliberate choices here?
- Is there a memorable focal point?
- Did typography, color, spacing, layout, and motion all get explicit decisions?
- Does any part still look like generic AI boilerplate?

If the answer to the last question is yes, the work is not done.
