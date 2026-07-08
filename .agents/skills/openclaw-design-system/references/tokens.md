# Token Contract

Import `@openclaw/design-system` for the complete foundation or use focused
exports when the consumer must control reset and adapter order.

## Layers

| Layer | Prefix | Purpose |
| --- | --- | --- |
| Palette | `--oc-palette-*` | Fixed source colors; rare direct use |
| Semantic | `--oc-bg-*`, `--oc-text-*`, `--oc-accent-*` | Theme-aware UI intent |
| Scale | `--oc-space-*`, `--oc-font-size-*`, `--oc-radius-*` | Shared dimensions |
| Product | `--oc-status-*`, `--oc-input-*`, `--oc-diff-*` | Opt-in operational UI |
| Consumer alias | Unprefixed legacy names | Migration compatibility only |

## Semantic Choices

- Page background: `--oc-bg-page`
- Ordinary surface: `--oc-bg-surface`
- Elevated surface: `--oc-bg-elevated`
- Primary, secondary, muted text: `--oc-text-primary`,
  `--oc-text-secondary`, `--oc-text-muted`
- Primary action: `--oc-accent-primary`; hover:
  `--oc-accent-primary-hover`
- Secondary accent: `--oc-accent-secondary`
- Subtle and accent borders: `--oc-border-subtle`,
  `--oc-border-accent`
- Focus: `--oc-focus-ring`

Use `color-mix()` from semantic variables for a local translucent state. Add a
new shared semantic token only when the same intent recurs across consumers.

## Radius

The shared default is `--oc-radius-md` (8px). Larger radii require an existing
consumer pattern or a clear content reason. Pills are reserved for compact
status, filtering, or segmented-control semantics.

## Ownership

Consumer repositories own component geometry, page layout, and application
states. This package owns stable visual foundations and thin migration aliases.
