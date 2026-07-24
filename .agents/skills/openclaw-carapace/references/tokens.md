# Token Contract

Import `@openclaw/carapace` for the complete foundation or use focused
exports when the consumer must control reset and adapter order.

## Layers

| Layer | Prefix | Purpose |
| --- | --- | --- |
| Palette | `--oc-palette-*` | Fixed source colors; rare direct use |
| Semantic | `--oc-bg-*`, `--oc-text-*`, `--oc-accent-*` | Theme-aware UI intent |
| Scale | `--oc-space-*`, `--oc-font-size-*`, `--oc-radius-*` | Shared dimensions |
| Motion | `--oc-duration-*`, `--oc-ease-*` | Shared interaction timing |
| Product | `--oc-status-*`, `--oc-input-*`, `--oc-diff-*` | Opt-in operational UI |
| Consumer alias | Unprefixed legacy names | Migration compatibility only |

## Semantic Choices

- Page background: `--oc-bg-page`
- Ordinary surface: `--oc-bg-surface`
- Elevated surface: `--oc-bg-elevated`
- Inset and inverted surfaces: `--oc-bg-recessed`, `--oc-bg-contrast`
- Primary, secondary, muted, inactive, inverse, and link text:
  `--oc-text-primary`, `--oc-text-secondary`, `--oc-text-muted`,
  `--oc-text-inactive`, `--oc-text-inverse`, `--oc-text-link`
- Primary action: `--oc-accent-primary`; hover:
  `--oc-accent-primary-hover`
- Secondary accent: `--oc-accent-secondary`
- Neutral control backgrounds: `--oc-control-bg`, `--oc-control-bg-hover`
- Subtle, strong, and accent borders: `--oc-border-subtle`,
  `--oc-border-strong`, `--oc-border-accent`
- Focus: `--oc-focus-ring`

Use `color-mix()` from semantic variables for a local translucent state. Add a
new shared semantic token only when the same intent recurs across consumers.

## Radius

Use semantic geometry roles in product UI:

- `--oc-radius-surface`: cards, panels, and framed sections
- `--oc-radius-control`: buttons, fields, chips, and segmented controls
- `--oc-radius-inset`: nested interactive or decorative surfaces
- `--oc-radius-round`: avatars, status dots, and genuinely circular indicators

The first three roles are square in the canonical OpenClaw system. Raw
`--oc-radius-*` scale values remain available for documented exceptions, but
must not replace the semantic defaults.

## Ownership

Consumer repositories own page composition and application states. This package
owns stable visual foundations, framework-neutral component primitives, and
thin migration aliases.
