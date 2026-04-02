import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";

test("home install switcher and browse CTA work", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /clawhub, the skill dock/i })).toBeVisible();
  await expect(page.getByText("npx clawhub@latest install sonoscli")).toBeVisible();

  await page.getByRole("tab", { name: "pnpm" }).click();
  await expect(page.getByText("pnpm dlx clawhub@latest install sonoscli")).toBeVisible();

  await page.getByRole("tab", { name: "bun" }).click();
  await expect(page.getByText("bunx clawhub@latest install sonoscli")).toBeVisible();

  await page.getByRole("link", { name: "Browse skills" }).click();
  await expect(page).toHaveURL(/\/skills/);
  await expect(page.getByRole("heading", { name: /^Skills/ })).toBeVisible();
  await expectHealthyPage(page, errors);
});

test("legacy search route redirects into skills browse", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/search?q=gifgrep&nonSuspicious=1", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/skills\?/);
  await expect(page).toHaveURL(/q=gifgrep/);
  await expect(page.locator('input[placeholder="Filter by name, slug, or summary…"]')).toHaveValue(
    "gifgrep",
  );
  await expectHealthyPage(page, errors);
});
