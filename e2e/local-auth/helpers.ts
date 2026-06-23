import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { buildSkillDetailHref } from "../../src/lib/ownerRoute";
import { waitForHydration } from "../helpers/runtimeErrors";

type DevPersona = "owner" | "user" | "admin" | "abusePublisher";

// The quality gate fingerprints line shape, so vary local-auth fixtures by slug.
const FINGERPRINT_SALT_LINES = [
  "Ready.",
  "Local publish path ready.",
  "The local publish path records browser state with enough detail for maintainers.",
  "- Upload.",
  "- Validate the local publish form.",
  "- Validate the local publish form after selecting owner, version, and generated files.",
  "1. Check final route.",
  "### Local browser release evidence and storage handoff notes",
] as const;

function hashFixtureInput(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function fingerprintSaltBlock(args: { slug: string; versionLabel: string }) {
  const hash = hashFixtureInput(`${args.versionLabel}:${args.slug}:local-auth`);
  const lines: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const code = (hash >>> (index * 3)) & 7;
    lines.push(FINGERPRINT_SALT_LINES[code] ?? FINGERPRINT_SALT_LINES[0]);
  }

  return lines.join("\n");
}

function devPersonaHeaderPattern(persona: DevPersona, expectedHandle: string) {
  const displayName =
    persona === "owner"
      ? "Local Owner"
      : persona === "user"
        ? "Local User"
        : persona === "abusePublisher"
          ? "Local Abuse Test Publisher"
          : "Local Admin";
  const displayNamePattern =
    persona === "abusePublisher"
      ? `${escapeRegExp("Local Abuse Test Publishe")}.*`
      : escapeRegExp(displayName);
  const exactHandle =
    persona === "owner"
      ? `${escapeRegExp(expectedHandle)}(?![-\\w])`
      : escapeRegExp(expectedHandle);
  return new RegExp(`@(?:${exactHandle}|${displayNamePattern})`, "i");
}

function devPersonaMenuLabel(persona: DevPersona) {
  if (persona === "abusePublisher") return "abuse publisher";
  return persona;
}

function parseSkillDetailPath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length >= 3 && segments[1] === "skills") {
    return { ownerHandle: segments[0], slug: segments[2] };
  }
  if (segments.length >= 2) {
    return { ownerHandle: segments[0], slug: segments[1] };
  }
  throw new Error(`Expected skill detail path, received ${pathname}`);
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

