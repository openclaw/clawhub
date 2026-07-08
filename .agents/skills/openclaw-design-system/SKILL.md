---
name: openclaw-design-system
description: Build or modify OpenClaw application UI using canonical semantic tokens, themes, shared CSS foundations, consumer adapters, and established local primitives. Use for product interfaces, component styling, theme work, or design-token integration.
---

# OpenClaw Design System

Use the shared package for foundations and the consumer repository for product
components and layouts.

## Workflow

1. Read [tokens.md](references/tokens.md) before choosing colors, spacing, type, radii, or shadows.
2. Read [consumer-adapters.md](references/consumer-adapters.md) for the current framework.
3. Inspect the consumer's existing shared primitives before creating a component.
4. Use semantic tokens for UI intent; use palette primitives only for documented exceptions.
5. Keep application behavior, routes, and information architecture unchanged unless the task says otherwise.
6. Validate the affected routes with existing tests and real browser screenshots.

## Interface Rules

- Import the complete CSS contract or its focused exported entry points.
- Use local shared primitives before raw controls or one-off component implementations.
- Keep one primary action per decision area.
- Use familiar icons for icon-only commands and provide accessible names.
- Use status colors for status, warning, success, error, and informational meaning.
- Keep cards, controls, and repeated fixed-format elements dimensionally stable.
- Avoid nested decorative cards and page sections styled as floating cards.
- Use an 8px maximum default radius unless a documented consumer pattern requires otherwise.
- Keep focus, hover, active, disabled, loading, and invalid states coherent.
- Keep text within its container at supported viewport sizes.
- Prefer dense, scan-friendly composition for operational product surfaces.

## Ownership

Move an implementation into this repository only when at least two consumers need
the same interface and behavior. Token aliases and thin framework adapters are
shared; application components remain local by default.
