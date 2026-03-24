import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";

const navLabels = ["Skills", "Plugins", "Search"];

test("skills loads without error", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  await page.goto("/skills", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1", { hasText: "Skills" })).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("souls loads without error", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  await page.goto("/souls", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1", { hasText: "Souls" })).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("header menu routes render", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  for (const label of navLabels) {
    const link = page.getByRole("link", { name: label }).first();
    await expect(link).toBeVisible();
    await link.click();

    if (label === "Skills") {
      await expect(page).toHaveURL(/\/skills/);
      await expect(page.locator("h1", { hasText: "Skills" })).toBeVisible();
    }

    if (label === "Plugins") {
      await expect(page).toHaveURL(/\/plugins(\?|$)/);
      await expect(page.locator("h1", { hasText: "Plugins" })).toBeVisible();
    }

    if (label === "Search") {
      await expect(page).toHaveURL(/\/skills(\?|$)/);
      await expect(page.locator("h1", { hasText: "Skills" })).toBeVisible();
    }
  }

  await expectHealthyPage(page, errors);
});
