import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const OUT_DIR = path.resolve('.proof/pr-2780-screenshots');
const VIEWPORT = { width: 1440, height: 1100 };

const TARGETS = [
  {
    slug: 'plugin-openclaw-whatsapp',
    path: '/plugins/@openclaw/whatsapp',
  },
  {
    slug: 'plugin-openclaw-codex',
    path: '/plugins/@openclaw/codex',
  },
  {
    slug: 'skill-pskoett-self-improving-agent',
    path: '/pskoett/self-improving-agent',
  },
  {
    slug: 'skill-ivangdavila-self-improving',
    path: '/ivangdavila/self-improving',
  },
];

const BASES = [
  { label: 'before', origin: 'https://clawhub.ai' },
  {
    label: 'after',
    origin:
      'https://clawhub-design-blo1jy4jj-victor-brzezowskis-projects.vercel.app',
  },
];

const THEMES = ['light', 'dark'];

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function applyTheme(page, theme) {
  await page.evaluate((mode) => {
    const selection = { theme: 'claw', mode };
    localStorage.setItem('clawhub-theme-selection', JSON.stringify(selection));
    localStorage.setItem('clawhub-theme', mode);
    localStorage.setItem('clawhub-theme-name', 'claw');
    const resolved = mode;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeResolved = resolved;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.themeFamily = 'claw';
    document.documentElement.classList.toggle('dark', mode === 'dark');
  }, theme);
}

async function waitForDetail(page) {
  await page.waitForSelector('.skill-detail-stack, .plugin-detail-page', {
    timeout: 45_000,
  });
  await page.waitForTimeout(1200);
}

async function captureViewport(page, filePath) {
  const anchor = page.locator('.skill-detail-stack, .plugin-detail-page').first();
  if (await anchor.count()) {
    await anchor.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -72));
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: filePath, fullPage: false });
}

async function collectTabs(page) {
  const tabs = page.locator('.tab-header [role="tab"]');
  const count = await tabs.count();
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const tab = tabs.nth(index);
    const name = ((await tab.textContent()) ?? `tab-${index + 1}`).trim();
    if (!name) continue;
    results.push({ name, index });
  }
  return results;
}

async function captureRoute(browser, base, target, theme) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const captures = [];

  await page.addInitScript((mode) => {
    const selection = { theme: 'claw', mode };
    localStorage.setItem('clawhub-theme-selection', JSON.stringify(selection));
    localStorage.setItem('clawhub-theme', mode);
    localStorage.setItem('clawhub-theme-name', 'claw');
  }, theme);

  const url = `${base.origin}${target.path}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await applyTheme(page, theme);
    await waitForDetail(page);

    const tabs = await collectTabs(page);
    if (tabs.length === 0) {
      const fileName = `${base.label}-${target.slug}-${theme}-overview.png`;
      const filePath = path.join(OUT_DIR, fileName);
      await captureViewport(page, filePath);
      captures.push({ fileName, tab: 'overview', url, phase: base.label, theme, route: target.path });
      return captures;
    }

    for (const tab of tabs) {
      const tabLocator = page.locator('.tab-header [role="tab"]').nth(tab.index);
      await tabLocator.click();
      await page.waitForTimeout(900);
      const fileName = `${base.label}-${target.slug}-${theme}-${slugify(tab.name)}.png`;
      const filePath = path.join(OUT_DIR, fileName);
      await captureViewport(page, filePath);
      captures.push({ fileName, tab: tab.name, url, phase: base.label, theme, route: target.path });
    }
  } catch (error) {
    const fileName = `${base.label}-${target.slug}-${theme}-error.png`;
    const filePath = path.join(OUT_DIR, fileName);
    await page.screenshot({ path: filePath, fullPage: false }).catch(() => undefined);
    captures.push({
      fileName,
      tab: 'error',
      url,
      phase: base.label,
      theme,
      route: target.path,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await context.close();
  }

  return captures;
}

function buildGallery(manifest) {
  const sections = TARGETS.map((target) => {
    const cards = manifest
      .filter((entry) => entry.route === target.path)
      .map((entry) => `
          <figure>
            <img src="./${entry.fileName}" alt="${entry.fileName}" loading="lazy" />
            <figcaption>
              <strong>${entry.phase}</strong> · ${entry.theme} · ${entry.tab}
              ${entry.error ? `<em>(${entry.error})</em>` : ''}
            </figcaption>
          </figure>`)
      .join('\n');

    return `
      <section>
        <h2>${target.path}</h2>
        <div class="grid">${cards}</div>
      </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ClawHub PR 2780 detail polish screenshots</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; padding: 32px; background: #0b0d12; color: #f4f6fb; }
    h1 { margin: 0 0 8px; font-size: 1.6rem; }
    p { margin: 0 0 24px; color: #b8c0d4; max-width: 80ch; line-height: 1.5; }
    h2 { margin: 32px 0 16px; font-size: 1.1rem; color: #dbe4ff; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 20px; }
    figure { margin: 0; border: 1px solid #2a3142; border-radius: 14px; overflow: hidden; background: #121622; }
    img { display: block; width: 100%; height: auto; background: #090b10; }
    figcaption { padding: 10px 12px 12px; font-size: 0.92rem; color: #c6d0e5; }
    figcaption strong { color: #fff; text-transform: capitalize; }
    figcaption em { display: block; margin-top: 4px; color: #f6c76a; font-style: normal; }
  </style>
</head>
<body>
  <h1>ClawHub PR #2780 — skill & plugin detail polish</h1>
  <p>Before/after captures from production (<code>clawhub.ai</code>) vs Vercel preview, in light and dark mode, one viewport per tab with breathing room (1440×1100, not tight element crops).</p>
  ${sections}
</body>
</html>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = [];
  const browser = await chromium.launch({ headless: true });

  try {
    for (const base of BASES) {
      for (const target of TARGETS) {
        for (const theme of THEMES) {
          console.log(`capturing ${base.label} ${target.slug} ${theme}`);
          const captures = await captureRoute(browser, base, target, theme);
          manifest.push(...captures);
        }
      }
    }
  } finally {
    await browser.close();
  }

  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(OUT_DIR, 'index.html'), buildGallery(manifest));
  console.log(`saved ${manifest.length} screenshots to ${OUT_DIR}`);
}

await main();
