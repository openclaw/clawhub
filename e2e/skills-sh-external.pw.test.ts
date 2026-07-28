import { copyFile, mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "./helpers/runtimeErrors";
import { routeVercelProtectionBypass } from "./helpers/vercelProtection";

test.skip(
  process.env.CLAWHUB_E2E_SKILLS_SH_EXTERNAL !== "1",
  "requires the controlled CLAW-583 permanent-Test fixture",
);

test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });

test("searches and opens the stored unscanned skills.sh listing", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  await routeVercelProtectionBypass(page);
  await mkdir("proof/claw-583", { recursive: true });

  await page.goto("/search?q=skills-sh%3Apatrick-erichsen%2Fskills%2Fhtml&type=skills", {
    waitUntil: "domcontentloaded",
  });
  await waitForHydration(page);
  const result = page.getByRole("link", { name: /HTML Artifact Chooser/ });
  await expect(result).toBeVisible();
  await expect(result.getByText("Not scanned by ClawHub")).toBeVisible();
  await page.screenshot({ path: "proof/claw-583/external-search.png", fullPage: true });
  await page.waitForTimeout(1_000);

  await result.click();
  await expect(page).toHaveURL(/\/skills-sh\/patrick-erichsen\/skills\/html$/);
  await expect(page.getByRole("heading", { name: "HTML Artifact Chooser" }).first()).toBeVisible();
  await expect(page.getByText("Not scanned by ClawHub").first()).toBeVisible();
  await expect(page.getByText("Upstream checks are separate from ClawHub scanning.")).toBeVisible();
  await expect(
    page.getByText("openclaw skills install skills-sh:patrick-erichsen/skills/html", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("clawhub install skills-sh:patrick-erichsen/skills/html", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /Stored (SKILL\.md|README)/ })).toBeVisible();
  await expect(page.getByText("File explorer")).toHaveCount(0);
  await expect(page.getByText("Files", { exact: true })).toHaveCount(0);

  const claim = page.getByRole("link", { name: "Claim" });
  await expect(claim).toHaveAttribute("href", /\/settings\?.*view=githubSources/);
  await expect(claim).toHaveAttribute("href", /repo=patrick-erichsen%2Fskills/);
  await expect(claim).toHaveAttribute("href", /sourcePath=skills%2Fhtml/);
  await page.screenshot({ path: "proof/claw-583/external-detail.png", fullPage: true });
  await expectHealthyPage(page, errors);

  await page.waitForTimeout(2_000);
  const video = page.video();
  await page.close();
  const videoPath = await video?.path();
  expect(videoPath).toBeTruthy();
  await copyFile(videoPath!, "proof/claw-583/external-flow.webm");
});
