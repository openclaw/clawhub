## Summary

- Keep the sticky header opaque on every route, including security audits and the homepage, using the existing light/dark `--nav-bg` surface.
- Remove transparent route overrides and scroll/search glass styles, plus the scroll listener used only to toggle them.
- Record the shared header invariant in a focused regression note.

Fixes content bleeding through navigation on `/nickflach/skills/kannaka-node/security-audit`.

## Before / after proof

Eight paired screenshots from real Chromium running the local ClawHub app: the reported audit page in desktop/mobile and light/dark, plus homepage and open-search states in desktop/mobile. The paired evidence is published in the PR UI-proof comment.

Baseline: `e769826f1f951c5fb7d4838bab1cc03a9ee31d53`. Candidate: `0a6d9b6434`.

Both captures use `http://127.0.0.1:4380`, signed out, en-US/UTC, and the existing public read-only Convex backend. Audit content snapshots match exactly across all four pairs. No mocked HTML, backend modifications, production writes, or private data.

Browser assertions cover 14 states: background alpha changes from 0/0.78 to 1; sticky position stays at 0; no horizontal overflow. All 16 published images were visually inspected. Empty/error/auth-specific content does not change this data-independent header surface; no separate fixtures were needed. Static state comparisons make a video unnecessary.

## Validation

- `bun run test:ui-contract` — 93 tests passed.
- `bun run ci:unit` — 6,585 tests passed, 3 skipped; coverage passed.
- `bun run ci:static` — passed.
- `bun run ci:types-build` — passed, including schema and CLI TypeScript checks and the production build.
- Focused Playwright baseline/candidate assertions — passed; baseline reproduces transparency, candidate is opaque in all 14 states.
- Manual diff review — no remaining scroll-class references or competing navbar background overrides.

## Worked on by

- Patrick Erichsen (@Patrick-Erichsen)

## Capture harness

Run `node capture.mjs baseline` before the change, then `node capture.mjs candidate` after the change, against the same foreground Vite server.

```js
import { chromium, expect } from '/Users/patrickerichsen/Git/openclaw/clawhub-opaque-header/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
const lane = process.argv[2];
const root = '/tmp/clawhub-opaque-header-proof';
await fs.mkdir(`${root}/${lane}`, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
 for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  for (const theme of ['dark', 'light']) {
   const page = await browser.newPage({ viewport, colorScheme: theme, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
   await page.goto('http://127.0.0.1:4380/nickflach/skills/kannaka-node/security-audit');
   await page.waitForFunction(() => document.documentElement.dataset.clawhubHydrated === 'true');
   await page.waitForLoadState('networkidle');
   await expect(page.locator('h1')).toHaveText('kannaka-node');
   await page.evaluate(() => document.fonts.ready);
   const main = await page.locator('main').innerText();
   async function capture(name, scroll, screenshot = true) {
    await page.evaluate(y => window.scrollTo(0,y), scroll);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
    if(lane === 'baseline' && scroll > 8) await expect(page.locator('header.navbar')).toHaveClass(/navbar-calm-scrolled/);
    await page.locator('header.navbar').evaluate(e => Promise.all(e.getAnimations().map(a => a.finished)));
    const metrics = await page.locator('header.navbar').evaluate(e => {
     const s = getComputedStyle(e);
     const c = document.createElement('canvas').getContext('2d'); c.fillStyle=s.backgroundColor;c.fillRect(0,0,1,1);
     return { background: s.backgroundColor, alpha: c.getImageData(0,0,1,1).data[3], opacity:s.opacity,top:e.getBoundingClientRect().top,position:s.position,scrollY:window.scrollY,overflow:document.documentElement.scrollWidth > window.innerWidth };
    });
    if (lane === 'candidate') { expect(metrics.alpha, `${name}: opaque`).toBe(255); expect(metrics.opacity).toBe('1'); }
    expect(metrics.top).toBe(0); expect(metrics.position).toBe('sticky');expect(metrics.overflow).toBe(false);
    if(screenshot) await page.screenshot({path:`${root}/${lane}/${name}.png`,animations:'disabled'});
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
    console.log(name, metrics);
    results.push({ name,viewport,theme,...metrics,screenshot:screenshot?`${lane}/${name}.png`:null });
   }
   const label = `${viewport.width}-${theme}`;
   await capture(`audit-top-${label}`,0,false);
   const scroll = await page.locator('h1').evaluate(e => Math.round(e.getBoundingClientRect().top + window.scrollY));
   await capture(`audit-scrolled-${label}`, scroll);
   await fs.writeFile(`${root}/${lane}/audit-${label}.txt`, main);
   if(theme === 'dark') {
    await page.goto('http://127.0.0.1:4380/');
    await page.waitForFunction(() => document.documentElement.dataset.clawhubHydrated === 'true');
   await page.waitForLoadState('networkidle');
    await expect(page.locator('.home-v2-main')).toBeVisible();
    await capture(`home-top-${label}`,0,false);
    await capture(`home-scrolled-${label}`,200);
    if(viewport.width === 390) await page.locator('.navbar-search-mobile-trigger').click();
    const input = page.locator(viewport.width === 390 ? '.navbar-search-mobile .navbar-search-input' : '.navbar-calm-center .navbar-search-input');
    await input.fill('kannaka');
    await expect(input).toHaveValue('kannaka');
    await expect(page.locator('.navbar-search-typeahead')).toBeVisible();
    await capture(`search-open-${label}`,200);
   }
   await page.close();
  }
 }
 await fs.writeFile(`${root}/${lane}/results.json`,JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
} finally { await browser.close(); }
```
