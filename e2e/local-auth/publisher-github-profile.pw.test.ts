import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "../helpers/runtimeErrors";
import { signInAsLocalPersona } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "publisher GitHub profile tests require the local dev auth runner",
);

test.setTimeout(180_000);

test("org admins can link a verified GitHub organization to the public profile", async ({
  page,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);

  await signInAsLocalPersona(page, "officialOrgMember");
  errors.length = 0;

  await page.goto("/settings?view=organizations", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);

  const githubOrgSelect = page.getByRole("combobox", { name: "GitHub organization" });
  await expect(githubOrgSelect).toBeVisible({ timeout: 30_000 });

  if ((await githubOrgSelect.textContent())?.includes("@trycua")) {
    await githubOrgSelect.click();
    await page.getByRole("option", { name: "No GitHub organization" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Organization updated", { exact: true })).toBeVisible();
  }

  await githubOrgSelect.click();
  await page.getByRole("option", { name: "@trycua · member" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Organization updated", { exact: true })).toBeVisible();

  await page.goto("/local-official-org", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);

  const githubLink = page.getByRole("link", { name: "GitHub · @trycua" });
  await expect(githubLink).toHaveAttribute("href", "https://github.com/trycua");
  await page.screenshot({
    path: testInfo.outputPath("publisher-github-profile.png"),
    fullPage: true,
  });

  await expectHealthyPage(page, errors);
});
