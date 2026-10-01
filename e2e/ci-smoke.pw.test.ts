import { expect, test } from "@playwright/test";
import { stubExternalMediaInVitePreview } from "./helpers/externalMedia";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "./helpers/runtimeErrors";
import { routeVercelProtectionBypass } from "./helpers/vercelProtection";

test("framework hydration scripts use the response CSP nonce", async ({ page }) => {
  await routeVercelProtectionBypass(page);
  await stubExternalMediaInVitePreview(page);
  const errors = trackRuntimeErrors(page);

  const response = await page.goto("/skills/publish", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  const nonce = response?.headers()["content-security-policy"]?.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const inlineNonces = await page.evaluate(
    (html) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      return Array.from(document.querySelectorAll<HTMLScriptElement>("script:not([src])"))
        .filter(
          (script) => !script.type || script.type === "module" || script.type === "text/javascript",
        )
        .map((script) => script.getAttribute("nonce"));
    },
    await response!.text(),
  );
  expect(inlineNonces.length).toBeGreaterThan(0);
  expect(inlineNonces.every((value) => value === nonce)).toBe(true);
  await waitForHydration(page);
  await expectHealthyPage(page, errors);
});

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
