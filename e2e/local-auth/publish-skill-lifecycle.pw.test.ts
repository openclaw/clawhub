import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "../helpers/runtimeErrors";

function skillMd(args: { slug: string; displayName: string; versionLabel: string }) {
  return `---
name: ${args.slug}
description: ${args.displayName} verifies that ClawHub can publish and replace skill releases through the browser UI.
---

# ${args.displayName}

Use this skill when validating ClawHub's browser publishing workflow in local development or pull request CI.

## Workflow

The skill documents a realistic release process so the publish quality gate sees meaningful content.

- Prepare a small folder with SKILL.md and supporting text files.
- Publish the first release through the browser form.
- Return from the detail page and publish a new version from owner settings.
- Confirm the current version and version history both update after publication.

## Verification Notes

This ${args.versionLabel} payload is intentionally deterministic and text-only.
It avoids external credentials, network access, binary files, and production state.
Maintainers can run it against a disposable local Convex backend to prove the UI still supports the full version lifecycle.
`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function signInAsLocalOwner(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);

  await page.getByRole("button", { name: "Open local dev personas" }).click();
  await page.getByRole("menuitem", { name: /use owner/i }).click();
  await expect(page.locator("header .user-trigger")).toContainText(/@local(?: owner)?/i, {
    timeout: 15_000,
  });

  await page.goto("/skills/publish", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Publish a skill" })).toBeVisible();
  const ownerSelect = page.locator("#ownerHandle");
  await expect(ownerSelect).not.toHaveValue("");
  const ownerHandle = await ownerSelect.inputValue();
  expect(ownerHandle.toLowerCase()).toContain("local");
  return ownerHandle;
}

async function publishSkillVersion(
  page: Page,
  testInfo: TestInfo,
  args: {
    ownerHandle: string;
    slug: string;
    displayName: string;
    version: string;
    versionLabel: string;
    changelog: string;
  },
) {
  const skillDir = testInfo.outputPath(`${args.slug}-${args.version}`);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    skillMd({
      slug: args.slug,
      displayName: args.displayName,
      versionLabel: args.versionLabel,
    }),
    "utf8",
  );

  await page.locator("#slug").fill(args.slug);
  await page.locator("#displayName").fill(args.displayName);
  await page.locator("#version").fill(args.version);
  await page.locator("#tags").fill("latest, stable");
  await page.locator("#changelog").fill(args.changelog);
  await page.getByLabel(/i have the rights to this skill/i).check();
  await page.getByTestId("upload-input").setInputFiles(skillDir);

  await expect(page.getByText("All checks passed.")).toBeVisible();
  await page.getByRole("button", { name: "Publish skill" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${escapeRegExp(encodeURIComponent(args.ownerHandle))}/${args.slug}$`),
    { timeout: 60_000 },
  );
  await expect(page.locator(".skill-page-title")).toHaveText(args.displayName);
}

test("skill publishers can create a skill and publish a new version", async ({
  page,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);
  const slug = `pw-life-${Date.now().toString(36)}`;
  const displayName = "Playwright Lifecycle Skill";

  const ownerHandle = await signInAsLocalOwner(page);

  await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName,
    version: "1.0.0",
    versionLabel: "first release",
    changelog: "Initial release from the browser publish flow.",
  });

  const metadata = page.locator(".sidebar-metadata");
  await expect(metadata.getByText("Current version", { exact: true })).toBeVisible();
  await expect(metadata.getByText("v1.0.0", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Skill settings" })).toBeVisible();
  await page.getByRole("link", { name: "New Version" }).click();

  await expect(page).toHaveURL(/\/skills\/publish\?updateSlug=/);
  await expect(page.locator("#slug")).toHaveValue(slug);
  await expect(page.locator("#displayName")).toHaveValue(displayName);
  await expect(page.locator("#version")).toHaveValue("1.0.1");
  await expect(page.locator("#ownerHandle")).toHaveValue(ownerHandle);

  await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName,
    version: "1.0.1",
    versionLabel: "second release",
    changelog: "Second release published through the owner new-version workflow.",
  });

  await expect(metadata.getByText("Current version", { exact: true })).toBeVisible();
  await expect(metadata.getByText("v1.0.1", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Versions" }).click();
  await expect(page.getByRole("heading", { name: "Versions" })).toBeVisible();
  await expect(page.getByText(/^v1\.0\.1\b/).first()).toBeVisible();
  await expect(page.getByText(/^v1\.0\.0\b/).first()).toBeVisible();

  await expectHealthyPage(page, errors);
});
