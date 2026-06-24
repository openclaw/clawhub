import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  expectNoFatalErrorUi,
  trackRuntimeErrors,
  waitForHydration,
} from "../helpers/runtimeErrors";
import { escapeRegExp, signInAsLocalPersona } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth org deletion tests require the local dev auth runner",
);

test.use({ video: process.env.CLAWHUB_ORG_DELETE_PROOF_VIDEO === "1" ? "on" : "off" });
test.setTimeout(180_000);

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

type OrgDeletionFixture = {
  publisherId: string;
  skillId: string;
  packageId: string;
  handle: string;
  skillSlug: string;
  packageName: string;
};

type OrgDeletionFixtureState = {
  publisherExists: boolean;
  publisherPubliclyVisible: boolean;
  skillExists: boolean;
  skillActive: boolean;
  skillPubliclyVisible: boolean;
  packageExists: boolean;
  packageActive: boolean;
  packagePubliclyVisible: boolean;
  packageSoftDeletedAt: number | null;
};

function seedOrgDeletionFixture(args: {
  handle: string;
  displayName: string;
  skillSlug: string;
  skillDisplayName: string;
  packageName: string;
  packageDisplayName: string;
}) {
  return runDevSeed<OrgDeletionFixture>("devSeed:seedOrgDeletionFixture", args);
}

function getOrgDeletionFixtureState(fixture: OrgDeletionFixture) {
  return runDevSeed<OrgDeletionFixtureState>("devSeed:getOrgDeletionFixtureState", {
    publisherId: fixture.publisherId,
    skillId: fixture.skillId,
    packageId: fixture.packageId,
  });
}

function pollableDevSeedState<TState extends object>(readState: () => TState) {
  try {
    return readState();
  } catch {
    return {};
  }
}

function clearExpectedNotFoundNavigationErrors(errors: string[]) {
  for (let index = errors.length - 1; index >= 0; index -= 1) {
    if (
      errors[index] ===
      "console:Failed to load resource: the server responded with a status of 404 (Not Found)"
    ) {
      errors.splice(index, 1);
    }
  }
}

function isExpectedOrgDeletionRuntimeError(error: string) {
  if (!error.includes("Function execution timed out")) return false;
  return [
    "[CONVEX Q(users:me)]",
    "[CONVEX Q(publishers:getProfileByHandle)]",
    "[CONVEX Q(publishers:getMyProfileHandle)]",
    "[CONVEX Q(publishers:getPublishedDisplayManifest)]",
    "[CONVEX Q(publishers:listMembers)]",
    "[CONVEX Q(publishers:listMine)]",
    "[CONVEX Q(publishers:listPublishedPage)]",
    "[CONVEX Q(publishers:listStarredPage)]",
    "[CONVEX Q(skills:listPublicPageV4)]",
    "[CONVEX Q(packages:countPublicPlugins)]",
    "[CONVEX Q(packages:searchForViewerInternal)]",
    "[CONVEX Q(tokens:listMine)]",
    "[CONVEX M(functions:syncPackageSearchDigestsForOwnerUserIdInternal)]",
    "[CONVEX M(functions:syncPackageSearchDigestsForOwnerPublisherIdInternal)]",
    "[CONVEX M(functions:syncSkillSearchDigestsForOwnerPublisherIdInternal)]",
    "[CONVEX M(users:ensure)]",
  ].some((prefix) => error.includes(prefix));
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

async function expectPublisherProfileSkillLink(
  page: Page,
  args: { headingName: string; skillSlug: string },
) {
  await expect(page.getByRole("heading", { name: args.headingName })).toBeVisible();
  await expect(page.getByRole("region", { name: "Publisher catalog" })).toBeVisible();
  await expect(page.locator(`a[href$="/${args.skillSlug}"]`).first()).toBeVisible({
    timeout: 30_000,
  });
}

test("org owners can delete an org and hide its skills and plugins", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  const suffix = uniqueSuffix();
  const handle = `pw-org-del-${suffix}`;
  const displayName = `Playwright Delete Org ${suffix}`;
  const skillSlug = `pw-org-delete-skill-${suffix}`;
  const skillDisplayName = `Playwright Org Delete Skill ${suffix}`;
  const packageName = `pw-org-delete-plugin-${suffix}`;
  const packageDisplayName = `Playwright Org Delete Plugin ${suffix}`;

  const fixture = seedOrgDeletionFixture({
    handle,
    displayName,
    skillSlug,
    skillDisplayName,
    packageName,
    packageDisplayName,
  });

  await signInAsLocalPersona(page, "owner");
  errors.length = 0;

  await gotoUntilVisible(page, `/user/${handle}`, page.getByRole("heading", { name: displayName }));
  await expectPublisherProfileSkillLink(page, { headingName: displayName, skillSlug });

  await gotoUntilVisible(
    page,
    `/plugins/${encodeURIComponent(packageName)}`,
    page.getByText(packageDisplayName),
  );

  await gotoUntilVisible(
    page,
    "/settings?view=organizations",
    page.getByText(`@${handle} · owner`),
  );
  await page.getByRole("button", { name: "Delete organization" }).click();
  await expect(page.getByText(`Permanently delete @${handle}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Resources permanently deleted")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Permanently delete organization" }).click();
  await expect(page.getByText(`Permanently delete @${handle}`)).toHaveCount(0, {
    timeout: 20_000,
  });

  await expect
    .poll(() => pollableDevSeedState(() => getOrgDeletionFixtureState(fixture)), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    })
    .toMatchObject({
      publisherPubliclyVisible: false,
      skillPubliclyVisible: false,
      skillActive: false,
      packagePubliclyVisible: false,
      packageActive: false,
    });

  await page.goto(`/user/${handle}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: /we couldn't find that page/i })).toBeVisible();
  await expect(page.getByText(skillDisplayName)).toHaveCount(0);
  await expect(page.getByText(packageDisplayName)).toHaveCount(0);
  clearExpectedNotFoundNavigationErrors(errors);

  await page.goto(`/plugins/${encodeURIComponent(packageName)}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Plugin not found" })).toBeVisible();
  await expect(page.getByText(new RegExp(escapeRegExp(packageDisplayName)))).toHaveCount(0);
  clearExpectedNotFoundNavigationErrors(errors);

  await expectNoFatalErrorUi(page);
  expect(errors.filter((error) => !isExpectedOrgDeletionRuntimeError(error))).toEqual([]);
});
