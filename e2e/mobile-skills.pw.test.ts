import { expect, test } from "@playwright/test";
import { loadSmokeSkillFixture } from "../scripts/lib/smokeSkillFixture";
import { buildSkillDetailHref } from "../src/lib/ownerRoute";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "./helpers/runtimeErrors";

function seedApiUrl(path: string) {
  const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL?.trim();
  return convexSiteUrl ? new URL(path, convexSiteUrl).toString() : path;
}

// Only run in mobile projects — skip on desktop
test.beforeEach(() => {
  test.skip(!test.info().project.name.includes("mobile"), "mobile-only test");
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
  await expect(page.locator(".catalog-detail__title-row h1")).toHaveText(payload.skill.displayName);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

  await expectHealthyPage(page, errors);
});

test("mobile Skill pages show SKILL.md inline and keep version history separate", async ({
  page,
  request,
}) => {
  const errors = trackRuntimeErrors(page);
  const payload = await loadSmokeSkillFixture(async (path) => {
    const response = await request.get(seedApiUrl(path));
    return { status: response.status(), json: () => response.json() };
  });
  const version = payload.latestVersion?.version;
  if (!version) throw new Error("Mobile version history needs a hosted Skill with a release");
  const detailHref = buildSkillDetailHref(payload.owner.handle, payload.skill.slug);
  await page.goto(detailHref, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);

  const readme = page.getByRole("tab", { name: "SKILL.md", exact: true });
  await expect(readme).toHaveAttribute("aria-selected", "true");
  const document = page.getByRole("tabpanel", { name: "SKILL.md", exact: true });
  await expect(document).toBeVisible();
  // On a stacked layout the rail must not appear between the document and its footer.
  const rail = page.locator(".catalog-detail__sidebar");
  await expect(rail).toBeVisible();
  const [railBox, documentBox] = await Promise.all([rail.boundingBox(), document.boundingBox()]);
  if (!railBox || !documentBox) throw new Error("Expected a rendered install rail and SKILL.md");
  expect(railBox.y + railBox.height).toBeLessThanOrEqual(documentBox.y + 1);
  await expect(page.getByRole("tab", { name: /^(Files|Skill Card|Diff|Versions)$/ })).toHaveCount(
    0,
  );
  const metadata = page.getByRole("group", { name: "Skill metadata" });
  const versionText = metadata.getByText(version, { exact: true });
  await expect(versionText).toBeVisible();
  expect(
    await versionText.evaluate((el) =>
      Boolean(el.closest('button, a, [role="button"], [role="link"]')),
    ),
  ).toBe(false);
  const releasePath = `/api/v1/skills/${encodeURIComponent(payload.skill.slug)}/versions/${encodeURIComponent(version)}?${new URLSearchParams({ ownerHandle: payload.owner.handle })}`;
  const releaseResponse = await request.get(seedApiUrl(releasePath));
  expect(releaseResponse.ok()).toBe(true);
  const { version: releaseDetail } = await releaseResponse.json();
  await expect(metadata.locator("dt")).toHaveText([
    ...(releaseDetail.security ? ["Security check"] : []),
    "Version",
    ...(payload.skill.updatedAt !== undefined ? ["Updated"] : []),
    ...(payload.latestVersion?.license ? ["License"] : []),
    ...(payload.metadata?.os?.length ? ["Platforms"] : []),
  ]);
  await expect(rail.getByText("Downloads", { exact: true })).toHaveCount(0);
  await expect(rail.getByRole("tablist", { name: "Download period" })).toHaveCount(0);
  await expect(rail.getByRole("img", { name: /downloads/i })).toHaveCount(0);
  await expect(rail.getByRole("button", { name: /Version history|Bookmark|Report/i })).toHaveCount(
    0,
  );

  const actions = page.getByRole("group", { name: "Skill actions" });
  const related = page.getByRole("heading", { name: "Related skills", exact: true });
  if (await related.isVisible()) {
    const relatedBox = await related.boundingBox();
    const actionBox = await actions.boundingBox();
    if (!relatedBox || !actionBox || !documentBox)
      throw new Error("Expected a rendered Skill footer");
    expect(relatedBox.y).toBeGreaterThanOrEqual(documentBox.y + documentBox.height - 1);
    expect(actionBox.y).toBeGreaterThan(relatedBox.y + relatedBox.height);
  }
  await actions.getByRole("button", { name: "Version history", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Version history", exact: true });
  const release = history.getByRole("button", {
    name: `Show changelog for v${version}`,
    exact: true,
  });
  await expect(release).toBeVisible();
  await expect(page).toHaveURL(/#versions$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(release).toBeVisible();
  await expect(history.getByRole("tablist")).toHaveCount(0);
  await expect(history.getByLabel("Skill taxonomy")).toHaveCount(0);
  await expect(history.getByRole("heading", { name: "Related skills" })).toHaveCount(0);
  await history.getByRole("button", { name: "Close", exact: true }).click();
  await expect(history).toHaveCount(0);
  await expect(page).toHaveURL((url) => url.pathname === detailHref && url.hash === "");
  await expect(readme).toHaveAttribute("aria-selected", "true");
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
