import { expect, test } from "@playwright/test";
import { stubExternalMediaInVitePreview } from "./helpers/externalMedia";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";
import { routeVercelProtectionBypass } from "./helpers/vercelProtection";

test("public navigation routes render without runtime errors", async ({ browser }) => {
  const routes = [
    { path: "/skills", heading: "Skills" },
    { path: "/plugins", heading: "Plugins" },
  ];

  for (const route of routes) {
    const page = await browser.newPage();
    await routeVercelProtectionBypass(page);
    await stubExternalMediaInVitePreview(page);
    const errors = trackRuntimeErrors(page);

    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1", { hasText: route.heading })).toBeVisible();
    await expectHealthyPage(page, errors);
    await page.close();
  }
});

test("signed-out publish entry renders", async ({ page }) => {
  await routeVercelProtectionBypass(page);
  await stubExternalMediaInVitePreview(page);
  const errors = trackRuntimeErrors(page);

  await page.goto("/upload", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/skills\/publish$/);
  await expect(page.getByText("Sign in to publish a skill")).toBeVisible();
  await expectHealthyPage(page, errors);
});
