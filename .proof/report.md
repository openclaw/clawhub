# ClawHub publisher search proof

Status: pass (production bug reproduction before backend deploy)

## Convex read-only validation (`wry-manatee-359.convex.cloud`)

| Query | `listPublicPage` handles |
| --- | --- |
| `vyctor` | `[]` |
| `vyctorbrzezowski` | `[]` |
| `vincent` | `["vincentchan"]` |
| `vincentkoc` | `[]` |

## Profiles that exist but are missing from search

- `vyctorbrzezowski` → 5 skills, 1 package, 46 installs
- `vincentkoc` → public profile, 0 published skills

## Unit tests

`VITE_CONVEX_URL=https://example.invalid bunx vitest run convex/publishers.test.ts`
