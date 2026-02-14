---
summary: "Skill version diffing mode (Monaco-backed)"
read_when:
  - Implementing skill diff UI
  - Adding version comparisons
---

# Diffing mode

## Goals
- Compare any file between two versions.
- Default compare: `latest` vs `previous` (SemVer precedence).
- UX feels native to ClawHub (theme + typography + motion).
- Inline or side-by-side toggle.
- Public access.

## UX
- Diff card on skill detail page.
- Two selectors: Left/Right.
  - Items: version strings, plus tags (e.g. `latest`), plus `previous`.
  - Default: Left = `previous`, Right = `latest`.
- File list with status: added / removed / changed / same.
  - Default file: `SKILL.md` if present; else first changed file.
- Toggle: Inline vs Side-by-side.
- Show size guard message when file > 200KB.

## SemVer ordering
- Use SemVer precedence to sort versions.
- `previous` = immediate predecessor of `latest` by SemVer.
- If `latest` missing or only one version:
  - Disable `previous` and show empty-state copy.

## Data sources
- Versions: `api.skills.listVersions` (all, not just latest 10).
- Tags: `skill.tags` map.
- File list: `version.files` with `path`, `sha256`, `size`.

## API
Add action:
- `skills.getFileText({ versionId, path }) -> { text, size, sha256 }`
  - Validate version exists + file path exists in version.
  - Enforce size <= 200KB (both in action and client).
  - Use `fetchText` from `convex/lib/skillPublish.ts`.

Optional helper action:
- `skills.getVersionFiles({ versionId }) -> files[]`
  - If we want lightweight fetch without full version object.

## Client flow
1. Fetch versions + tags.
2. Resolve default compare pair:
   - Right = tag `latest` if present else highest SemVer.
   - Left = `previous` (SemVer predecessor).
3. Build file union by path.
4. For selected file:
   - Fetch left/right text (guard by size).
   - Feed into Monaco diff editor.

## Monaco theming
- Define `clawhub-light` / `clawhub-dark` via `monaco.editor.defineTheme`.
- Derive colors from CSS variables on `document.documentElement`:
  - `--surface`, `--surface-muted`, `--ink`, `--ink-soft`, `--line`, `--accent`.
- Apply theme on load + when theme changes (`data-theme`).
- Match font: `var(--font-mono)`.
- Set diff options:
  - `renderSideBySide` toggle
  - `diffAlgorithm: 'advanced'`
  - `renderSideBySideInlineBreakpoint` for mobile
  - `wordWrap: 'on'`

## Edge cases
- File removed/added: show empty buffer on missing side + label.
- Non-text file should not exist (upload rejects), but still guard.
- Large file: show size warning + disable fetch.
- Missing version: show error state.

## Perf
- Cache file text per version+path in client state.
- Debounce selector changes (100-200ms).
- Limit concurrent fetches to 2.

## Tests
- Unit: SemVer ordering + `previous` selection.
- Component: default selectors, tag inclusion, size guard.
