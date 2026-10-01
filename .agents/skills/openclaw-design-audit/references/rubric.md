# Design Audit Rubric

## Mechanical Rules

| ID | Check |
| --- | --- |
| `token/raw-color` | New raw colors where a semantic token exists |
| `token/undefined` | Custom properties used but not defined by package or consumer |
| `token/legacy-alias` | New code depends on a migration-only alias |
| `component/duplicate` | Raw control or primitive duplicates an established local primitive |
| `component/state` | Missing hover, focus, disabled, loading, invalid, or selected state |
| `layout/overflow` | Text or fixed-format UI clips or causes accidental horizontal scroll |
| `a11y/name` | Interactive control lacks an accessible name |
| `a11y/focus` | Keyboard focus is hidden, trapped, or incoherent |
| `theme/parity` | Light or dark theme loses content, hierarchy, or contrast |
| `asset/rights` | New distributable asset has no recorded rights |

## Judgment Checks

| ID | Check |
| --- | --- |
| `hierarchy/primary-action` | Competing primary actions obscure the decision |
| `layout/card-overuse` | Sections or cards are unnecessarily nested or floated |
| `typography/scale` | Type scale does not match its container or task density |
| `brand/accent` | Coral, sea glass, or status colors are used without their intended role |
| `marketing/subject` | First viewport hides the actual product, place, person, or offer |
| `copy/clarity` | Interface text is vague, inflated, or does not name the action |

## Severity

- `error`: broken interaction, accessibility barrier, illegible theme, accidental
  overflow, missing asset rights, or deterministic contract violation.
- `warning`: likely drift or inconsistency with meaningful user impact.
- `info`: improvement with limited current impact.

Do not mark aesthetic preference as a violation. A finding needs source or
rendered evidence and a documented rule.
