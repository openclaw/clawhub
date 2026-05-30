import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "../helpers/runtimeErrors";
import { signInAsLocalPersona } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth header profile tests require the local dev auth runner",
);

test("signed-in avatar menu links to the user's public profile", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  const handle = await signInAsLocalPersona(page, "owner");

  await page.keyboard.press("Escape");
  await page.locator("header .user-trigger").click();

  const profileLink = page.getByRole("menuitem", {
    name: "Profile",
  });
  await expect(profileLink).toBeVisible();
  await expect(profileLink).toHaveAttribute("href", `/user/${handle}`);

  await profileLink.click();
  await page.waitForURL(`**/user/${handle}`);
  await waitForHydration(page);

  await expect(page.getByRole("heading", { name: "Local Owner" })).toBeVisible();
  await expectHealthyPage(page, errors);
});
