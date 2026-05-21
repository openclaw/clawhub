import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "./helpers/runtimeErrors";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const ownerLink = page.locator(`a[href="/p/${ownerHandle}"]`).first();

  await expect(ownerLink).toHaveAttribute("href", new RegExp(`/p/${ownerHandle}$`));
  await waitForHydration(page);
  await ownerLink.click();
  await expect(page).toHaveURL(new RegExp(`/p/${ownerHandle}$`));
  await expect(page.getByRole("heading", { name: "Publisher catalog" })).toBeAttached();
  await expect(page.getByRole("button", { name: /^Published/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Starred/ })).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("souls holding page links to live directories", async ({ browser, baseURL }) => {
  const appUrl = (path: string) => new URL(path, baseURL ?? "http://127.0.0.1:4173").toString();

  const page = await browser.newPage();
  const errors = trackRuntimeErrors(page);

  await page.goto(appUrl("/souls"), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "SOUL.md discovery is on deck" })).toBeVisible();

  const skillsLink = page.getByRole("link", { name: "Browse Skills" });
  await expect(skillsLink).toHaveAttribute("href", /\/skills/);
  const skillsHref = (await skillsLink.getAttribute("href")) ?? "/skills";

  const publishersLink = page.getByRole("link", { name: "Browse Publishers" });
  await expect(publishersLink).toHaveAttribute("href", /\/publishers/);
  const publishersHref = (await publishersLink.getAttribute("href")) ?? "/publishers";

  await expectHealthyPage(page, errors);
  await page.close();

  const skillsPage = await browser.newPage();
  const skillsErrors = trackRuntimeErrors(skillsPage);
  await skillsPage.goto(appUrl(skillsHref), {
    waitUntil: "domcontentloaded",
  });
  await expect(skillsPage).toHaveURL(/\/skills/);
  await expect(skillsPage.getByRole("heading", { name: /^Skills/ })).toBeVisible();
  await expectHealthyPage(skillsPage, skillsErrors);
  await skillsPage.close();

  const publishersPage = await browser.newPage();
  const publishersErrors = trackRuntimeErrors(publishersPage);
  await publishersPage.goto(appUrl(publishersHref), {
    waitUntil: "domcontentloaded",
  });
  await expect(publishersPage).toHaveURL(/\/publishers/);
  await expect(publishersPage.getByRole("heading", { name: /^Publishers/ })).toBeVisible();
  await expectHealthyPage(publishersPage, publishersErrors);
  await publishersPage.close();
});
