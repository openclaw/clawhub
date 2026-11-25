import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  expectNoFatalErrorUi,
  expectNoRuntimeErrors,
  recoverFromTransientErrorScreen,
  trackRuntimeErrors,
  waitForHydration,
} from "../helpers/runtimeErrors";
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

test.setTimeout(180_000);

async function gotoUntilStarButtonReady(page: Page, detailPath: string): Promise<Locator> {
  const starButton = page.getByRole("button", { name: "Bookmark skill" });
  let lastError: unknown;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await page.goto(detailPath, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await recoverFromTransientErrorScreen(page).catch(() => {});
    try {
      await expect(starButton).toBeVisible({ timeout: 30_000 });
      return starButton;
    } catch (error) {
      lastError = error;
      if (attempt >= 4) break;
      await page.waitForTimeout(1_000 * attempt);
    }
  }

  throw lastError;
}

async function expectHealthyStarPage(page: import("@playwright/test").Page, errors: string[]) {
  const expectedTransientTimeouts = [
    "CONVEX Q(users:me)",
    "CONVEX Q(publishers:getMyProfileHandle)",
    "CONVEX Q(publishers:getProfileByHandle)",
    "CONVEX Q(publishers:listMine)",
    "CONVEX Q(skills:checkSlugAvailability)",
    "CONVEX Q(skills:getBySlug)",
    "CONVEX Q(skills:listPublicPageV4)",
    "CONVEX Q(skills:listVersions)",
    "CONVEX Q(stars:isStarred)",
    "CONVEX M(users:ensure)",
    "CONVEX M(securityScan:enqueueSkillVersionScanInternal)",
  ];
  await expectNoFatalErrorUi(page);
  await expectNoRuntimeErrors(
    page,
    errors.filter(
      (error) =>
        !(
          error.includes("Function execution timed out (maximum duration: 1s)") &&
          expectedTransientTimeouts.some((functionName) => error.includes(functionName))
        ),
    ),
  );
}

test("bookmarking a skill survives refresh with the synchronized count", async ({
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
  errors.length = 0;

  await signInAsLocalPersona(page, "user");
  errors.length = 0;
  const bookmarkButton = await gotoUntilStarButtonReady(
    page,
    buildSkillDetailHref(ownerHandle, slug),
  );
  await expectLocalPersonaActive(page, "user");

  await expect(bookmarkButton).toContainText("0");

  await bookmarkButton.click();

  const unbookmarkButton = page.getByRole("button", { name: "Unbookmark skill" });
  await expect(unbookmarkButton).toBeVisible({ timeout: 30_000 });
  await expect(unbookmarkButton).toContainText("1", { timeout: 30_000 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForHydration(page);

  const refreshedUnbookmarkButton = page.getByRole("button", { name: "Unbookmark skill" });
  await expect(refreshedUnbookmarkButton).toBeVisible({ timeout: 30_000 });
  await expect(refreshedUnbookmarkButton).toContainText("1", { timeout: 30_000 });

  await expectHealthyStarPage(page, errors);
});
