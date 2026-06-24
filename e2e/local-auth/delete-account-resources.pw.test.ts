import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  expectNoFatalErrorUi,
  trackRuntimeErrors,
  waitForHydration,
} from "../helpers/runtimeErrors";
import { buildPublisherProfileHref, escapeRegExp, signInAsLocalPersona } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth account deletion tests require the local dev auth runner",
);
test.setTimeout(600_000);

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

type AccountDeletionFixture = {
  userId: string;
  publisherId: string;
  handle: string;
  skillId: string;
  skillSlug: string;
  packageId: string;
};

type AccountDeletionFixtureState = {
  user:
    | {
        exists: true;
        handle: string | null;
        deactivatedAt: number | null;
        purgedAt: number | null;
        deletedAt: number | null;
      }
    | { exists: false };
  publisherExists: boolean;
  skillExists: boolean;
  skillActive: boolean;
  skillSoftDeletedAt: number | null;
  packageExists: boolean;
  skillPubliclyVisible: boolean;
  packagePubliclyVisible: boolean;
  packageActive: boolean;
  packageSoftDeletedAt: number | null;
  authAccountCount: number;
  authSessionCount: number;
};

type AccountRecreationState = {
  previousUser:
    | {
        exists: true;
        handle: string | null;
        deactivatedAt: number | null;
        purgedAt: number | null;
        deletedAt: number | null;
      }
    | { exists: false };
  previousPublisherExists: boolean;
  previousSkillActive: boolean;
  previousPackageActive: boolean;
  activeUser: {
    userId: string;
    handle: string;
    deactivatedAt: number | null;
    purgedAt: number | null;
    deletedAt: number | null;
    personalPublisherId: string | null;
  } | null;
  activePublisher: {
    publisherId: string;
    handle: string;
    linkedUserId: string | null;
    deactivatedAt: number | null;
    deletedAt: number | null;
  } | null;
};

function seedAccountDeletionFixture(args: {
  skillSlug: string;
  skillDisplayName: string;
  packageName: string;
  packageDisplayName: string;
}) {
  return runDevSeed<AccountDeletionFixture>("devSeed:seedAccountDeletionFixture", args);
}

function getAccountDeletionFixtureState(fixture: AccountDeletionFixture) {
  return runDevSeed<AccountDeletionFixtureState>("devSeed:getAccountDeletionFixtureState", {
    userId: fixture.userId,
    publisherId: fixture.publisherId,
    skillId: fixture.skillId,
    packageId: fixture.packageId,
  });
}

function getAccountRecreationState(fixture: AccountDeletionFixture) {
  return runDevSeed<AccountRecreationState>("devSeed:getAccountRecreationState", {
    handle: fixture.handle,
    previousUserId: fixture.userId,
    previousPublisherId: fixture.publisherId,
    previousSkillId: fixture.skillId,
    previousPackageId: fixture.packageId,
  });
}

function pollableDevSeedState<TState extends object>(readState: () => TState) {
  try {
    return readState();
  } catch {
    return {};
  }
}

function isExpectedAccountDeletionRuntimeError(error: string) {
  if (error.includes("Selected isolate was not clean")) return true;
  if (error.includes("server responded with a status of 404 (Not Found)")) return true;
  if (!error.includes("Function execution timed out")) return false;
  return [
    "[CONVEX Q(users:me)]",
    "[CONVEX Q(publishers:getMyProfileHandle)]",
    "[CONVEX Q(publishers:getProfileByHandle)]",
    "[CONVEX Q(publishers:getPublishedDisplayManifest)]",
    "[CONVEX Q(publishers:listMembers)]",
    "[CONVEX Q(publishers:listPublishedPage)]",
    "[CONVEX Q(publishers:listStarredPage)]",
    "packagesGetRouterV1Handler",
  ].some((prefix) => error.includes(prefix));
}

function isExpectedAccountDeletionTransitionRuntimeError(error: string) {
  if (error.includes("pageerror:Minified React error #418")) return true;
  return isExpectedAccountDeletionRuntimeError(error);
}

