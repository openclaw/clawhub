import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "./helpers/runtimeErrors";

const resultCards = ".skill-card, .skill-list-item";

test("skills search paginates live results", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/skills", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Grid" })).toBeEnabled();

  const input = page.getByPlaceholder("Search skills...");
  await input.click();
  await input.pressSequentially("remind");

  await expect(page).toHaveURL(/\/skills\?.*q=remind/);
  await expect(page.getByText("Scroll to load more")).toBeVisible();
  await expect(page.locator(resultCards)).toHaveCount(25);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator(resultCards)).toHaveCount(50);
  await expectHealthyPage(page, errors);
});
