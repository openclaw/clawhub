## Summary

- Align skill and plugin detail pages on a shared mobile/desktop layout: hero taxonomy, install surface, sidebar metadata, tab chrome, README/skill-card rendering, files/versions/diff panels, and related polish from `specs/plugin-skill-detail-polish-iteration.md`.
- Add download activity graphs in the sidebar, skill-card preview, markdown code-block tooling, and plugin-specific detail affordances (categorize alert placement, catalog metadata dialog, version panels).
- Fix SSR hydration mismatches on detail pages by keeping stable mobile markup (`<details>` + CSS desktop layout) and syncing Shiki theme selection with `useSyncExternalStore`; complete tabpanel ARIA for Files/Versions.

**Scope:** frontend only (`src/` + spec note). No Convex/backend changes in this PR.

## Preview

Vercel preview (prod Convex):

- https://clawhub-design-blo1jy4jj-victor-brzezowskis-projects.vercel.app/plugins/@openclaw/whatsapp
- https://clawhub-design-blo1jy4jj-victor-brzezowskis-projects.vercel.app/plugins/@openclaw/codex
- https://clawhub-design-blo1jy4jj-victor-brzezowskis-projects.vercel.app/ivangdavila/self-improving
- https://clawhub-design-blo1jy4jj-victor-brzezowskis-projects.vercel.app/pskoett/self-improving-agent

Note: Diff tab may stay on "Loading diff…" on the Vercel preview because Monaco is blocked by preview CSP; local dev and production are unaffected.

## Screenshots

- [x] Screenshots/recordings attached
- **Full gallery (68 captures):** https://velvet-mustard-yce4.here.now/
- Captured from production `clawhub.ai` (before) vs Vercel preview (after), light + dark, one viewport per tab (1440×1100 with breathing room).

### `/plugins/@openclaw/whatsapp`

#### README.md

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![README.md before light](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-whatsapp-light-readme.png) | ![README.md after light](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-whatsapp-light-readme-md.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![README.md before dark](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-whatsapp-dark-readme.png) | ![README.md after dark](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-whatsapp-dark-readme-md.png) |

#### Versions

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Versions before light](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-whatsapp-light-versions.png) | ![Versions after light](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-whatsapp-light-versions.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Versions before dark](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-whatsapp-dark-versions.png) | ![Versions after dark](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-whatsapp-dark-versions.png) |

#### Configuration

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Configuration before light](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-whatsapp-light-configuration.png) | ![Configuration after light](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-whatsapp-light-configuration.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Configuration before dark](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-whatsapp-dark-configuration.png) | ![Configuration after dark](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-whatsapp-dark-configuration.png) |

#### Compatibility

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Compatibility before light](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-whatsapp-light-compatibility.png) | ![Compatibility after light](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-whatsapp-light-compatibility.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Compatibility before dark](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-whatsapp-dark-compatibility.png) | ![Compatibility after dark](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-whatsapp-dark-compatibility.png) |

### `/plugins/@openclaw/codex`

#### README.md

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![README.md before light](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-codex-light-readme.png) | ![README.md after light](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-codex-light-readme-md.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![README.md before dark](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-codex-dark-readme.png) | ![README.md after dark](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-codex-dark-readme-md.png) |

#### Versions

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Versions before light](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-codex-light-versions.png) | ![Versions after light](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-codex-light-versions.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Versions before dark](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-codex-dark-versions.png) | ![Versions after dark](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-codex-dark-versions.png) |

#### Configuration

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Configuration before light](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-codex-light-configuration.png) | ![Configuration after light](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-codex-light-configuration.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Configuration before dark](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-codex-dark-configuration.png) | ![Configuration after dark](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-codex-dark-configuration.png) |

