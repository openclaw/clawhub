import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";

// Only run in mobile projects — skip on desktop
test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile-only test");
});

test("browse page has no horizontal overflow on mobile", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/skills?sort=downloads", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /^Skills/ })).toBeVisible();
  await expect(page.locator(".skill-card, .skill-list-item").first()).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

  await expectHealthyPage(page, errors);
});

test("browse sidebar toggle opens and closes filters", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/skills?sort=downloads", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /^Skills/ })).toBeVisible();

  const filterButton = page.getByRole("button", { name: "Toggle filters" });
  await expect(filterButton).toBeVisible();

  // Sidebar should be hidden initially
  const sidebar = page.locator(".browse-sidebar");
  await expect(sidebar).not.toBeVisible();

  // Open sidebar
  await filterButton.click();
  await expect(sidebar).toBeVisible();

  // Close sidebar
  await filterButton.click();
  await expect(sidebar).not.toBeVisible();

  await expectHealthyPage(page, errors);
});

test("card grid fits within viewport on mobile", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/skills?sort=downloads&view=cards", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".skill-card").first()).toBeVisible();

  const card = page.locator(".skill-card").first();
  const cardBox = await card.boundingBox();
  const viewport = page.viewportSize()!;

  // Card should not exceed viewport width
  expect(cardBox!.width).toBeLessThanOrEqual(viewport.width);

  await expectHealthyPage(page, errors);
});

test("skill detail page has no horizontal overflow on mobile", async ({ page, request }) => {
  const errors = trackRuntimeErrors(page);

  const response = await request.get("/api/v1/skills/gifgrep");
  test.skip(!response.ok(), "gifgrep fixture missing");

  const payload = (await response.json()) as {
    owner?: { handle?: string | null };
    skill?: { slug?: string | null; displayName?: string | null };
  };
  const ownerHandle = payload.owner?.handle?.trim();
  const slug = payload.skill?.slug?.trim();
  test.skip(
    !ownerHandle || !slug || !payload.skill?.displayName,
    "fixture missing owner handle, slug, or displayName",
  );

  await page.goto(`/${ownerHandle}/${slug}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: payload.skill!.displayName! })).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

  await expectHealthyPage(page, errors);
});

test("detail tabs are scrollable and touch-friendly on mobile", async ({ page, request }) => {
  const errors = trackRuntimeErrors(page);

  const response = await request.get("/api/v1/skills/gifgrep");
  test.skip(!response.ok(), "gifgrep fixture missing");

  const payload = (await response.json()) as {
    owner?: { handle?: string | null };
    skill?: { slug?: string | null };
  };
  const ownerHandle = payload.owner?.handle?.trim();
  const slug = payload.skill?.slug?.trim();
  test.skip(!ownerHandle || !slug, "fixture missing");

  await page.goto(`/${ownerHandle}/${slug}`, { waitUntil: "domcontentloaded" });

  // All standard tabs should be accessible (even if scrolled)
  for (const tabName of ["README", "Files", "Versions"]) {
    const tab = page.getByRole("button", { name: tabName });
    await tab.scrollIntoViewIfNeeded();
    await expect(tab).toBeVisible();

    // Touch target should be at least 44px
    const box = await tab.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await expectHealthyPage(page, errors);
});

test("search input font size prevents iOS zoom", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/skills?sort=downloads", { waitUntil: "domcontentloaded" });

  const input = page.locator(".browse-search-input");
  await expect(input).toBeVisible();

  const fontSize = await input.evaluate((el) => getComputedStyle(el).fontSize);
  // iOS Safari zooms the page when an input has font-size below 16px
  expect(parseFloat(fontSize)).toBeGreaterThanOrEqual(16);

  await expectHealthyPage(page, errors);
});
