import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "../helpers/runtimeErrors";
import { escapeRegExp, signInAsLocalPersona } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth org deletion tests require the local dev auth runner",
);

test.use({ video: process.env.CLAWHUB_ORG_DELETE_PROOF_VIDEO === "1" ? "on" : "off" });

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

function seedOrgDeletionFixture(args: {
  handle: string;
  displayName: string;
  skillSlug: string;
  skillDisplayName: string;
  packageName: string;
  packageDisplayName: string;
}) {
  const result = spawnSync(
    "bunx",
    [
      "convex",
      "run",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      "devSeed:seedOrgDeletionFixture",
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
      ["Failed to seed org deletion fixture.", result.stdout.trim(), result.stderr.trim()].join(
        "\n",
      ),
    );
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

test("org owners can delete an org and hide its skills and plugins", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  const suffix = uniqueSuffix();
  const handle = `pw-org-del-${suffix}`;
  const displayName = `Playwright Delete Org ${suffix}`;
  const skillSlug = `pw-org-delete-skill-${suffix}`;
  const skillDisplayName = `Playwright Org Delete Skill ${suffix}`;
  const packageName = `pw-org-delete-plugin-${suffix}`;
  const packageDisplayName = `Playwright Org Delete Plugin ${suffix}`;

  seedOrgDeletionFixture({
    handle,
    displayName,
    skillSlug,
    skillDisplayName,
    packageName,
    packageDisplayName,
  });

  await signInAsLocalPersona(page, "owner");

  await page.goto(`/user/${handle}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
  await expect(page.getByText(skillDisplayName)).toBeVisible();

  await page.goto(`/plugins/${encodeURIComponent(packageName)}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByText(packageDisplayName)).toBeVisible();

  await page.goto("/settings?view=organizations", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByText(`@${handle} · owner`)).toBeVisible();
  await page.getByRole("button", { name: "Delete organization" }).click();
  await expect(page.getByText(`Delete @${handle}?`)).toBeVisible();
  await page.getByRole("button", { name: "Delete organization" }).last().click();
  await expect(page.getByText(`Delete @${handle}?`)).toHaveCount(0, { timeout: 20_000 });

  await page.goto(`/user/${handle}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: /we couldn't find that page/i })).toBeVisible();
  await expect(page.getByText(skillDisplayName)).toHaveCount(0);
  await expect(page.getByText(packageDisplayName)).toHaveCount(0);
  clearExpectedNotFoundNavigationErrors(errors);

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
  clearExpectedNotFoundNavigationErrors(errors);

  await expectHealthyPage(page, errors);
});
