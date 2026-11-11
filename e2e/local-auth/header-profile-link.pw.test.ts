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

for (const { label, width, height } of [
  { label: "mobile", width: 390, height: 844 },
  { label: "desktop", width: 1280, height: 900 },
] as const) {
  test(`${label} header keeps navigation and avatar profile access usable`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    const errors = trackRuntimeErrors(page);

    await signInAsLocalPersona(page, "owner");
    // Persona selection leaves a modal menu open, hiding header roles.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Open local dev personas" })).not.toBeVisible();
    errors.length = 0;

    const header = page.locator("header.navbar");
    const avatar = header.locator(".user-trigger");
    const menu = header.getByRole("button", { name: "Open menu", exact: true });
    const search = header.locator(".navbar-search-mobile-trigger");
    const navigation = header.getByRole("navigation", {
      name: "Primary navigation",
      includeHidden: true,
    });
    const inlineSearch = header.locator(".navbar-search");
    await expect(avatar).toBeVisible();
    await expect(avatar.locator("img, .user-menu-fallback")).toBeVisible();

    if (label === "mobile") {
      await expect(menu).toBeVisible();
      await expect(search).toBeVisible();
      await expect(navigation).not.toBeVisible();
      await expect(inlineSearch).not.toBeVisible();
    } else {
      await expect(navigation).toBeVisible();
      await expect(inlineSearch.getByRole("combobox", { name: "Search" })).toBeVisible();
      await expect(menu).not.toBeVisible();
      await expect(search).not.toBeVisible();
    }

    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    const boxes = [];
    for (const control of label === "mobile" ? [menu, search, avatar] : [avatar]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y).toBeGreaterThanOrEqual(headerBox!.y);
      expect(box!.y + box!.height).toBeLessThanOrEqual(headerBox!.y + headerBox!.height);
      boxes.push(box!);
    }
    boxes.sort((a, b) => a.x - b.x);
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index - 1]!.x + boxes[index - 1]!.width).toBeLessThanOrEqual(boxes[index]!.x);
    }

    if (label === "mobile") {
      await menu.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("link", { name: "Skills", exact: true })).toBeVisible();
      await expect(dialog.getByRole("link", { name: "Plugins", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
    }

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
}
