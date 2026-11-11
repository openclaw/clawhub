import { expect, test } from "@playwright/test";
import { loadSmokeSkillFixture } from "../scripts/lib/smokeSkillFixture";
import { buildPublisherProfileHref, buildSkillDetailHref } from "../src/lib/ownerRoute";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "./helpers/runtimeErrors";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function seedApiUrl(path: string) {
  const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL?.trim();
  return convexSiteUrl ? new URL(path, convexSiteUrl).toString() : path;
}

function normalizePluginHrefPath(href: string) {
  const prefix = "/plugins/";
  if (!href.startsWith(prefix)) return href;
  const decodedName = decodeURIComponent(href.slice(prefix.length));
  return `${prefix}${decodedName}`;
}

test("skills browse can filter, search, and open detail", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/skills?sort=downloads&dir=desc", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /^Skills/ })).toBeVisible();
  await waitForHydration(page);
  await expect(page.locator("a.skill-list-item").first()).toBeVisible();

  const category = page.getByRole("combobox", { name: "Category" });
  const sidebar = page.getByRole("complementary", { name: "Skill categories" });
  if (await sidebar.isVisible()) {
    const development = sidebar.getByRole("button", { name: "Development", exact: true });
    await development.click();
    await expect(development).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/category=development/);
    await sidebar.getByRole("button", { name: "All categories", exact: true }).click();
  } else {
    await category.click();
    const choices = page.getByRole("radiogroup", { name: "Category", exact: true });
    await choices.getByRole("radio", { name: "Development", exact: true }).click();
    await expect(page).toHaveURL(/category=development/);
    await expect(category).toContainText("Development");
    await category.click();
    await choices.getByRole("radio", { name: "All categories", exact: true }).click();
  }
  await expect(page).not.toHaveURL(/category=/);

  const searchInput = page.getByPlaceholder("Search skills...");
  await searchInput.fill("gif");
  await expect(page).toHaveURL(/q=gif/);
  await expect(
    page.locator(".browse-results a.skill-list-item, .browse-results .empty-state").first(),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear skill search", exact: true }).click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(searchInput).toHaveValue("");
  await page.goto("/skills?sort=downloads&dir=desc", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  const firstSkill = page.locator("a.skill-list-item").first();
  await expect(firstSkill).toBeVisible();

  const href = await firstSkill.getAttribute("href");
  expect(href).toMatch(/^\/[^/]+\/(?:skills\/)?[^/]+$/);
  const segments = href!.split("/").filter(Boolean).map(decodeURIComponent);
  const detailHref = buildSkillDetailHref(segments[0], segments.at(-1)!);

  await firstSkill.scrollIntoViewIfNeeded();
  await firstSkill.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(detailHref)}$`));
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("known public skill detail links to owner profile", async ({ page, request }) => {
  const payload = await loadSmokeSkillFixture(async (path) => {
    const response = await request.get(seedApiUrl(path));
    return { status: response.status(), json: () => response.json() };
  });
  const ownerHandle = payload.owner.handle;
  const slug = payload.skill.slug;

  const errors = trackRuntimeErrors(page);
  await page.goto(buildSkillDetailHref(ownerHandle, slug), { waitUntil: "domcontentloaded" });
  const ownerHref = buildPublisherProfileHref(ownerHandle);
  const ownerLink = page.getByRole("link", { name: /^View .* profile$/ }).first();

  await expect(ownerLink).toHaveAttribute("href", ownerHref);
  await waitForHydration(page);
  await ownerLink.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(ownerHref)}$`));
  await expect(page.getByRole("region", { name: "Publisher catalog" })).toBeVisible();
  await expect(page.locator("a.skill-list-item").first()).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("plugins browse can search and open detail", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/plugins?sort=downloads", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /^Plugins/ })).toBeVisible();
  await waitForHydration(page);
  await expect(page.getByRole("link", { name: /^Plugin:/ }).first()).toBeVisible();

  const searchInput = page.getByRole("searchbox", { name: "plugin search" });
  await searchInput.fill("security");
  await searchInput.press("Enter");
  await expect(page).toHaveURL(/q=security/);
  await expect(page.getByText("Unable to load plugins")).toHaveCount(0);
  await expect(page.locator(".skill-list-item, .empty-state").first()).toBeVisible();

  await page.getByRole("button", { name: "Clear plugin search" }).click();
  await expect(page).not.toHaveURL(/q=security/);
  await expect(page.getByRole("link", { name: /^Plugin:/ }).first()).toBeVisible();

  const firstPlugin = page.getByRole("link", { name: /^Plugin:/ }).first();
  await expect(firstPlugin).toBeVisible();
  const href = await firstPlugin.getAttribute("href");
  expect(href).toMatch(/^\/(?:[^/]+\/)?plugins\//);

  await firstPlugin.scrollIntoViewIfNeeded();
  await firstPlugin.click();
  await expect(page).toHaveURL(
    new RegExp(`${escapeRegExp(normalizePluginHrefPath(href!))}(?:#.*)?$`),
  );
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expectHealthyPage(page, errors);
});