${fingerprintSaltBlock(args)}
`;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function expectLocalPersonaActive(page: Page, persona: DevPersona) {
  const expectedHandle =
    persona === "owner"
      ? "local"
      : persona === "abusePublisher"
        ? "local-abuse"
        : `local-${persona}`;
  await expect(page.locator("header .user-trigger")).toContainText(
    devPersonaHeaderPattern(persona, expectedHandle),
    { timeout: 15_000 },
  );
}

export async function signInAsLocalPersona(page: Page, persona: DevPersona) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);

  await page.getByRole("button", { name: "Open local dev personas" }).click();
  await page
    .getByRole("menuitem", { name: new RegExp(`use ${devPersonaMenuLabel(persona)}`, "i") })
    .click();
  try {
    await expectLocalPersonaActive(page, persona);
  } catch {
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await expectLocalPersonaActive(page, persona);
  }

  return persona === "owner"
    ? "local"
    : persona === "abusePublisher"
      ? "local-abuse"
      : `local-${persona}`;
}

export async function signInAsLocalOwner(page: Page) {
  return await signInAsLocalPublisher(page, "owner");
}

function parseOwnerHandle(text: string) {
  return text.match(/@([a-z0-9][a-z0-9-]*)/i)?.[1] ?? "";
}

async function isNativeOwnerSelect(page: Page, selector: string) {
  const ownerControl = page.locator(selector);
  await ownerControl.waitFor({ state: "attached" });
  return await ownerControl.evaluate((node) => node.tagName.toLowerCase() === "select");
}

async function getSelectedOwnerHandle(page: Page, selector: string) {
  const ownerControl = page.locator(selector);
  if (await isNativeOwnerSelect(page, selector)) {
    return await ownerControl.inputValue();
  }
  return parseOwnerHandle(await ownerControl.innerText());
}

export async function expectOwnerHandleSelected(page: Page, selector: string, ownerHandle: string) {
  await expect
    .poll(async () => await getSelectedOwnerHandle(page, selector), { timeout: 15_000 })
    .toBe(ownerHandle);
}

export async function selectOwnerHandle(page: Page, selector: string, ownerHandle: string) {
  const ownerControl = page.locator(selector);
  if (await isNativeOwnerSelect(page, selector)) {
    await ownerControl.selectOption(ownerHandle);
  } else {
    await ownerControl.click();
    await page
      .getByRole("option", {
        name: new RegExp(`@${escapeRegExp(ownerHandle)}(?:\\s|·|$)`, "i"),
      })
      .click();
  }
  await expectOwnerHandleSelected(page, selector, ownerHandle);
}

async function waitForPublishSkillForm(page: Page) {
  const heading = page.getByRole("heading", { name: "Publish a skill" });
  const retryButton = page.getByRole("button", { name: "Try again" });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForHydration(page).catch(() => {});
    if (await heading.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await page.locator("#ownerHandle").waitFor({ state: "attached", timeout: 15_000 });
      return;
    }
    if (await retryButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await retryButton.click();
    }
  }

  await expect(heading).toBeVisible({ timeout: 15_000 });
  await page.locator("#ownerHandle").waitFor({ state: "attached", timeout: 15_000 });
}

export async function signInAsLocalPublisher(page: Page, persona: DevPersona) {
  await signInAsLocalPersona(page, persona);
  await page.goto("/skills/publish", { waitUntil: "domcontentloaded" });
  await waitForPublishSkillForm(page);
  await expect
    .poll(
      async () => {
        const value = await getSelectedOwnerHandle(page, "#ownerHandle");
        // The owner persona can briefly render the user handle before the
        // personal publisher subscription reconciles to the publishable handle.
        if (!value || (persona === "owner" && value === "local")) return "";
        return value;
      },
      { timeout: 15_000 },
    )
    .not.toBe("");
  const ownerHandle = await getSelectedOwnerHandle(page, "#ownerHandle");
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

  await waitForPublishSkillForm(page);
  await selectOwnerHandle(page, "#ownerHandle", args.ownerHandle);
  await page.locator("#slug").fill(args.slug);
  await page.locator("#displayName").fill(args.displayName);
  await page.locator("#version").fill(args.version);
  await page.locator("#tags").fill("latest, stable");
  const changelog = page.locator("#changelog");
  if ((await changelog.count()) > 0) {
    await changelog.fill(args.changelog);
  }
  await page.getByLabel(/i have the rights to publish this skill/i).check();
  await page.getByTestId("upload-input").setInputFiles(skillDir);

  const publishButton = page.getByRole("button", { name: "Publish skill" });
  await expect(publishButton).toBeEnabled();
  await publishButton.click();
  await expect(page).toHaveURL(new RegExp(`/${escapeRegExp(args.slug)}$`), {
    timeout: 60_000,
  });
  const { ownerHandle: actualOwnerHandle, slug: actualSlug } = parseSkillDetailPath(
    new URL(page.url()).pathname,
  );
  expect(actualOwnerHandle).toBeTruthy();
  expect(actualOwnerHandle?.toLowerCase()).toContain(args.ownerHandle.toLowerCase());
  expect(actualSlug).toBe(args.slug);
  expect(new URL(page.url()).pathname).toBe(buildSkillDetailHref(actualOwnerHandle!, args.slug));
  const successDialog = page.getByRole("dialog", { name: /it's alive/i });
  // Slow local Convex runs can navigate successfully before Playwright observes the transient dialog.
  if (
    await successDialog.waitFor({ state: "visible", timeout: 10_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await successDialog.getByRole("button", { name: "View skill" }).click();
    await expect(successDialog).toBeHidden();
  }
  await expect(page.locator(".skill-page-title")).toHaveText(args.displayName);
  return actualOwnerHandle!;
}
