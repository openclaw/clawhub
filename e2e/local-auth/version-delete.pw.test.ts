import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, type Locator, test } from "@playwright/test";
import { buildSkillDetailHref } from "../../src/lib/ownerRoute";
import { buildPluginDetailHref } from "../../src/lib/pluginRoutes";
import {
  expectHealthyPage,
  expectNoFatalErrorUi,
  trackRuntimeErrors,
  waitForHydration,
} from "../helpers/runtimeErrors";
import { signInAsLocalPersona } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth version deletion tests require the local dev auth runner",
);

const OLDER_VERSION = "1.0.0";
const LATEST_VERSION = "2.0.0";

function uniqueSuffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function localConvexDeployment() {
  const raw = readFileSync(".convex/local/default/config.json", "utf8");
  const parsed = JSON.parse(raw) as { deploymentName?: unknown };
  if (typeof parsed.deploymentName !== "string" || !parsed.deploymentName) {
    throw new Error("Local Convex deployment name was not available");
  }
  return `local:${parsed.deploymentName}`;
}

function extractLastJsonObject(output: string) {
  const trimmed = output.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== "{") continue;
    const candidate = trimmed.slice(index);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Convex can print status lines before the JSON payload.
    }
  }
  throw new Error(`No JSON object in convex run output:\n${output}`);
}

function runDevSeed<T>(functionName: string, args: Record<string, unknown>) {
  const result = spawnSync(
    "bunx",
    [
      "convex",
      "run",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      functionName,
      JSON.stringify(args),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, CONVEX_DEPLOYMENT: localConvexDeployment() },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      [`Failed to run ${functionName}.`, result.stdout.trim(), result.stderr.trim()].join("\n"),
    );
  }
  return JSON.parse(extractLastJsonObject(result.stdout)) as T;
}

type VersionDeletionFixture = {
  userId: string;
  publisherId: string;
  handle: string;
  skillId: string;
  olderSkillVersionId: string;
  latestSkillVersionId: string;
  packageId: string;
  olderPackageReleaseId: string;
  latestPackageReleaseId: string;
  skillSlug: string;
  packageName: string;
  publisherPublishedSkills: number;
  publisherPublishedPackages: number;
};

type VersionDeletionPublisherCounterGap = {
  publisherPublishedSkillsBefore: number;
  publisherPublishedPackagesBefore: number;
  publisherPublishedSkillsAfter: null;
  publisherPublishedPackagesAfter: null;
};

type VersionDeletionFixtureState = {
  skillLatestVersionId: string | null;
  skillLatestTagVersionId: string | null;
  skillLatestSummaryVersion: string | null;
  skillStatsVersions: number | null;
  skillActiveVersions: string[];
  olderSkillVersion: {
    exists: boolean;
    softDeletedAt: number | null;
    ownerDeletedAt: number | null;
    ownerDeletedBy: string | null;
  };
  latestSkillVersion: {
    exists: boolean;
    softDeletedAt: number | null;
    ownerDeletedAt: number | null;
    ownerDeletedBy: string | null;
  };
  skillAuditActions: string[];
  packageLatestReleaseId: string | null;
  packageLatestTagReleaseId: string | null;
  packageLatestSummaryVersion: string | null;
  packageStatsVersions: number | null;
  packageActiveVersions: string[];
  olderPackageRelease: {
    exists: boolean;
    softDeletedAt: number | null;
    ownerDeletedAt: number | null;
    ownerDeletedBy: string | null;
  };
  latestPackageRelease: {
    exists: boolean;
    softDeletedAt: number | null;
    ownerDeletedAt: number | null;
    ownerDeletedBy: string | null;
  };
  packageAuditActions: string[];
};

function seedVersionDeletionFixture(args: {
  skillSlug: string;
  skillDisplayName: string;
  packageName: string;
  packageDisplayName: string;
}) {
  return runDevSeed<VersionDeletionFixture>("devSeed:seedVersionDeletionFixture", args);
}

