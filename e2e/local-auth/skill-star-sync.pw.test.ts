import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "../helpers/runtimeErrors";
import {
  buildSkillDetailHref,
  expectLocalPersonaActive,
  publishSkillVersion,
  signInAsLocalPersona,
  signInAsLocalPublisher,
} from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth star sync tests require the local dev auth runner",
);

test("starring a skill survives refresh with the synchronized count", async ({
  page,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);
  const slug = `pw-star-${Date.now().toString(36)}`;
  const displayName = "Playwright Star Sync Skill";

  let ownerHandle = await signInAsLocalPublisher(page, "admin");
  ownerHandle = await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName,
    version: "1.0.0",
    versionLabel: "star sync release",
    changelog: "Initial release for the star count synchronization flow.",
  });

  await signInAsLocalPersona(page, "user");
  await page.goto(buildSkillDetailHref(ownerHandle, slug), { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expectLocalPersonaActive(page, "user");

  const starButton = page.getByRole("button", { name: "Star skill" });
  await expect(starButton).toBeVisible();
  await expect(starButton).toContainText("0");

  await starButton.click();

  const unstarButton = page.getByRole("button", { name: "Unstar skill" });
  await expect(unstarButton).toBeVisible();
  await expect(unstarButton).toContainText("1");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForHydration(page);

  const refreshedUnstarButton = page.getByRole("button", { name: "Unstar skill" });
  await expect(refreshedUnstarButton).toBeVisible();
  await expect(refreshedUnstarButton).toContainText("1");

  await expectHealthyPage(page, errors);
});
