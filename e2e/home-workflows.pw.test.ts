import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "./helpers/runtimeErrors";

test("home search and browse entry points work", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Equip.*Install/i })).toBeVisible();
  await expect(page.getByText("Tools built by thousands, ready in one search.")).toBeVisible();
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Search" })).toBeEnabled();

  await page.getByPlaceholder("What are you looking for?").fill("gifgrep");
  await page.getByPlaceholder("What are you looking for?").press("Enter");
  await expect(page).toHaveURL(/\/search\?q=gifgrep/);
  await expect(page.getByRole("heading", { name: /Search results for "gifgrep"/ })).toBeVisible();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Search" })).toBeEnabled();
  await page.getByRole("link", { name: /Skills Agent skill bundles/ }).click();
  await expect(page).toHaveURL(/\/skills/);
  await expect(page.getByRole("heading", { name: /^Skills/ })).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("search route preserves query in unified search", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/search?q=gifgrep", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/search\?/);
  await expect(page).toHaveURL(/q=gifgrep/);
  await expect(page.locator('input[placeholder="Search skills and plugins..."]')).toHaveValue(
    "gifgrep",
  );
  await expectHealthyPage(page, errors);
});