function getVersionDeletionFixtureState(fixture: VersionDeletionFixture) {
  return runDevSeed<VersionDeletionFixtureState>("devSeed:getVersionDeletionFixtureState", {
    userId: fixture.userId,
    skillId: fixture.skillId,
    olderSkillVersionId: fixture.olderSkillVersionId,
    latestSkillVersionId: fixture.latestSkillVersionId,
    packageId: fixture.packageId,
    olderPackageReleaseId: fixture.olderPackageReleaseId,
    latestPackageReleaseId: fixture.latestPackageReleaseId,
  });
}

function clearVersionDeletionPublisherCountersForRegression(fixture: VersionDeletionFixture) {
  return runDevSeed<VersionDeletionPublisherCounterGap>(
    "devSeed:clearVersionDeletionPublisherCountersForRegression",
    {
      publisherId: fixture.publisherId,
      skillId: fixture.skillId,
      packageId: fixture.packageId,
      expectedPublishedSkills: fixture.publisherPublishedSkills,
      expectedPublishedPackages: fixture.publisherPublishedPackages,
    },
  );
}

async function waitForAnimationsToSettle(locator: Locator) {
  await locator.evaluate(async (element) => {
    await Promise.allSettled(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
  });
}

async function expectDeleteDialog(page: Parameters<typeof expectHealthyPage>[0]) {
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: `Delete version ${OLDER_VERSION}?` }),
  ).toBeVisible();
  await expect(dialog).toContainText(
    `Deletion is permanent. Version ${OLDER_VERSION} cannot be restored or republished, and the version number remains reserved. Recovery is publishing a new version.`,
  );
  await expect(dialog.getByRole("button", { name: "Delete version" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /restore/i })).toHaveCount(0);
  await expect(dialog).toHaveAttribute("data-state", "open");
  await waitForAnimationsToSettle(dialog);
  await expect(dialog).toHaveAttribute("data-state", "open");
  return dialog;
}

function versionToggle(page: Parameters<typeof expectHealthyPage>[0], version: string) {
  return page
    .locator(".skill-version-release-toggle")
    .filter({ hasText: new RegExp(`^v${version.replaceAll(".", "\\.")}`) });
}

async function expectVersionsList(page: Parameters<typeof expectHealthyPage>[0]) {
  await expect(versionToggle(page, OLDER_VERSION)).toBeVisible();
  await expect(versionToggle(page, LATEST_VERSION)).toBeVisible();
  await expect(page.getByRole("button", { name: `Delete version ${OLDER_VERSION}` })).toBeVisible();
  await expect(page.getByRole("button", { name: `Delete version ${LATEST_VERSION}` })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: /restore/i })).toHaveCount(0);
}

async function expectPublicVersionsList(page: Parameters<typeof expectHealthyPage>[0]) {
  await expect(versionToggle(page, OLDER_VERSION)).toHaveCount(0);
  await expect(versionToggle(page, LATEST_VERSION)).toBeVisible();
  await expect(page.getByRole("button", { name: /delete version/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /restore/i })).toHaveCount(0);
}

