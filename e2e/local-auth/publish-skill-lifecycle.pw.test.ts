import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors } from "../helpers/runtimeErrors";
import { publishSkillVersion, signInAsLocalOwner } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth lifecycle tests require the local dev auth runner",
);

test("skill publishers can create a skill and publish a new version", async ({
  page,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);
  const slug = `pw-life-${Date.now().toString(36)}`;
  const displayName = "Playwright Lifecycle Skill";

  let ownerHandle = await signInAsLocalOwner(page);

  ownerHandle = await publishSkillVersion(page, testInfo, {
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

  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await page.getByRole("link", { name: "New version" }).click();

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
