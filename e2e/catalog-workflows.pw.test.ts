import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";

test("skills browse can filter, change view, and open detail", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/skills?sort=downloads&dir=desc", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /^Skills/ })).toBeVisible();
  await expect(page.locator(".skill-card, .skills-row").first()).toBeVisible();

  const hideSuspicious = page.getByRole("button", { name: "Hide suspicious" });
  await hideSuspicious.click();
  await expect(hideSuspicious).toHaveAttribute("aria-pressed", "true");

  const searchInput = page.getByPlaceholder("Filter by name, slug, or summary…");
  await searchInput.fill("gif");
  await expect(page).toHaveURL(/q=gif/);
  await searchInput.fill("");
  await expect(page.locator(".skill-card, .skills-row").first()).toBeVisible();

  const viewToggle = page.locator(".skills-view").first();
  const nextViewLabel = ((await viewToggle.textContent()) ?? "").trim();
  await viewToggle.click();
  await expect(viewToggle).not.toHaveText(nextViewLabel);

  const firstSkill = page.locator(".skill-card, .skills-row").first();
  await expect(firstSkill).toBeVisible();

  const skillName = (
    await firstSkill.locator(".skill-card-title, .skills-row-title span").first().textContent()
  )?.trim();
  expect(skillName).toBeTruthy();

  await firstSkill.click();
  await expect(page.getByRole("heading", { name: skillName! })).toBeVisible();
  await expect(page.getByRole("link", { name: /@/ }).first()).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("known public skill detail links to owner profile", async ({ page, request }) => {
  const response = await request.get("/api/v1/skills/gifgrep");
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
  const ownerLink = page.locator(".user-handle").first();

  await expect(ownerLink).toHaveAttribute("href", new RegExp(`/u/${ownerHandle}$`));
  await ownerLink.click();
  await expect(page).toHaveURL(new RegExp(`/u/${ownerHandle}$`));
  await expect(page.getByRole("heading", { name: "Published" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stars" })).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("souls browse can filter, change view, open detail, and open owner profile", async ({
  page,
}) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/souls", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Souls" })).toBeVisible();

  const searchInput = page.getByPlaceholder("Filter by name, slug, or summary…");
  await searchInput.fill("soul");
  await expect(page).toHaveURL(/\/souls\?/);

  await page.getByRole("button", { name: "Cards" }).click();
  await expect(page.locator(".skill-card").first()).toBeVisible();

  const firstSoul = page.locator(".skill-card").first();
  const soulName = (await firstSoul.locator(".skill-card-title").textContent())?.trim();
  expect(soulName).toBeTruthy();

  await firstSoul.click();
  await expect(page.getByRole("heading", { name: soulName! })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download SOUL.md" })).toBeVisible();

  const ownerLink = page.getByRole("link", { name: /@/ }).first();
  await ownerLink.click();
  await expect(page).toHaveURL(/\/u\//);
  await expect(page.getByRole("heading", { name: "Published" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stars" })).toBeVisible();
  await expectHealthyPage(page, errors);
});
