import { expect, test } from "@playwright/test";
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

test("skills browse can filter, change view, and open detail", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/skills?sort=downloads&dir=desc", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /^Skills/ })).toBeVisible();
  await waitForHydration(page);
  await expect(page.locator(".skill-card, .skill-list-item").first()).toBeVisible();

  const hideSuspicious = page.getByRole("checkbox", { name: "Hide suspicious" });
  if (await hideSuspicious.isVisible().catch(() => false)) {
    await hideSuspicious.check();
    await expect(hideSuspicious).toBeChecked();
  }

  const searchInput = page.getByPlaceholder("Search skills...");
  await searchInput.fill("gif");
  await expect(page).toHaveURL(/q=gif/);
  await searchInput.fill("");
  await expect(page.locator(".skill-card, .skill-list-item").first()).toBeVisible();

  await page.goto("/skills?sort=downloads&dir=desc", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.locator(".skill-card, .skill-list-item").first()).toBeVisible();

  await page.getByRole("button", { name: "Grid" }).click();
  await expect(page).toHaveURL(/view=grid/);
  await expect(page.locator(".skill-card").first()).toBeVisible();

  const firstSkill = page.locator("a.skill-card").first();
  await expect(firstSkill).toBeVisible();

  const href = await firstSkill.getAttribute("href");
  expect(href).toMatch(/^\/[^/]+\/[^/]+$/);

  await firstSkill.scrollIntoViewIfNeeded();
  await firstSkill.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(href!)}$`));
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("known public skill detail links to owner profile", async ({ page, request }) => {
  const response = await request.get(seedApiUrl("/api/v1/skills/gifgrep"));
  test.skip(!response.ok(), "gifgrep fixture missing");

  const payload = (await response.json()) as {
    owner?: { handle?: string | null };
    skill?: { slug?: string | null };
  };
  const ownerHandle = payload.owner?.handle?.trim();
  const slug = payload.skill?.slug?.trim();

  test.skip(!ownerHandle || !slug, "gifgrep fixture missing owner handle or slug");

  const errors = trackRuntimeErrors(page);
  await page.goto(`/${ownerHandle}/${slug}`, { waitUntil: "domcontentloaded" });
  const ownerLink = page.locator(`a[href="/user/${ownerHandle}"]`).first();

  await expect(ownerLink).toHaveAttribute("href", new RegExp(`/user/${ownerHandle}$`));
  await waitForHydration(page);
  await ownerLink.click();
  await expect(page).toHaveURL(new RegExp(`/user/${ownerHandle}$`));
  await expect(page.getByRole("region", { name: "Publisher catalog" })).toBeVisible();
  await expect(page.locator(".skill-card, .skill-list-item").first()).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("plugins browse can search, change view, and open detail", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/plugins", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /^Plugins/ })).toBeVisible();
  await waitForHydration(page);
  await expect(page.locator(".skill-card, .skill-list-item").first()).toBeVisible();

  await page.getByRole("button", { name: "Grid" }).click();
  await expect(page).toHaveURL(/view=grid/);
  await expect(page.locator(".skill-card").first()).toBeVisible();

  const searchInput = page.getByPlaceholder("Search plugins...");
  await searchInput.fill("security");
  await expect(page).toHaveURL(/q=security/);
  await expect(page.getByText("Unable to load plugins")).toHaveCount(0);
  await expect(page.locator(".skill-card, .skill-list-item, .empty-state").first()).toBeVisible();

  await page.getByRole("button", { name: "Clear plugin search" }).click();
  await expect(page).not.toHaveURL(/q=security/);
  await expect(page.locator(".skill-card, .skill-list-item").first()).toBeVisible();

  const firstPlugin = page.locator("a.skill-card, a.skill-list-item").first();
  await expect(firstPlugin).toBeVisible();
  const href = await firstPlugin.getAttribute("href");
  expect(href).toMatch(/^\/plugins\//);

  await firstPlugin.scrollIntoViewIfNeeded();
  await firstPlugin.click();
  await expect(page).toHaveURL(
    new RegExp(`${escapeRegExp(normalizePluginHrefPath(href!))}(?:#.*)?$`),
  );
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("known public plugin detail supports versions navigation", async ({ page, request }) => {
  const response = await request.get(seedApiUrl("/api/v1/plugins?limit=1"));
  test.skip(!response.ok(), "public plugin fixture missing");

  const payload = (await response.json()) as {
    items?: Array<{ displayName?: string | null; name?: string | null }>;
  };
  const plugin = payload.items?.find((item) => item.name?.trim() && item.displayName?.trim());
  test.skip(!plugin, "public plugin fixture missing name or display name");

  const name = plugin!.name!.trim();
  const href = name.startsWith("@")
    ? `/plugins/${name.split("/").map(encodeURIComponent).join("/")}`
    : `/plugins/${encodeURIComponent(name)}`;
  const errors = trackRuntimeErrors(page);

  await page.goto(href, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: plugin!.displayName!.trim() }).first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Versions" }).click();
  await expect(page).toHaveURL(/#versions$/);
  await expect(page.getByRole("tab", { name: "Versions" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByText(/Active releases|No active releases|Release history/i).first(),
  ).toBeVisible();
  await expectHealthyPage(page, errors);
});
