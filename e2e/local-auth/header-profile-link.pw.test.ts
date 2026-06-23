import { expect, test } from "@playwright/test";
import { buildPublisherProfileHref } from "../../src/lib/ownerRoute";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "../helpers/runtimeErrors";
import { signInAsLocalPersona } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth header profile tests require the local dev auth runner",
);

test.setTimeout(600_000);

async function openAvatarMenuProfileLink(
  page: import("@playwright/test").Page,
  restoreSignedInHeader: () => Promise<void>,
) {
  const profileLink = page.getByRole("menuitem", { name: "Profile" });
  let lastError: unknown;

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await page.keyboard.press("Escape").catch(() => {});
    try {
      await waitForHydration(page);
      const userTrigger = page.locator("header .user-trigger");
      await expect(userTrigger).toBeVisible({ timeout: 15_000 });
      await userTrigger.click({ timeout: 5_000 });
      await expect(profileLink).toBeVisible({ timeout: 5_000 });
      return profileLink;
    } catch (error) {
      lastError = error;
      // Local Convex can drop the signed-in header while profile subscriptions
      // time out under 10-lane pressure. A fresh dev-auth sign-in recovers it.
      await page.keyboard.press("Escape").catch(() => {});
      await restoreSignedInHeader();
    }
    await page.waitForTimeout(1_000 * attempt);
  }

  throw lastError ?? new Error("Profile link did not become available");
}

function withoutExpectedHeaderTransientErrors(errors: string[]) {
  return errors.filter(
    (error) =>
      !(
        error.includes("Function execution timed out (maximum duration: 1s)") &&
        [
          "[CONVEX M(users:ensure)]",
          "[CONVEX Q(publishers:getMyProfileHandle)]",
          "[CONVEX Q(publishers:getProfileByHandle)]",
          "[CONVEX Q(users:me)]",
        ].some((functionName) => error.includes(functionName))
      ),
  );
}

test("signed-in avatar menu links to the active user profile", async ({ page }, testInfo) => {
  const errors = trackRuntimeErrors(page);

  await signInAsLocalPersona(page, "owner");
  errors.length = 0;

  const profileHref = buildPublisherProfileHref("local");
  const profileLink = await openAvatarMenuProfileLink(page, async () => {
    await signInAsLocalPersona(page, "owner");
  });
  await expect(profileLink).toHaveAttribute("href", profileHref);
  await page.screenshot({
    path: testInfo.outputPath("signed-in-avatar-menu.png"),
    fullPage: true,
  });

  await profileLink.click();
  await page.waitForURL(`**${profileHref}`);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Local Owner" })).toBeVisible();
  await expectHealthyPage(page, withoutExpectedHeaderTransientErrors(errors));
});