test("owners can permanently delete individual non-latest skill and plugin versions", async ({
  baseURL,
  browser,
  page,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);
  const suffix = uniqueSuffix();
  const skillSlug = `pw-version-delete-skill-${suffix}`;
  const skillDisplayName = `Playwright Version Delete Skill ${suffix}`;
  const packageName = `@local-user/pw-version-delete-plugin-${suffix}`;
  const packageDisplayName = `Playwright Version Delete Plugin ${suffix}`;
  const fixture = seedVersionDeletionFixture({
    skillSlug,
    skillDisplayName,
    packageName,
    packageDisplayName,
  });
  expect(fixture.publisherPublishedSkills).toBeGreaterThanOrEqual(1);
  expect(fixture.publisherPublishedPackages).toBeGreaterThanOrEqual(1);
  console.log(
    `CLAW-333 fixture ${JSON.stringify({
      appUrl: testInfo.project.use.baseURL,
      handle: fixture.handle,
      packageName: fixture.packageName,
      skillSlug: fixture.skillSlug,
    })}`,
  );

  const initialState = getVersionDeletionFixtureState(fixture);
  expect(initialState).toMatchObject({
    skillLatestVersionId: fixture.latestSkillVersionId,
    skillLatestTagVersionId: fixture.latestSkillVersionId,
    skillLatestSummaryVersion: LATEST_VERSION,
    skillStatsVersions: 2,
    skillActiveVersions: [LATEST_VERSION, OLDER_VERSION],
    olderSkillVersion: {
      exists: true,
      softDeletedAt: null,
      ownerDeletedAt: null,
      ownerDeletedBy: null,
    },
    latestSkillVersion: {
      exists: true,
      softDeletedAt: null,
      ownerDeletedAt: null,
      ownerDeletedBy: null,
    },
    skillAuditActions: [],
    packageLatestReleaseId: fixture.latestPackageReleaseId,
    packageLatestTagReleaseId: fixture.latestPackageReleaseId,
    packageLatestSummaryVersion: LATEST_VERSION,
    packageStatsVersions: 2,
    packageActiveVersions: [LATEST_VERSION, OLDER_VERSION],
    olderPackageRelease: {
      exists: true,
      softDeletedAt: null,
      ownerDeletedAt: null,
      ownerDeletedBy: null,
    },
    latestPackageRelease: {
      exists: true,
      softDeletedAt: null,
      ownerDeletedAt: null,
      ownerDeletedBy: null,
    },
    packageAuditActions: [],
  });

  await signInAsLocalPersona(page, "user");

  const skillDetailHref = buildSkillDetailHref(fixture.handle, fixture.skillSlug);
  const pluginDetailHref = buildPluginDetailHref(fixture.packageName, {
    ownerHandle: fixture.handle,
  });

  await page.goto(skillDetailHref, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.locator(".skill-page-title")).toHaveText(skillDisplayName);
  await page.getByRole("tab", { name: "Versions" }).click();
  await expectVersionsList(page);
  await page.screenshot({
    path: testInfo.outputPath("skill-version-delete-before.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: `Delete version ${OLDER_VERSION}` }).click();
  const skillDialog = await expectDeleteDialog(page);
  await page.screenshot({
    path: testInfo.outputPath("skill-version-delete-confirmation.png"),
    fullPage: true,
  });
  await skillDialog.getByRole("button", { name: "Delete version" }).click();
  await expect(skillDialog).toHaveCount(0);
  await expect(versionToggle(page, OLDER_VERSION)).toHaveCount(0);
  await expect(versionToggle(page, LATEST_VERSION)).toBeVisible();
  await expect(page.getByRole("button", { name: /restore/i })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("skill-version-delete-after.png"),
    fullPage: true,
  });

  await page.goto(pluginDetailHref, {
    waitUntil: "domcontentloaded",
  });
  await waitForHydration(page);
  await expect(page.locator(".skill-page-title")).toHaveText(packageDisplayName);
  await page.getByRole("tab", { name: "Versions" }).click();
  await expectVersionsList(page);
  await page.screenshot({
    path: testInfo.outputPath("plugin-version-delete-before.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: `Delete version ${OLDER_VERSION}` }).click();
  const packageDialog = await expectDeleteDialog(page);
  await page.screenshot({
    path: testInfo.outputPath("plugin-version-delete-confirmation.png"),
    fullPage: true,
  });
  await packageDialog.getByRole("button", { name: "Delete version" }).click();
  await expect(packageDialog).toHaveCount(0);
  await expect(versionToggle(page, OLDER_VERSION)).toHaveCount(0);
  await expect(versionToggle(page, LATEST_VERSION)).toBeVisible();
  await expect(page.getByRole("button", { name: /restore/i })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("plugin-version-delete-after.png"),
    fullPage: true,
  });

  await expect
    .poll(() => getVersionDeletionFixtureState(fixture), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    })
    .toMatchObject({
      skillLatestVersionId: fixture.latestSkillVersionId,
      skillLatestTagVersionId: fixture.latestSkillVersionId,
      skillLatestSummaryVersion: LATEST_VERSION,
      skillStatsVersions: 2,
      skillActiveVersions: [LATEST_VERSION],
      olderSkillVersion: {
        exists: true,
        softDeletedAt: expect.any(Number),
        ownerDeletedAt: expect.any(Number),
        ownerDeletedBy: fixture.userId,
      },
      latestSkillVersion: {
        exists: true,
        softDeletedAt: null,
        ownerDeletedAt: null,
        ownerDeletedBy: null,
      },
      skillAuditActions: ["skill.version.delete"],
      packageLatestReleaseId: fixture.latestPackageReleaseId,
      packageLatestTagReleaseId: fixture.latestPackageReleaseId,
      packageLatestSummaryVersion: LATEST_VERSION,
      packageStatsVersions: 2,
      packageActiveVersions: [LATEST_VERSION],
      olderPackageRelease: {
        exists: true,
        softDeletedAt: expect.any(Number),
        ownerDeletedAt: expect.any(Number),
        ownerDeletedBy: fixture.userId,
      },
      latestPackageRelease: {
        exists: true,
        softDeletedAt: null,
        ownerDeletedAt: null,
        ownerDeletedBy: null,
      },
      packageAuditActions: ["package.release.delete"],
    });
  const finalState = getVersionDeletionFixtureState(fixture);
  expect(finalState.olderSkillVersion.softDeletedAt).toBe(
    finalState.olderSkillVersion.ownerDeletedAt,
  );
  expect(finalState.olderPackageRelease.softDeletedAt).toBe(
    finalState.olderPackageRelease.ownerDeletedAt,
  );

  if (!baseURL) throw new Error("Playwright base URL was not available");
  const publicContext = await browser.newContext({ baseURL });
  const publicPage = await publicContext.newPage();
  const publicErrors = trackRuntimeErrors(publicPage);
  try {
    await publicPage.goto(skillDetailHref, {
      waitUntil: "domcontentloaded",
    });
    await waitForHydration(publicPage);
    await expect(publicPage.locator(".skill-page-title")).toHaveText(skillDisplayName);
    await publicPage.getByRole("tab", { name: "Versions" }).click();
    await expectPublicVersionsList(publicPage);

    await publicPage.goto(pluginDetailHref, {
      waitUntil: "domcontentloaded",
    });
    await waitForHydration(publicPage);
    await expect(publicPage.locator(".skill-page-title")).toHaveText(packageDisplayName);
    await publicPage.getByRole("tab", { name: "Versions" }).click();
    await expectPublicVersionsList(publicPage);
    await expectHealthyPage(publicPage, publicErrors);
  } finally {
    await publicContext.close();
  }

  const counterGap = clearVersionDeletionPublisherCountersForRegression(fixture);
  expect(counterGap).toMatchObject({
    publisherPublishedSkillsBefore: fixture.publisherPublishedSkills,
    publisherPublishedPackagesBefore: fixture.publisherPublishedPackages,
    publisherPublishedSkillsAfter: null,
    publisherPublishedPackagesAfter: null,
  });

  const counterFixture = seedVersionDeletionFixture({
    skillSlug: `pw-version-delete-counter-skill-${suffix}`,
    skillDisplayName: `Playwright Version Delete Counter Skill ${suffix}`,
    packageName: `@claw333/pw-version-delete-counter-plugin-${suffix}`,
    packageDisplayName: `Playwright Version Delete Counter Plugin ${suffix}`,
  });
  expect(counterFixture.publisherPublishedSkills).toBe(fixture.publisherPublishedSkills + 1);
  expect(counterFixture.publisherPublishedPackages).toBe(fixture.publisherPublishedPackages + 1);
  expect(counterFixture.publisherPublishedSkills).toBeGreaterThan(1);
  expect(counterFixture.publisherPublishedPackages).toBeGreaterThan(1);

  await expectHealthyPage(page, errors);
  await expectNoFatalErrorUi(page);
});
