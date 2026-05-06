import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";

test("public navigation routes render without runtime errors", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/skills", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1", { hasText: "Skills" })).toBeVisible();

  await page.goto("/souls", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1", { hasText: "SOUL.md discovery is on deck" })).toBeVisible();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Skills" }).first().click();
  await expect(page).toHaveURL(/\/skills/);
  await expect(page.locator("h1", { hasText: "Skills" })).toBeVisible();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Plugins" }).first().click();
  await expect(page).toHaveURL(/\/plugins(\?|$)/);
  await expect(page.locator("h1", { hasText: "Plugins" })).toBeVisible();

  await expectHealthyPage(page, errors);
});

test("signed-out publish entry renders", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/upload", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/publish-skill$/);
  await expect(page.getByText("Sign in to publish a skill")).toBeVisible();
  await expectHealthyPage(page, errors);
});
