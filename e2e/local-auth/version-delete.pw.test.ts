import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, type APIRequestContext, type APIResponse, test } from "@playwright/test";
import { buildSkillDetailHref } from "../../src/lib/ownerRoute";
import { buildPluginDetailHref } from "../../src/lib/pluginRoutes";
import {
  expectNoFatalErrorUi,
  recoverFromTransientErrorScreen,
  trackRuntimeErrors,
  waitForHydration,
  withoutRecoverableReactHydrationErrors,
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
  skillDigestLatestVersionId: string | null;
  skillDigestLatestSummaryVersion: string | null;
  skillDigestTags: Record<string, string> | null;
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
  packageDigestLatestVersion: string | null;
  packageActiveVersions: string[];
  olderPackageDistTags: string[] | null;
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

type PublicVersionSurfaceState = {
  skillListVersions: string[];
  skillExactStatus: number;
  skillDownloadStatus: number;
  skillSearchVersion: string | null;
  packageListVersions: string[];
  packageExactStatus: number;
  packageDownloadStatus: number;
  packageLatestVersion: string | null;
  packageTags: Record<string, unknown> | null;
  packageSearchVersion: string | null;
};

function convexSiteUrl() {
  const value = process.env.VITE_CONVEX_SITE_URL;
  if (!value) throw new Error("VITE_CONVEX_SITE_URL is required");
  return value.replace(/\/$/u, "");
}

async function getWithRetry(request: APIRequestContext, url: string): Promise<APIResponse> {
  let lastResponse: APIResponse | null = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    lastResponse = await request.get(url);
    if (lastResponse.status() < 500) return lastResponse;
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  if (!lastResponse) throw new Error(`No response from ${url}`);
  return lastResponse;
}

async function getPublicVersionSurfaceState(
  request: APIRequestContext,
  fixture: VersionDeletionFixture,
): Promise<PublicVersionSurfaceState> {
  const site = convexSiteUrl();
  const owner = encodeURIComponent(fixture.handle);
  const slug = encodeURIComponent(fixture.skillSlug);
  const packageName = encodeURIComponent(fixture.packageName);
  const skillListResponse = await getWithRetry(
    request,
    `${site}/api/v1/skills/${slug}/versions?ownerHandle=${owner}`,
  );
  const skillExactResponse = await getWithRetry(
    request,
    `${site}/api/v1/skills/${slug}/versions/${OLDER_VERSION}?ownerHandle=${owner}`,
  );
  const skillDownloadResponse = await getWithRetry(
    request,
    `${site}/api/v1/download?slug=${slug}&ownerHandle=${owner}&version=${OLDER_VERSION}`,
  );
  const skillSearchResponse = await getWithRetry(
    request,
    `${site}/api/v1/packages/search?q=${slug}&family=skill`,
  );
  const packageListResponse = await getWithRetry(
    request,
    `${site}/api/v1/packages/${packageName}/versions`,
  );
  const packageExactResponse = await getWithRetry(
    request,
    `${site}/api/v1/packages/${packageName}/versions/${OLDER_VERSION}`,
  );
  const packageDownloadResponse = await getWithRetry(
    request,
    `${site}/api/v1/packages/${packageName}/download?version=${OLDER_VERSION}`,
  );
  const packageDetailResponse = await getWithRetry(
    request,
    `${site}/api/v1/packages/${packageName}`,
  );
  const packageSearchResponse = await getWithRetry(
    request,
    `${site}/api/v1/packages/search?q=${packageName}&family=code-plugin`,
  );
  const skillList = (await skillListResponse.json()) as { items?: Array<{ version?: string }> };
  const skillSearch = (await skillSearchResponse.json()) as {
    results?: Array<{ package?: { name?: string; latestVersion?: string | null } }>;
  };
  const packageList = (await packageListResponse.json()) as {
    items?: Array<{ version?: string }>;
  };
  const packageDetail = (await packageDetailResponse.json()) as {
    package?: {
      latestVersion?: string | null;
      tags?: Record<string, unknown>;
    } | null;
  };
  const packageSearch = (await packageSearchResponse.json()) as {
    results?: Array<{ package?: { name?: string; latestVersion?: string | null } }>;
  };
  return {
    skillListVersions: skillList.items?.flatMap((item) => item.version ?? []) ?? [],
    skillExactStatus: skillExactResponse.status(),
    skillDownloadStatus: skillDownloadResponse.status(),
    skillSearchVersion:
      skillSearch.results?.find((result) => result.package?.name === fixture.skillSlug)?.package
        ?.latestVersion ?? null,
    packageListVersions: packageList.items?.flatMap((item) => item.version ?? []) ?? [],
    packageExactStatus: packageExactResponse.status(),
    packageDownloadStatus: packageDownloadResponse.status(),
    packageLatestVersion: packageDetail.package?.latestVersion ?? null,
    packageTags: packageDetail.package?.tags ?? null,
    packageSearchVersion:
      packageSearch.results?.find((result) => result.package?.name === fixture.packageName)?.package
        ?.latestVersion ?? null,
  };
}

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

function pollableDevSeedState<TState extends object>(readState: () => TState) {
  try {
    return readState();
  } catch {
    return {};
  }
}

function isExpectedVersionDeletionRuntimeError(error: string) {
  if (
    error ===
    "console:Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
  ) {
    return true;
  }

  if (!error.includes("Function execution timed out")) return false;
  return [
    "[CONVEX Q(packages:canDeleteVersions)]",
    "[CONVEX Q(packages:getActivityTrendForName)]",
    "[CONVEX Q(packages:getPackageInspectorValidationSummaryPublic)]",
    "[CONVEX Q(packages:getManageContext)]",
    "[CONVEX Q(packages:listPackageInspectorWarningsForManager)]",
    "[CONVEX Q(publishers:getByHandle)]",
    "[CONVEX Q(publishers:getMyProfileHandle)]",
    "[CONVEX Q(publishers:listMine)]",
    "[CONVEX Q(skills:getActivityTrendForSlug)]",
    "[CONVEX Q(skills:getBySlug)]",
    "[CONVEX Q(skills:list)]",
    "[CONVEX Q(skills:listVersions)]",
    "[CONVEX M(users:ensure)]",
    "[CONVEX Q(users:me)]",
  ].some((prefix) => error.includes(prefix));
}

async function expectDeleteDialog(page: Parameters<typeof expectNoFatalErrorUi>[0]) {
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: `Delete version ${OLDER_VERSION}?` }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText(
    "This withdraws the version from public use. You can restore the exact retained artifact later, but the version number remains reserved and cannot be republished with different contents.",
  );
  await expect(dialog.getByRole("button", { name: "Delete version" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog).toHaveAttribute("data-state", "open");
  return dialog;
}

async function expectRestoreDialog(page: Parameters<typeof expectNoFatalErrorUi>[0]) {
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: `Restore version ${OLDER_VERSION}?` }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText(
    "This restores the exact retained artifact. It will not become latest or regain removed tags automatically.",
  );
  return dialog;
}

function versionToggle(page: Parameters<typeof expectNoFatalErrorUi>[0], version: string) {
  return page
    .locator(".skill-version-release-toggle")
    .filter({ hasText: new RegExp(`^v${version.replaceAll(".", "\\.")}`) });
}

async function ensureVersionsTab(page: Parameters<typeof expectNoFatalErrorUi>[0]) {
  await recoverFromTransientErrorScreen(page);
  await page.getByRole("tab", { name: "Versions" }).click({ timeout: 30_000 });
}

async function openDeleteDialog(page: Parameters<typeof expectNoFatalErrorUi>[0]) {
  const deleteButton = page.getByRole("button", { name: `Delete version ${OLDER_VERSION}` });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await expect(deleteButton).toBeVisible({ timeout: 30_000 });
      await expect(deleteButton).toBeEnabled({ timeout: 30_000 });
      await deleteButton.click();
      return await expectDeleteDialog(page);
    } catch (error) {
      lastError = error;
      if (attempt >= 3) throw error;
      await page.keyboard.press("Escape").catch(() => {});
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForHydration(page);
      await ensureVersionsTab(page);
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  throw lastError;
}

async function confirmDeleteDialog(page: Parameters<typeof expectNoFatalErrorUi>[0]) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let deleteButton: ReturnType<typeof page.getByRole> | null = null;
    try {
      await recoverFromTransientErrorScreen(page);
      const dialog = page.getByRole("dialog");
      deleteButton = dialog.getByRole("button", { name: "Delete version" });
      await expect(deleteButton).toBeVisible({ timeout: 30_000 });
      await expect(deleteButton).toBeEnabled({ timeout: 30_000 });
    } catch (error) {
      lastError = error;
      if (attempt >= 3) throw error;
      await page.keyboard.press("Escape").catch(() => {});
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForHydration(page);
      await ensureVersionsTab(page);
      await openDeleteDialog(page);
      await page.waitForTimeout(1_000 * attempt);
    }
    if (!deleteButton) continue;
    try {
      await deleteButton.click({ timeout: 30_000 });
      return;
    } catch (error) {
      await recoverFromTransientErrorScreen(page).catch(() => {});
      await ensureVersionsTab(page).catch(() => {});
      if ((await versionToggle(page, OLDER_VERSION).count()) === 0) return;
      throw error;
    }
  }
  throw lastError;
}

