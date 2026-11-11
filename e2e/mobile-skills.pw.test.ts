import { expect, test } from "@playwright/test";
import { loadSmokeSkillFixture } from "../scripts/lib/smokeSkillFixture";
import { buildSkillDetailHref } from "../src/lib/ownerRoute";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "./helpers/runtimeErrors";

function seedApiUrl(path: string) {
  const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL?.trim();
  return convexSiteUrl ? new URL(path, convexSiteUrl).toString() : path;
}

// Only run in mobile projects — skip on desktop
test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile-only test");
});

test("browse page has no horizontal overflow on mobile", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/skills?sort=downloads", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /^Skills/ })).toBeVisible();
  await waitForHydration(page);
  await expect(page.locator(".skill-list-item").first()).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

  await expectHealthyPage(page, errors);
});

test("mobile category picker filters and dismisses", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  await page.goto("/skills?sort=downloads", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  const category = page.getByRole("combobox", { name: "Category" });
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await category.click();
  await expect(category).toHaveAttribute("aria-expanded", "true");
  const choices = page.getByRole("radiogroup", { name: "Category", exact: true });
  await expect(choices).toBeVisible();
  await page.getByRole("searchbox", { name: "Search categories" }).fill("Development");
  await choices.getByRole("radio", { name: "Development", exact: true }).click();
  await expect(page).toHaveURL(/category=development/);
  await expect(category).toContainText("Development");
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await expect(choices).toBeHidden();
  await expectHealthyPage(page, errors);
});

test("skill detail page has no horizontal overflow on mobile", async ({ page, request }) => {
  const errors = trackRuntimeErrors(page);

  const payload = await loadSmokeSkillFixture(async (path) => {
    const response = await request.get(seedApiUrl(path));
    return { status: response.status(), json: () => response.json() };
  });
  const ownerHandle = payload.owner.handle;
  const slug = payload.skill.slug;

  await page.goto(buildSkillDetailHref(ownerHandle, slug), { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1.skill-page-title")).toHaveText(payload.skill.displayName);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

  await expectHealthyPage(page, errors);
});

test("archive detail tabs can be selected on mobile", async ({ page, request }) => {
  const errors = trackRuntimeErrors(page);

  const payload = await loadSmokeSkillFixture(async (path) => {
    const response = await request.get(seedApiUrl(path));
    return { status: response.status(), json: () => response.json() };
  });
  const ownerHandle = payload.owner.handle;
  const slug = payload.skill.slug;

  await page.goto(buildSkillDetailHref(ownerHandle, slug), { waitUntil: "domcontentloaded" });

  await waitForHydration(page);
  expect(
    payload.latestVersion,
    "mobile archive tabs require an archived skill fixture",
  ).toBeTruthy();
  const tabs = page.getByRole("tablist", { name: "Skill detail tabs" });
  for (const tabName of ["SKILL.md", "Files", "Versions"]) {
    const tab = tabs.getByRole("tab", { name: tabName, exact: true });
    await tab.scrollIntoViewIfNeeded();
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const panelId = await tab.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
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
