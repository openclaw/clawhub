# UI Design Contract Regression Guard

Date: 2026-04-29

The restored ClawHub public UI has strict regression guards in `src/__tests__/ui-design-contract.test.ts`.

Protected fundamentals:

- Two-row header: brand, full-width desktop search, rectangular theme mode control, auth action, then content nav with `Skills`, `Plugins`, `Users`, and `About`.
- Compact header: menu button, inline search, GitHub action, and visible content nav row.
- Home hero: `BUILT BY THE COMMUNITY.`, `Tools built by thousands, ready in one search.`, search focus border behavior, slot-machine easter egg support, featured carousel, category grid breakpoints, and `Trending Now`.
- Footer: restored four public sections and mobile section toggles.
- Visual settings: no tweakcn overlay, custom-theme file, relaxed/compact density controls, or other nonfunctional visual preferences.

Intentional changes to these fundamentals must update the design-contract test and this note in the same PR. A removal without a matching contract update should be treated as an accidental regression.
