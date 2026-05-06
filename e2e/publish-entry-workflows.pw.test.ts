import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";

test("upload shows signed-out publish gate", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/upload", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/publish-skill$/);
  await expect(page.getByText("Sign in to publish a skill")).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("import shows signed-out gate", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/import", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Sign in to import and publish skills")).toBeVisible();
  await expectHealthyPage(page, errors);
});
