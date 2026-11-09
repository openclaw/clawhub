import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signInAsLocalPersona } from "./helpers";

const proofDir = ".artifacts/download-analytics";

function seedAnalytics() {
  const result = spawnSync(
    "bunx",
    [
      "convex",
      "run",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      "devSeedDownloadAnalytics:seedInternal",
      "{}",
    ],
    { encoding: "utf8", env: process.env },
  );
  if (result.status !== 0) throw new Error("Analytics fixture failed: " + result.stderr);
}

test("admin sees real generated analytics at all viewport classes", async ({ page }) => {
  test.setTimeout(120_000);
  seedAnalytics();
  await signInAsLocalPersona(page, "admin");
  await page.goto("/management?view=downloads");
  await expect(
    page.getByRole("heading", { name: "Template downloads", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Template downloads", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh summary", exact: true }).click();
  await expect(page.getByText("19,134", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("17", { exact: true })).toBeVisible();
  await expect(page.getByText(/Window:/)).toBeVisible();
  await mkdir(proofDir, { recursive: true });
  for (const [label, width, height] of [
    ["desktop", 1440, 900],
    ["laptop", 1366, 768],
    ["tablet", 768, 1024],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("button", { name: "Refresh summary", exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: proofDir + "/after-" + label + ".png", fullPage: true });
  }
});

test("non-admin cannot view Template download analytics", async ({ page }) => {
  await signInAsLocalPersona(page, "user");
  await page.goto("/management?view=downloads");
  await expect(page.getByRole("heading", { name: "Template downloads", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "Template downloads", exact: true })).toHaveCount(0);
  await expect(page.getByText("19,134", { exact: true })).toHaveCount(0);
});
