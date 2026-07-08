---
name: openclaw-design
description: Route OpenClaw design work to the canonical brand, product design-system, marketing-page, or design-audit guidance. Use when a task touches OpenClaw visual identity, shared CSS tokens, product UI, public web pages, or design-system compliance.
---

# OpenClaw Design

Choose one focused branch before changing an interface. Load multiple branches
only when the task genuinely crosses them.

| Skill | Use for |
| --- | --- |
| `openclaw-brand` | Identity decisions, typography, logos, imagery, voice, and non-product brand artifacts |
| `openclaw-design-system` | Application UI, semantic tokens, themes, component reuse, and framework adapters |
| `openclaw-marketing-pages` | Public-page composition, landing/content pages, navigation, SEO, and responsive layout |
| `openclaw-design-audit` | Design drift, token misuse, component substitution, accessibility, and recurring audits |

For a public website change, start with `openclaw-marketing-pages` and add
`openclaw-brand` only when the task changes identity, logo, imagery, typography,
or voice. For a product application, start with `openclaw-design-system`.

## Shared Contract

- Treat this repository's release tag as the version of both runtime CSS and agent guidance.
- Prefer semantic tokens over raw palette values.
- Keep product-specific components and layouts in their consumer repository.
- Add shared implementation only after at least two consumers demonstrate the same interface.
- Preserve consumer behavior while changing the visual foundation.
- Validate rendered pages in a real browser at desktop and mobile sizes.
- Check both light and dark themes where the consumer supports them.
- Do not redistribute fonts, logos, or artwork without recorded permission.
