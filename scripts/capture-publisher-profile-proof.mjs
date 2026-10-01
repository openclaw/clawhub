#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "@playwright/test";

const BASE_URL = process.env.CLAWHUB_PROOF_BASE_URL ?? "http://localhost:3000";
const OUTPUT_DIR = path.resolve(
  process.cwd(),
  process.env.CLAWHUB_PROOF_OUTPUT_DIR ?? "proof/publisher-detail-polish",
);

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = devices["iPhone 14"].viewport;

const PUBLISHERS = [
  { handle: "openclaw", modes: ["light", "dark"] },
  { handle: "expediagroup", modes: ["dark"] },
  { handle: "steipete", modes: ["dark"] },
  { handle: "1kalin", modes: ["dark"] },
  { handle: "vyctorbrzezowski", modes: ["dark"] },
];

const VIEWPORTS = [
  { id: "desktop", viewport: DESKTOP },
  { id: "mobile", viewport: MOBILE, isMobile: true },
];

async function setTheme(page, mode) {
  await page.addInitScript((themeMode) => {
    const selection = JSON.stringify({ theme: "claw", mode: themeMode });
    window.localStorage.setItem("clawhub-theme-selection", selection);
    window.localStorage.setItem("clawhub-theme", themeMode);
    window.localStorage.setItem("clawhub-theme-name", "claw");
  }, mode);
}

async function waitForPublisherProfileReady(page) {
  await page.locator(".publisher-profile-page").waitFor({ state: "visible", timeout: 60_000 });
  const loading = page.locator('[role="status"][aria-label="Loading results"]');
  if ((await loading.count()) > 0) {
    await loading.first().waitFor({ state: "detached", timeout: 45_000 });
  }
  await page.waitForTimeout(1000);
}

async function captureScreenshot({ browser, handle, mode, viewportId, viewport, isMobile }) {
  const context = await browser.newContext({
    viewport,
    isMobile: Boolean(isMobile),
    hasTouch: Boolean(isMobile),
  });
  const page = await context.newPage();
  await setTheme(page, mode);

  const url = `${BASE_URL}/${handle}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForPublisherProfileReady(page);

  const filename = `${handle}-${viewportId}-${mode}.png`;
  const filePath = path.join(OUTPUT_DIR, filename);
  await page.screenshot({ path: filePath, fullPage: true });
  await context.close();
  return { filename, handle, mode, viewportId, url };
}

function renderPrBody(captures) {
  const byHandle = new Map();
  for (const capture of captures) {
    const list = byHandle.get(capture.handle) ?? [];
    list.push(capture);
    byHandle.set(capture.handle, list);
  }

  const lines = ["## Visual proof", ""];
  const order = ["openclaw", "expediagroup", "steipete", "1kalin", "vyctorbrzezowski"];

  const sortShots = (shots) =>
    [...shots].sort((left, right) => {
      const viewportOrder = { desktop: 0, mobile: 1 };
      const modeOrder = { light: 0, dark: 1 };
      return (
        (viewportOrder[left.viewportId] ?? 0) - (viewportOrder[right.viewportId] ?? 0) ||
        (modeOrder[left.mode] ?? 0) - (modeOrder[right.mode] ?? 0)
      );
    });

  const renderShot = (shot, collapsible) => {
    const label = `${shot.viewportId === "desktop" ? "Desktop" : "Mobile"} · ${shot.mode}`;
    const image = `![@${shot.handle} publisher profile — ${label}](proof/publisher-detail-polish/${shot.filename})`;
    if (!collapsible) {
      return [`**${label}**`, "", image, ""];
    }
    return [`<details>`, `<summary>${label}</summary>`, ``, image, ``, `</details>`, ``];
  };

  for (const handle of order) {
    const shots = byHandle.get(handle);
    if (!shots?.length) continue;

    lines.push(`### @${handle}`, "");
    const sorted = sortShots(shots);
    const collapsible = handle !== "openclaw";
    for (const shot of sorted) {
      lines.push(...renderShot(shot, collapsible));
    }
  }

  lines.push(
    "_Captured from local ClawHub at `http://localhost:3000` with Playwright (system Chrome)._",
    "",
  );
  return lines.join("\n");
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.CLAWHUB_PROOF_BROWSER_CHANNEL ?? "chrome",
  });
  const captures = [];

  try {
    for (const publisher of PUBLISHERS) {
      for (const mode of publisher.modes) {
        for (const { id, viewport, isMobile } of VIEWPORTS) {
          const capture = await captureScreenshot({
            browser,
            handle: publisher.handle,
            mode,
            viewportId: id,
            viewport,
            isMobile,
          });
          captures.push(capture);
          console.log(`saved ${capture.filename}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  const prBody = renderPrBody(captures);
  const prBodyPath = path.join(OUTPUT_DIR, "pr-visual-proof.md");
  await fs.writeFile(prBodyPath, prBody);
  console.log(`wrote ${prBodyPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
