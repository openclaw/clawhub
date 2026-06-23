import { expect, test } from "@playwright/test";
import { buildPublisherProfileHref } from "../../src/lib/ownerRoute";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "../helpers/runtimeErrors";
import { signInAsLocalPersona } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth header profile tests require the local dev auth runner",
);

test("signed-in avatar menu links to the active user profile", async ({ page }, testInfo) => {
  const errors = trackRuntimeErrors(page);

  await signInAsLocalPersona(page, "owner");
  await page.keyboard.press("Escape");
  await page.locator("header .user-trigger").click();

  const profileLink = page.getByRole("menuitem", { name: "Profile" });
  const profileHref = buildPublisherProfileHref("local");
  await expect(profileLink).toBeVisible();
  await expect(profileLink).toHaveAttribute("href", profileHref);
  await page.screenshot({
    path: testInfo.outputPath("signed-in-avatar-menu.png"),
    fullPage: true,
  });

  await profileLink.click();
  await page.waitForURL(`**${profileHref}`);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Local Owner" })).toBeVisible();
  await expectHealthyPage(page, errors);
});
