import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";

const navLabels = ["Skills", "Upload", "Import", "Search"];

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

    if (label === "Upload") {
      await expect(page).toHaveURL(/\/upload/);
      const heading = page.locator("h1.section-title", { hasText: /^Publish a /i });
      const signInCard = page.locator("text=Sign in to upload");
      await expect(heading.or(signInCard)).toBeVisible();
    }

    if (label === "Import") {
      await expect(page).toHaveURL(/\/import/);
      const heading = page.getByRole("heading", { name: "Import from GitHub" });
      const signInCard = page.locator("text=Sign in to import and publish skills.");
      await expect(heading.or(signInCard)).toBeVisible();
    }

    if (label === "Search") {
      await expect(page).toHaveURL(/\/skills(\?|$)/);
      await expect(page.locator("h1", { hasText: "Skills" })).toBeVisible();
    }
  }

  await expectHealthyPage(page, errors);
});
