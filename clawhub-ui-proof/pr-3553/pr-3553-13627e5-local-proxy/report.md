# Mobile homepage search trigger proof

Status: pass

Proof tier: the baseline is the real production page at `https://clawhub.ai/`. The candidate is the same real page served through a lightweight local HTTP proxy that appends only the mobile toolbar CSS extracted verbatim from `src/styles.css` at `13627e5158b43ac766c869bbeca5fae3d6eab1c5`. The branch contains no markup change. This is computed-geometry and screenshot evidence, not a built candidate deployment.

Viewport: 390 x 844.

## Computed geometry

| State | Skills / Plugins | Search trigger | Discovery tabs | Search panel |
| --- | --- | --- | --- | --- |
| Production collapsed | y=388, h=38 | y=488, h=44 | y=438, h=36 | hidden |
| Candidate collapsed | y=391, h=38 | y=388, h=44 | y=446, h=36 | hidden |
| Candidate open | y=391, h=38 | y=388, h=44 | y=446, bottom=482 | y=496, h=40 |

Candidate assertions:

- The collapsed trigger shares the first row with Skills / Plugins and remains right-aligned.
- Trending / Featured / Official / New remain on the second row.
- Clicking the trigger sets `aria-expanded=true`, reveals the existing panel below the tabs, focuses the search input, and exposes Close search.
- Clicking Close search restores `aria-expanded=false` and hides the panel.
- Dark mode retains the mobile geometry.
- At 1280 x 900 the toolbar remains `display:flex`; the mobile grid rules do not apply.
