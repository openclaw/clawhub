import { expect, test } from "@playwright/test";
import {
  expectHealthyPage,
  trackRuntimeErrors,
  waitForHydration,
  withoutRecoverableReactHydrationErrors,
} from "../helpers/runtimeErrors";
import {
  buildSkillDetailHref,
  completeMockPrePublicationChecks,
  publishSkillVersion,
  signInAsLocalPublisher,
} from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "malicious skill ban flow requires the local dev auth runner",
);
test.setTimeout(900_000);
test.describe.configure({ retries: 0 });

async function getNewVersionHref(page: Parameters<typeof waitForHydration>[0], detailPath: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await page.goto(detailPath, { waitUntil: "domcontentloaded" });
      await waitForHydration(page);
      const newVersionLink = page.getByRole("link", { name: "New version" });
      await expect(newVersionLink).toBeVisible({ timeout: 15_000 });
      const href = await newVersionLink.getAttribute("href", { timeout: 5_000 });
      expect(href).toBeTruthy();
      return href!;
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  throw lastError;
}

async function expectCurrentVersion(page: import("@playwright/test").Page, version: string) {
  const metadata = page.locator(".detail-sidebar-stats .sidebar-metadata");
  await expect(metadata.getByText("Current version", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(metadata.getByText(`v${version}`, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

function withoutExpectedPublishFlowErrors(errors: string[]) {
  const recoverableTimeouts = [
    "CONVEX Q(skills:listVersions)",
    "CONVEX Q(skills:list)",
    "CONVEX Q(skills:getBySlug)",
    "CONVEX Q(skills:checkSlugAvailability)",
    "CONVEX Q(users:me)",
    "CONVEX Q(publishers:listMine)",
    "CONVEX Q(publishers:getMyProfileHandle)",
  ];
  return withoutRecoverableReactHydrationErrors(errors).filter(
    (error) =>
      error !==
        "console:Failed to load resource: the server responded with a status of 503 (Service Unavailable)" &&
      !(error.includes("CONVEX M(users:ensure)") && error.includes("User not found")) &&
      !(
        error.includes("Function execution timed out (maximum duration: 1s)") &&
        recoverableTimeouts.some((functionName) => error.includes(functionName))
      ) &&
      !(
        error.includes("CONVEX A(skills:publishVersion)") &&
        error.includes("Version ") &&
        error.includes(" already exists")
      ) &&
      !(error.includes("CONVEX A(skills:publishVersion)") && error.includes("Unauthorized")) &&
      !(
        error.includes("CONVEX A(skills:publishVersion)") &&
        error.includes("Function execution timed out")
      ),
  );
}

test("malicious prepublication retries keep the clean latest visible", async ({
  page,
}, testInfo) => {
  await page.route("https://openclaw.ai/**", (route) => route.fulfill({ status: 204 }));
  const errors = trackRuntimeErrors(page);
  const slug = `pw-malware-${Date.now().toString(36)}`;
  const displayName = "Playwright Malicious Skill Flow";

  const ownerHandle = await signInAsLocalPublisher(page, "abusePublisher");
  await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName,
    version: "1.0.0",
    versionLabel: "clean baseline release",
    changelog: "Clean baseline release before malicious retry validation.",
  });
  await page.goto("about:blank");
  const skillDetailPath = buildSkillDetailHref(ownerHandle, slug);
  await page.goto(skillDetailPath, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expectCurrentVersion(page, "1.0.0");

  const maliciousVersions = ["1.0.1", "1.0.2", "1.0.3"] as const;
  for (const version of maliciousVersions) {
    const newVersionHref = await getNewVersionHref(page, skillDetailPath);
    await page.goto(newVersionHref, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/skills\/publish\?updateSlug=/);
    await publishSkillVersion(page, testInfo, {
      ownerHandle,
      slug,
      displayName,
      version,
      versionLabel: `malicious retry ${version}`,
      changelog: `Synthetic malicious retry ${version}.`,
      completeChecks: false,
    });
    await page.goto("about:blank");
    await completeMockPrePublicationChecks({
      kind: "skill",
      slug,
      version,
      clawscan: "malicious",
    });
    await page.goto(skillDetailPath, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await expectCurrentVersion(page, "1.0.0");
  }

  await expectHealthyPage(page, withoutExpectedPublishFlowErrors(errors));
});
