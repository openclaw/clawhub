import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { waitForHydration } from "../helpers/runtimeErrors";
import { signInAsLocalPersona } from "./helpers";

const exec = promisify(execFile);
test.skip(process.env.VITE_ENABLE_DEV_AUTH !== "1", "Requires the local dev-auth runner");

test("dated API updates stay informational for visitors and managers", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await exec("bunx", [
    "convex",
    "run",
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
    "devSeed:seedPluginApiRetirementFixtures",
    "{}",
  ]);
  await page.goto("/plugins/local-api-retirement-plugin", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  const notice = page.getByRole("region", { name: "OpenClaw API updates" });
  await expect(notice).toContainText("Dec 31, 2026.");
  await expect(notice).toContainText("the author can update to readAcpSessionEntryAsync.");
  await expect(page.getByText(/This plugin is incompatible/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Validation", exact: true })).toHaveCount(0);
  await notice.getByText("API details", { exact: true }).click({ timeout: 10_000 });
  await expect(notice.locator("dt")).toHaveText(
    "openclaw/plugin-sdk/acp-runtime.readAcpSessionEntry",
  );
  await expect(notice.locator("dd")).toHaveText("readAcpSessionEntryAsync");
  await expect(notice.locator("svg")).toHaveCount(0);
  if (process.env.CLAWHUB_CAPTURE_API_RETIREMENT_PROOF === "1") {
    await page.screenshot({ path: testInfo.outputPath("after-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(notice).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("after-mobile.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: testInfo.outputPath("after-mobile-dark.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  await page.goto("/plugins/local-api-retirement-current", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Local Current API Example" })).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Install", exact: true })).toBeVisible();

  await page.goto("/plugins/local-api-retirement-incompatible", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("This plugin is incompatible with OpenClaw versions greater than 2026.10.1."),
  ).toBeVisible();
  await expect(notice).toBeVisible();

  await signInAsLocalPersona(page, "owner");
  await page.goto("/dashboard");
  await waitForHydration(page);
  const row = page.getByRole("button", { name: /^Local API Retirement Example\./ });
  await expect(row).toContainText("API update");
  await expect(row).not.toContainText(/warning|Needs review|Blocked/);
  await row.click();
  const dialog = page.getByRole("dialog", { name: /review$/i });
  await expect(dialog.getByRole("region", { name: "OpenClaw API updates" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Validation" })).toHaveCount(0);
  if (process.env.CLAWHUB_CAPTURE_API_RETIREMENT_PROOF === "1") {
    await page.screenshot({ path: testInfo.outputPath("after-dashboard.png"), fullPage: true });
  }
});