async function restoreOlderVersion(page: Parameters<typeof expectNoFatalErrorUi>[0]) {
  const restoreButton = page.getByRole("button", { name: `Restore version ${OLDER_VERSION}` });
  await expect(restoreButton).toBeVisible({ timeout: 30_000 });
  await restoreButton.click();
  const dialog = await expectRestoreDialog(page);
  await dialog.getByRole("button", { name: "Restore version" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Delete version ${OLDER_VERSION}` })).toBeVisible({
    timeout: 30_000,
  });
}

async function expectVersionsList(page: Parameters<typeof expectNoFatalErrorUi>[0]) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await waitForHydration(page).catch(() => {});
      await recoverFromTransientErrorScreen(page);
      await ensureVersionsTab(page);
      const versionsPanel = page.getByRole("tabpanel", { name: "Versions" });
      const retryButton = versionsPanel.getByRole("button", { name: "Try again" });
      if (await retryButton.isVisible({ timeout: 500 }).catch(() => false)) {
        await retryButton.click({ timeout: 5_000 });
        await waitForHydration(page).catch(() => {});
      }

      await expect(versionToggle(page, OLDER_VERSION)).toBeVisible({ timeout: 30_000 });
      await expect(versionToggle(page, LATEST_VERSION)).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByRole("button", { name: `Delete version ${OLDER_VERSION}` }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByRole("button", { name: `Delete version ${LATEST_VERSION}` }),
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: /restore/i })).toHaveCount(0);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= 4) throw error;
      await recoverFromTransientErrorScreen(page).catch(() => {});
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await waitForHydration(page).catch(() => {});
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  throw lastError;
}

async function expectPublicVersionsList(page: Parameters<typeof expectNoFatalErrorUi>[0]) {
  await ensureVersionsTab(page);
  await expect(versionToggle(page, OLDER_VERSION)).toBeVisible();
  await expect(versionToggle(page, LATEST_VERSION)).toBeVisible();
  await expect(page.getByRole("button", { name: /delete version/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /restore/i })).toHaveCount(0);
}

test("owners can withdraw and restore individual non-latest skill and plugin versions", async ({
  baseURL,
  browser,
  page,
}, testInfo) => {
  testInfo.setTimeout(360_000);
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
    `CLAW-575 fixture ${JSON.stringify({
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
    skillDigestLatestVersionId: fixture.latestSkillVersionId,
    skillDigestLatestSummaryVersion: LATEST_VERSION,
    skillDigestTags: { latest: fixture.latestSkillVersionId },
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
    packageDigestLatestVersion: LATEST_VERSION,
    packageActiveVersions: [LATEST_VERSION, OLDER_VERSION],
    olderPackageDistTags: [],
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
  await recoverFromTransientErrorScreen(page);
  await expect(page.locator(".skill-page-title")).toHaveText(skillDisplayName, { timeout: 30_000 });
  await expectVersionsList(page);
  await page.screenshot({
    path: testInfo.outputPath("skill-version-delete-before.png"),
    fullPage: true,
  });

  const skillDialog = await openDeleteDialog(page);
  await page.screenshot({
    path: testInfo.outputPath("skill-version-delete-confirmation.png"),
    fullPage: true,
  });
  await confirmDeleteDialog(page);
  await expect(skillDialog).toHaveCount(0);
  await ensureVersionsTab(page);
  await expect(versionToggle(page, OLDER_VERSION)).toBeVisible();
  await expect(versionToggle(page, LATEST_VERSION)).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Restore version ${OLDER_VERSION}` }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("skill-version-delete-after.png"),
    fullPage: true,
  });
  expect(await getPublicVersionSurfaceState(page.request, fixture)).toMatchObject({
    skillListVersions: [LATEST_VERSION],
    skillExactStatus: 404,
    skillDownloadStatus: 410,
    skillSearchVersion: LATEST_VERSION,
    packageLatestVersion: LATEST_VERSION,
    packageSearchVersion: LATEST_VERSION,
  });
  await restoreOlderVersion(page);
  await page.screenshot({
    path: testInfo.outputPath("skill-version-restore-after.png"),
    fullPage: true,
  });
  expect(await getPublicVersionSurfaceState(page.request, fixture)).toMatchObject({
    skillListVersions: [LATEST_VERSION, OLDER_VERSION],
    skillExactStatus: 200,
    skillDownloadStatus: 200,
    skillSearchVersion: LATEST_VERSION,
  });

  await page.goto(pluginDetailHref, {
    waitUntil: "domcontentloaded",
  });
  await waitForHydration(page);
  await recoverFromTransientErrorScreen(page);
  await expect(page.locator(".skill-page-title")).toHaveText(packageDisplayName, {
    timeout: 30_000,
  });
  await expectVersionsList(page);
  await page.screenshot({
    path: testInfo.outputPath("plugin-version-delete-before.png"),
    fullPage: true,
  });

  const packageDialog = await openDeleteDialog(page);
  await page.screenshot({
    path: testInfo.outputPath("plugin-version-delete-confirmation.png"),
    fullPage: true,
  });
  await confirmDeleteDialog(page);
  await expect(packageDialog).toHaveCount(0);
  await ensureVersionsTab(page);
  await expect(versionToggle(page, OLDER_VERSION)).toBeVisible();
  await expect(versionToggle(page, LATEST_VERSION)).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Restore version ${OLDER_VERSION}` }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("plugin-version-delete-after.png"),
    fullPage: true,
  });
  expect(await getPublicVersionSurfaceState(page.request, fixture)).toMatchObject({
    packageListVersions: [LATEST_VERSION],
    packageExactStatus: 404,
    packageDownloadStatus: 404,
    packageLatestVersion: LATEST_VERSION,
    packageTags: { latest: LATEST_VERSION },
    packageSearchVersion: LATEST_VERSION,
  });
  await restoreOlderVersion(page);
  await page.screenshot({
    path: testInfo.outputPath("plugin-version-restore-after.png"),
    fullPage: true,
  });
  expect(await getPublicVersionSurfaceState(page.request, fixture)).toMatchObject({
    packageListVersions: [LATEST_VERSION, OLDER_VERSION],
    packageExactStatus: 200,
    packageDownloadStatus: 200,
    packageLatestVersion: LATEST_VERSION,
    packageTags: { latest: LATEST_VERSION },
    packageSearchVersion: LATEST_VERSION,
  });

  await expect
    .poll(() => pollableDevSeedState(() => getVersionDeletionFixtureState(fixture)), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    })
    .toMatchObject({
      skillLatestVersionId: fixture.latestSkillVersionId,
      skillLatestTagVersionId: fixture.latestSkillVersionId,
      skillLatestSummaryVersion: LATEST_VERSION,
      skillStatsVersions: 2,
      skillDigestLatestVersionId: fixture.latestSkillVersionId,
      skillDigestLatestSummaryVersion: LATEST_VERSION,
      skillDigestTags: { latest: fixture.latestSkillVersionId },
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
      skillAuditActions: ["skill.version.delete", "skill.version.restore"],
      packageLatestReleaseId: fixture.latestPackageReleaseId,
      packageLatestTagReleaseId: fixture.latestPackageReleaseId,
      packageLatestSummaryVersion: LATEST_VERSION,
      packageStatsVersions: 2,
      packageDigestLatestVersion: LATEST_VERSION,
      packageActiveVersions: [LATEST_VERSION, OLDER_VERSION],
      olderPackageDistTags: [],
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
      packageAuditActions: ["package.release.delete", "package.release.restore"],
    });
  const finalState = getVersionDeletionFixtureState(fixture);
  expect(finalState.olderSkillVersion.softDeletedAt).toBeNull();
  expect(finalState.olderPackageRelease.softDeletedAt).toBeNull();

  if (!baseURL) throw new Error("Playwright base URL was not available");
  const publicContext = await browser.newContext({ baseURL });
  const publicPage = await publicContext.newPage();
  const publicErrors = trackRuntimeErrors(publicPage);
  try {
    await publicPage.goto(skillDetailHref, {
      waitUntil: "domcontentloaded",
    });
    await waitForHydration(publicPage);
    await recoverFromTransientErrorScreen(publicPage);
    await expect(publicPage.locator(".skill-page-title")).toHaveText(skillDisplayName);
    await expectPublicVersionsList(publicPage);

    await publicPage.goto(pluginDetailHref, {
      waitUntil: "domcontentloaded",
    });
    await waitForHydration(publicPage);
    await recoverFromTransientErrorScreen(publicPage);
    await expect(publicPage.locator(".skill-page-title")).toHaveText(packageDisplayName);
    await expectPublicVersionsList(publicPage);
    await expectNoFatalErrorUi(publicPage);
    expect(
      withoutRecoverableReactHydrationErrors(publicErrors).filter(
        (error) => !isExpectedVersionDeletionRuntimeError(error),
      ),
    ).toEqual([]);
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

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await recoverFromTransientErrorScreen(page);
  await expectNoFatalErrorUi(page);
  expect(
    withoutRecoverableReactHydrationErrors(errors).filter(
      (error) => !isExpectedVersionDeletionRuntimeError(error),
    ),
  ).toEqual([]);
});