#### Compatibility

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Compatibility before light](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-codex-light-compatibility.png) | ![Compatibility after light](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-codex-light-compatibility.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Compatibility before dark](https://velvet-mustard-yce4.here.now/before-plugin-openclaw-codex-dark-compatibility.png) | ![Compatibility after dark](https://velvet-mustard-yce4.here.now/after-plugin-openclaw-codex-dark-compatibility.png) |

### `/pskoett/self-improving-agent`

#### SKILL.md

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![SKILL.md before light](https://velvet-mustard-yce4.here.now/before-skill-pskoett-self-improving-agent-light-skill-md.png) | ![SKILL.md after light](https://velvet-mustard-yce4.here.now/after-skill-pskoett-self-improving-agent-light-skill-md.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![SKILL.md before dark](https://velvet-mustard-yce4.here.now/before-skill-pskoett-self-improving-agent-dark-skill-md.png) | ![SKILL.md after dark](https://velvet-mustard-yce4.here.now/after-skill-pskoett-self-improving-agent-dark-skill-md.png) |

#### Skill Card

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Skill Card before light](https://velvet-mustard-yce4.here.now/before-skill-pskoett-self-improving-agent-light-skill-md.png) | ![Skill Card after light](https://velvet-mustard-yce4.here.now/after-skill-pskoett-self-improving-agent-light-skill-md.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Skill Card before dark](https://velvet-mustard-yce4.here.now/before-skill-pskoett-self-improving-agent-dark-skill-md.png) | ![Skill Card after dark](https://velvet-mustard-yce4.here.now/after-skill-pskoett-self-improving-agent-dark-skill-md.png) |

#### Files

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Files before light](https://velvet-mustard-yce4.here.now/before-skill-pskoett-self-improving-agent-light-files.png) | ![Files after light](https://velvet-mustard-yce4.here.now/after-skill-pskoett-self-improving-agent-light-files.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Files before dark](https://velvet-mustard-yce4.here.now/before-skill-pskoett-self-improving-agent-dark-files.png) | ![Files after dark](https://velvet-mustard-yce4.here.now/after-skill-pskoett-self-improving-agent-dark-files.png) |

#### Diff

**light**

| Before (prod) | After (preview) |
| --- | --- |
| _missing_ | ![Diff after light](https://velvet-mustard-yce4.here.now/after-skill-pskoett-self-improving-agent-light-diff.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| _missing_ | ![Diff after dark](https://velvet-mustard-yce4.here.now/after-skill-pskoett-self-improving-agent-dark-diff.png) |

#### Compare

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Compare before dark](https://velvet-mustard-yce4.here.now/before-skill-pskoett-self-improving-agent-dark-compare.png) | _missing_ |

#### Versions

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Versions before light](https://velvet-mustard-yce4.here.now/before-skill-pskoett-self-improving-agent-light-versions.png) | ![Versions after light](https://velvet-mustard-yce4.here.now/after-skill-pskoett-self-improving-agent-light-versions.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Versions before dark](https://velvet-mustard-yce4.here.now/before-skill-pskoett-self-improving-agent-dark-versions.png) | ![Versions after dark](https://velvet-mustard-yce4.here.now/after-skill-pskoett-self-improving-agent-dark-versions.png) |

### `/ivangdavila/self-improving`

#### SKILL.md

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![SKILL.md before light](https://velvet-mustard-yce4.here.now/before-skill-ivangdavila-self-improving-light-skill-md.png) | ![SKILL.md after light](https://velvet-mustard-yce4.here.now/after-skill-ivangdavila-self-improving-light-skill-md.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![SKILL.md before dark](https://velvet-mustard-yce4.here.now/before-skill-ivangdavila-self-improving-dark-skill-md.png) | _missing_ |

#### Skill Card

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Skill Card before light](https://velvet-mustard-yce4.here.now/before-skill-ivangdavila-self-improving-light-skill-md.png) | ![Skill Card after light](https://velvet-mustard-yce4.here.now/after-skill-ivangdavila-self-improving-light-skill-md.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Skill Card before dark](https://velvet-mustard-yce4.here.now/before-skill-ivangdavila-self-improving-dark-skill-md.png) | _missing_ |

#### Files

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Files before light](https://velvet-mustard-yce4.here.now/before-skill-ivangdavila-self-improving-light-files.png) | ![Files after light](https://velvet-mustard-yce4.here.now/after-skill-ivangdavila-self-improving-light-files.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Files before dark](https://velvet-mustard-yce4.here.now/before-skill-ivangdavila-self-improving-dark-files.png) | _missing_ |

#### Diff

**light**

| Before (prod) | After (preview) |
| --- | --- |
| _missing_ | ![Diff after light](https://velvet-mustard-yce4.here.now/after-skill-ivangdavila-self-improving-light-diff.png) |

#### Compare

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Compare before light](https://velvet-mustard-yce4.here.now/before-skill-ivangdavila-self-improving-light-compare.png) | _missing_ |

#### Versions

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Versions before light](https://velvet-mustard-yce4.here.now/before-skill-ivangdavila-self-improving-light-versions.png) | ![Versions after light](https://velvet-mustard-yce4.here.now/after-skill-ivangdavila-self-improving-light-versions.png) |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Versions before dark](https://velvet-mustard-yce4.here.now/before-skill-ivangdavila-self-improving-dark-versions.png) | _missing_ |

#### Requirements

**light**

| Before (prod) | After (preview) |
| --- | --- |
| _missing_ | ![Requirements after light](https://velvet-mustard-yce4.here.now/after-skill-ivangdavila-self-improving-light-requirements.png) |

#### Runtime

**light**

| Before (prod) | After (preview) |
| --- | --- |
| ![Runtime before light](https://velvet-mustard-yce4.here.now/before-skill-ivangdavila-self-improving-light-runtime.png) | _missing_ |

**dark**

| Before (prod) | After (preview) |
| --- | --- |
| ![Runtime before dark](https://velvet-mustard-yce4.here.now/before-skill-ivangdavila-self-improving-dark-runtime.png) | _missing_ |


## Behavioural Proof

- Local worktree review at `http://127.0.0.1:16456` with seeded fixtures + prod Convex preview URLs above.
- Verified mobile master tabs, deferred stats sections, install switcher, categorize alert placement, and sidebar download graphs on the listed routes.
- Hydration fixes verified by keeping identical SSR/client DOM for deferred sections and theme-aware markdown rendering.

## Security / Trust Impact

- [x] No security/trust impact
- [ ] Security/trust impact explained

## Data / Deploy Impact

- [x] No data/deploy impact
- [ ] Data/deploy impact explained

## Verification

- [ ] `bun run ci:static`
- [x] Focused tests for touched behavior:
  - `VITE_CONVEX_URL=https://example.invalid bun run vitest run src/components/MarkdownPreview.test.tsx src/components/SkillHeader.test.tsx src/components/SkillDetailTabs.test.tsx`
- [ ] `bun run ci:unit` or `N/A` for docs/config-only:
- [ ] Broader gate when required (`ci:types-build`, `ci:packages`, `ci:e2e-http`, `ci:playwright-smoke`, `test:pw:local-auth`, `proof:ui`):
- [x] Other: merged latest `upstream/main` before opening PR
