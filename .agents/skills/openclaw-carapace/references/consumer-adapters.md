# Consumer Adapters

## Plain CSS And Astro

Use the complete contract when the global reset is desired:

```css
@import "@openclaw/carapace";
```

For a controlled migration, import `tokens.css`, `themes.css`, and
`typography.css`, then `components.css`. Retain consumer-specific layout CSS.
Theme switching remains application-owned. The canonical public-site selector is
`html[data-theme="light"|"dark"]`.

Product applications may additionally import the opt-in candidate layers:

```css
@import "@openclaw/carapace/themes/product.css";
@import "@openclaw/carapace/candidate/controls.css";
@import "@openclaw/carapace/candidate/feedback.css";
@import "@openclaw/carapace/candidate/application.css";
```

Use the application layer for shell, pane, and settings anatomy. Keep routes,
data, persistence, and framework behavior local.

## Tailwind 4

Import in this order:

```css
@import "@openclaw/carapace/tokens.css";
@import "@openclaw/carapace/themes.css";
@import "@openclaw/carapace/typography.css";
@import "@openclaw/carapace/components.css";
@import "@openclaw/carapace/themes/product.css";
@import "@openclaw/carapace/compat/clawhub.css";
@import "@openclaw/carapace/tailwind.css";
```

The Tailwind adapter exposes theme utilities. `components.css` provides
framework-neutral classes; keep Radix, React, route, and product behavior in the
consumer.

## Native macOS

Map the shared application anatomy to SwiftUI and AppKit instead of importing
the CSS. Preserve native title bars, materials, window sizing, sheets, keyboard
commands, focus behavior, and accessibility semantics. Align hierarchy,
spacing roles, control intent, and status meaning rather than web-specific
markup.

The ClawHub compatibility adapter understands:

- `data-theme-family="claw"`
- `data-theme-resolved="light"|"dark"`
- `data-theme-mode="system"`
- the existing unprefixed token aliases

Remove aliases only after source search and browser validation prove that no
consumer uses them.

## Static Documentation Builders

Copy or resolve the focused CSS exports as build inputs. Import tokens, themes,
and typography before the docs shell CSS. Do not import `base.css` until the
generated navigation, prose, search, code, and Mermaid views have been compared
in a real browser.

## Versioning

Install an immutable Git tag. Runtime CSS and skill guidance use the same tag.
Dependabot or a scheduled update workflow may propose a newer tag, but migration
and visual validation remain consumer responsibilities.
