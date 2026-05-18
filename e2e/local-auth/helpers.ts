import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { waitForHydration } from "../helpers/runtimeErrors";

type DevPersona = "owner" | "user" | "admin";

function devPersonaHeaderPattern(persona: DevPersona, expectedHandle: string) {
  const displayName =
    persona === "owner" ? "Local Owner" : persona === "user" ? "Local User" : "Local Admin";
  const exactHandle =
    persona === "owner"
      ? `${escapeRegExp(expectedHandle)}(?![-\\w])`
      : escapeRegExp(expectedHandle);
  return new RegExp(`@(?:${exactHandle}|${escapeRegExp(displayName)})`, "i");
}

export function skillMd(args: { slug: string; displayName: string; versionLabel: string }) {
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

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function signInAsLocalPersona(page: Page, persona: DevPersona) {
  const expectedHandle = persona === "owner" ? "local" : `local-${persona}`;

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);

  await page.getByRole("button", { name: "Open local dev personas" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`use ${persona}`, "i") }).click();
  await expect(page.locator("header .user-trigger")).toContainText(
    devPersonaHeaderPattern(persona, expectedHandle),
    { timeout: 15_000 },
  );

  return expectedHandle;
}

export async function signInAsLocalOwner(page: Page) {
  return await signInAsLocalPublisher(page, "owner");
}

export async function signInAsLocalPublisher(page: Page, persona: DevPersona) {
  await signInAsLocalPersona(page, persona);
  await page.goto("/skills/publish", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Publish a skill" })).toBeVisible();
  const ownerSelect = page.locator("#ownerHandle");
  await expect(ownerSelect).not.toHaveValue("");
  const ownerHandle = await ownerSelect.inputValue();
  expect(ownerHandle.toLowerCase()).toContain("local");
  return ownerHandle;
}

export async function publishSkillVersion(
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

  const ownerSelect = page.locator("#ownerHandle");
  await ownerSelect.selectOption(args.ownerHandle);
  await expect(ownerSelect).toHaveValue(args.ownerHandle);
  await page.locator("#slug").fill(args.slug);
  await page.locator("#displayName").fill(args.displayName);
  await page.locator("#version").fill(args.version);
  await page.locator("#tags").fill("latest, stable");
  await page.locator("#changelog").fill(args.changelog);
  await page.getByLabel(/i have the rights to this skill/i).check();
  await page.getByTestId("upload-input").setInputFiles(skillDir);

  await expect(page.getByText("All checks passed.")).toBeVisible();
  await page.getByRole("button", { name: "Publish skill" }).click();
  await expect(page).toHaveURL(new RegExp(`/[^/]+/${escapeRegExp(args.slug)}$`), {
    timeout: 60_000,
  });
  const [, actualOwnerHandle, actualSlug] = new URL(page.url()).pathname
    .split("/")
    .map(decodeURIComponent);
  expect(actualOwnerHandle).toBeTruthy();
  expect(actualOwnerHandle?.toLowerCase()).toContain(args.ownerHandle.toLowerCase());
  expect(actualSlug).toBe(args.slug);
  await expect(page.locator(".skill-page-title")).toHaveText(args.displayName);
  return actualOwnerHandle!;
}