async function gotoUntilVisible(page: Page, url: string, target: Locator) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    try {
      await expect(target).toBeVisible({ timeout: 20_000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 11) break;
      await page.waitForTimeout(1_000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function expectAccountDeletionResources(
  page: Page,
  args: { skillDisplayName: string; packageDisplayName: string },
) {
  const dialog = page.getByRole("dialog", { name: "Delete account" });
  await expect(dialog.getByText("This permanently deletes your account")).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog.getByText("Resources permanently deleted")).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(
      async () => {
        const text = (await dialog.textContent().catch(() => "")) ?? "";
        return {
          hasPackage: text.includes(args.packageDisplayName),
          hasSkill: text.includes(args.skillDisplayName),
        };
      },
      { timeout: 120_000, intervals: [500, 1_000, 2_000] },
    )
    .toEqual({ hasPackage: true, hasSkill: true });
}

test("users can permanently delete their account and personal publisher resources", async ({
  page,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);
  const suffix = uniqueSuffix();
  const skillSlug = `pw-account-delete-skill-${suffix}`;
  const skillDisplayName = `Playwright Account Delete Skill ${suffix}`;
  const packageName = `pw-account-delete-plugin-${suffix}`;
  const packageDisplayName = `Playwright Account Delete Plugin ${suffix}`;

  const fixture = seedAccountDeletionFixture({
    skillSlug,
    skillDisplayName,
    packageName,
    packageDisplayName,
  });

  await signInAsLocalPersona(page, "user");

  await gotoUntilVisible(
    page,
    buildPublisherProfileHref(fixture.handle),
    page.getByRole("heading", { name: "Local User" }),
  );
  await expect(page.getByRole("region", { name: "Publisher catalog" })).toBeVisible();
  await expect(page.locator(`a[href$="/${fixture.skillSlug}"]`).first()).toBeVisible({
    timeout: 30_000,
  });

  await gotoUntilVisible(
    page,
    `/plugins/${encodeURIComponent(packageName)}`,
    page.getByText(packageDisplayName),
  );

  await page.goto("/settings?view=danger", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await page.getByRole("button", { name: "Delete account" }).click();
  await expectAccountDeletionResources(page, {
    packageDisplayName,
    skillDisplayName,
  });
  await page.screenshot({
    path: testInfo.outputPath("account-deletion-confirmation.png"),
    fullPage: true,
  });
  expect(errors.filter((error) => !isExpectedAccountDeletionRuntimeError(error))).toEqual([]);
  errors.length = 0;
  await page.getByRole("button", { name: "Permanently delete account" }).click();
  await expect(page.getByText("This permanently deletes your account")).toHaveCount(0, {
    timeout: 20_000,
  });

  await expect
    .poll(() => pollableDevSeedState(() => getAccountDeletionFixtureState(fixture)), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    })
    .toMatchObject({
      user: {
        exists: true,
        handle: null,
        deletedAt: null,
      },
      publisherExists: false,
      skillPubliclyVisible: false,
      packagePubliclyVisible: false,
      skillActive: false,
      packageActive: false,
      authAccountCount: 0,
      authSessionCount: 0,
    });
  const finalState = getAccountDeletionFixtureState(fixture);
  expect(finalState.user.exists).toBe(true);
  if (finalState.user.exists) {
    expect(finalState.user.deactivatedAt).toEqual(expect.any(Number));
    expect(finalState.user.purgedAt).toEqual(expect.any(Number));
  }
  await expectNoFatalErrorUi(page);
  expect(errors.filter((error) => !isExpectedAccountDeletionTransitionRuntimeError(error))).toEqual(
    [],
  );
  errors.length = 0;

  await page.goto(buildPublisherProfileHref(fixture.handle), { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: /publisher not found|we couldn't find that page/i }),
  ).toBeVisible();
  await expect(page.getByText(skillDisplayName)).toHaveCount(0);
  await expect(page.getByText(packageDisplayName)).toHaveCount(0);

  await page.goto(`/skills?q=${encodeURIComponent(skillSlug)}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByText("No skills found")).toBeVisible();
  await expect(page.getByText(skillDisplayName)).toHaveCount(0);

  await page.goto(`/plugins?q=${encodeURIComponent(packageName)}`, {
    waitUntil: "domcontentloaded",
  });
  await waitForHydration(page);
  await expect(page.getByText("No plugins found")).toBeVisible();
  await expect(page.getByText(new RegExp(escapeRegExp(packageDisplayName)))).toHaveCount(0);

  await page.goto(`/plugins/${encodeURIComponent(packageName)}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Plugin not found" })).toBeVisible();
  await expect(page.getByText(new RegExp(escapeRegExp(packageDisplayName)))).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("account-deletion-post-cleanup.png"),
    fullPage: true,
  });

  await signInAsLocalPersona(page, "user");
  await expect
    .poll(() => pollableDevSeedState(() => getAccountRecreationState(fixture)), {
      timeout: 30_000,
      intervals: [500, 1_000, 2_000],
    })
    .toMatchObject({
      previousUser: {
        exists: true,
        handle: null,
        deletedAt: null,
      },
      previousPublisherExists: false,
      previousSkillActive: false,
      previousPackageActive: false,
      activeUser: {
        deactivatedAt: null,
        purgedAt: null,
        deletedAt: null,
      },
      activePublisher: {
        handle: fixture.handle,
        deactivatedAt: null,
        deletedAt: null,
      },
    });
  const recreationState = getAccountRecreationState(fixture);
  expect(recreationState.activeUser?.userId).toBeTruthy();
  expect(recreationState.activeUser?.userId).not.toBe(fixture.userId);
  expect(recreationState.activePublisher?.publisherId).toBeTruthy();
  expect(recreationState.activePublisher?.publisherId).not.toBe(fixture.publisherId);
  expect(recreationState.activePublisher?.linkedUserId).toBe(recreationState.activeUser?.userId);
  expect(recreationState.activeUser?.personalPublisherId).toBe(
    recreationState.activePublisher?.publisherId,
  );

  await gotoUntilVisible(
    page,
    buildPublisherProfileHref(fixture.handle),
    page.getByRole("heading", { name: "Local User" }),
  );
  await expect(page.getByText(skillDisplayName)).toHaveCount(0);
  await expect(page.getByText(packageDisplayName)).toHaveCount(0);

  await expectNoFatalErrorUi(page);
  expect(errors.filter((error) => !isExpectedAccountDeletionRuntimeError(error))).toEqual([]);
});
