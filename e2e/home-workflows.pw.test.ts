import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "./helpers/runtimeErrors";

test("home search and browse entry points work", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Equip.*Install/i })).toBeVisible();
  await expect(page.getByText("Discover skills and plugins from top creators")).toBeVisible();
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Search catalog" })).toBeEnabled();

  await page.getByRole("button", { name: "Search catalog" }).click();
  await page.getByPlaceholder("Search skills in this catalog…").fill("gifgrep");
  await expect(page.getByRole("link", { name: /gifgrep/i }).first()).toBeVisible();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Search catalog" })).toBeEnabled();
  await page.getByRole("link", { name: "Browse all skills" }).click();
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

test("unified search switches between skills and plugins results", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/search?q=security", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Search results for "security"/ })).toBeVisible();
  await waitForHydration(page);

  await page.getByRole("button", { name: "Plugins" }).click();
  await expect(page).toHaveURL(/type=plugins/);
  await expect(
    page.locator(".skill-card, .skill-list-item, .search-empty-state").first(),
  ).toBeVisible();

  const loadMore = page.getByRole("button", { name: "Load more" });
  if (await loadMore.isVisible().catch(() => false)) {
    const resultCount = await page.locator(".skill-card, .skill-list-item").count();
    await loadMore.click();
    await expect
      .poll(() => page.locator(".skill-card, .skill-list-item").count())
      .toBeGreaterThan(resultCount);
  }

  await page.getByRole("button", { name: "Skills" }).click();
  await expect(page).toHaveURL(/type=skills/);
  await expect(
    page.locator(".skill-card, .skill-list-item, .search-empty-state").first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "All" }).click();
  await expect(page).not.toHaveURL(/type=/);
  await expectHealthyPage(page, errors);
});
