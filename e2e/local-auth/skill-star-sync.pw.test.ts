import { expect, test } from "@playwright/test";
import {
  expectNoFatalErrorUi,
  expectNoRuntimeErrors,
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
  errors.length = 0;

  await signInAsLocalPersona(page, "user");
  await page.goto(buildSkillDetailHref(ownerHandle, slug), { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expectLocalPersonaActive(page, "user");

  const starButton = page.getByRole("button", { name: "Star skill" });
  await expect(starButton).toBeVisible();
  await expect(starButton).toContainText("0");

  await starButton.click();

  const unstarButton = page.getByRole("button", { name: "Unstar skill" });
  await expect(unstarButton).toBeVisible({ timeout: 30_000 });
  await expect(unstarButton).toContainText("1", { timeout: 30_000 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForHydration(page);

  const refreshedUnstarButton = page.getByRole("button", { name: "Unstar skill" });
  await expect(refreshedUnstarButton).toBeVisible({ timeout: 30_000 });
  await expect(refreshedUnstarButton).toContainText("1", { timeout: 30_000 });

  await expectHealthyStarPage(page, errors);
});
