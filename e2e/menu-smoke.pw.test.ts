import { expect, test, type Page } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "./helpers/runtimeErrors";

const navLabels = ["Skills", "Plugins"];

async function headerLink(page: Page, label: string) {
  let link = page.getByRole("link", { name: label, exact: true }).first();
  if (await link.isVisible().catch(() => false)) return link;

  const menuButton = page.getByRole("button", { name: "Open menu" });
  if (await menuButton.isVisible().catch(() => false)) {
    await menuButton.click();
    link = page.getByRole("link", { name: label, exact: true }).first();
  }

  await expect(link).toBeVisible();
  return link;
}

test("skills loads without error", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  await page.goto("/skills", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1", { hasText: "Skills" })).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("header menu routes render", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  for (const label of navLabels) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForHydration(page);

    const link = await headerLink(page, label);
    await link.click();

    if (label === "Skills") {
      await expect(page).toHaveURL(/\/skills/);
      await expect(page.locator("h1", { hasText: "Skills" })).toBeVisible();
    }

    if (label === "Plugins") {
      await expect(page).toHaveURL(/\/plugins(\?|$)/);
      await expect(page.locator("h1", { hasText: "Plugins" })).toBeVisible();
    }
  }

  await expectHealthyPage(page, errors);
});
