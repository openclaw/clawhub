---
name: openclaw-design-system
description: Compatibility alias for existing OpenClaw installations that now applies Carapace semantic tokens, themes, shared CSS foundations, consumer adapters, and established local primitives.
---

# Carapace Compatibility Alias

This skill identifier remains available for existing `skills-lock.json`
entries during the `v0.1.x` migration. New installations should use
`openclaw-carapace`.

Use the shared package for foundations and framework-neutral visual primitives.
Keep consumer-specific behavior, data, routes, and layout composition local.
Before changing imports, inspect the consumer manifest: use
`@openclaw/carapace` when it is installed, otherwise preserve the legacy
`@openclaw/design-system` specifier until the dependency is migrated.

## Workflow

1. Read [tokens.md](references/tokens.md) before choosing colors, spacing, type, radii, or shadows.
2. Read [consumer-adapters.md](references/consumer-adapters.md) for the current framework.
3. Inspect the consumer's existing shared primitives before creating a component.
4. Use semantic tokens for UI intent; use palette primitives only for documented exceptions.
5. Keep application behavior, routes, and information architecture unchanged unless the task says otherwise.
6. Validate the affected routes with existing tests and real browser screenshots.

## Interface Rules

- Import the complete CSS contract or its focused exported entry points.
- Compose shared classes from `components.css` before adding a one-off visual implementation.
- Use local shared primitives before raw controls or one-off component implementations.
- Keep one primary action per decision area.
- Use familiar icons for icon-only commands and provide accessible names.
- Use status colors for status, warning, success, error, and informational meaning.
- Keep cards, controls, and repeated fixed-format elements dimensionally stable.
- Avoid nested decorative cards and page sections styled as floating cards.
- Keep surfaces, controls, and insets square through their semantic radius tokens.
- Reserve round geometry for avatars, status dots, and other truly circular indicators.
- Keep focus, hover, active, disabled, loading, and invalid states coherent.
- Keep text within its container at supported viewport sizes.
- Prefer dense, scan-friendly composition for operational product surfaces.

## Ownership

Move visual implementation into this repository when its interface is
framework-neutral and useful across consumers. Keep runtime behavior and
framework adapters local until at least two consumers need the same interface
and behavior.
