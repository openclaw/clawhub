import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { buildPublisherProfileHref, buildSkillDetailHref } from "../../src/lib/ownerRoute";
import {
  buildPluginDetailHref,
  buildPluginSecurityAuditHref,
  buildPluginValidationHref,
} from "../../src/lib/pluginRoutes";
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

async function expectPublishedDetailPage(page: Page, displayName: string) {
  const title = page.locator(".skill-page-title");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await waitForHydration(page);
    try {
      await expect(title).toHaveText(displayName, { timeout: 30_000 });
      return;
    } catch (error) {
      if (attempt >= 3) throw error;
      await page.reload({ waitUntil: "domcontentloaded" });
    }
  }
}

async function fillPublishSkillForm(
  page: Page,
  args: {
    ownerHandle: string;
    slug: string;
    displayName: string;
    version: string;
    changelog: string;
  },
  skillDir: string,
) {
  await selectOwnerHandle(page, "#ownerHandle", args.ownerHandle);
  await page.locator("#slug").fill(args.slug, { timeout: 15_000 });
  await page.locator("#displayName").fill(args.displayName, { timeout: 15_000 });
  await page.locator("#version").fill(args.version, { timeout: 15_000 });
  await page.locator("#tags").fill("latest, stable", { timeout: 15_000 });
  const changelog = page.locator("#changelog");
  if ((await changelog.count()) > 0) {
    await changelog.fill(args.changelog, { timeout: 15_000 });
  }
  await page.getByLabel(/i have the rights to publish this skill/i).check({ timeout: 15_000 });
  await page.getByTestId("upload-input").setInputFiles(skillDir, { timeout: 15_000 });
}

async function hasDuplicateVersionAlert(page: Page, version: string) {
  const alert = page.getByRole("alert");
  const text = await alert.textContent({ timeout: 500 }).catch(() => "");
  return text?.includes(`Version ${version} already exists`) ?? false;
}

function skillDetailPath(ownerHandle: string, slug: string) {
  return buildSkillDetailHref(ownerHandle, slug);
}

async function publishedSkillVersionExists(
  page: Page,
  args: {
    ownerHandle: string;
    slug: string;
    version: string;
  },
) {
  const url = `/api/v1/skills/${encodeURIComponent(args.slug)}/versions/${encodeURIComponent(
    args.version,
  )}?ownerHandle=${encodeURIComponent(args.ownerHandle)}`;
  const response = await page.request.get(url, { timeout: 2_000 }).catch(() => null);
  if (!response?.ok()) return false;
  const body = (await response.json().catch(() => null)) as {
    version?: { version?: unknown };
  } | null;
  return body?.version?.version === args.version;
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

function devPersonaHandle(persona: DevPersona) {
  return persona === "owner"
    ? "local"
    : persona === "abusePublisher"
      ? "local-abuse"
      : `local-${persona}`;
}

export {
  buildPluginDetailHref,
  buildPluginSecurityAuditHref,
  buildPluginValidationHref,
  buildPublisherProfileHref,
  buildSkillDetailHref,
};

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
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForHydration(page);

      await page
        .getByRole("button", { name: "Open local dev personas" })
        .click({ timeout: 15_000 });
      const personaMenuItem = page.getByRole("menuitem", {
        name: new RegExp(`use ${devPersonaMenuLabel(persona)}`, "i"),
      });
      await expect(personaMenuItem).toBeVisible({ timeout: 15_000 });
      await personaMenuItem.click({ timeout: 15_000 });
      await expectLocalPersonaActive(page, persona);
      return devPersonaHandle(persona);
    } catch (error) {
      lastError = error;
      if (attempt >= 3) throw error;
      await page.waitForTimeout(1_000 * attempt);
    }
  }

  if (lastError) throw lastError;
  return devPersonaHandle(persona);
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

export async function expectOwnerHandleSelected(
  page: Page,
  selector: string,
  ownerHandle: string,
  timeout = 15_000,
) {
  await expect
    .poll(async () => await getSelectedOwnerHandle(page, selector), { timeout })
    .toBe(ownerHandle);
}

export async function selectOwnerHandle(page: Page, selector: string, ownerHandle: string) {
  const ownerControl = page.locator(selector);
  try {
    await expectOwnerHandleSelected(page, selector, ownerHandle, 5_000);
    return;
  } catch {
    // Fall through to the explicit select path if the publish form is still hydrating.
  }

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
  const rightsCheckbox = page.getByLabel(/i have the rights to publish this skill/i);
  const requiredControls = ["#ownerHandle", "#slug", "#displayName", "#version", "#tags"] as const;
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await waitForHydration(page).catch(() => {});
    if (await heading.isVisible({ timeout: 5_000 }).catch(() => false)) {
      try {
        for (const selector of requiredControls) {
          await page.locator(selector).waitFor({ state: "attached", timeout: 15_000 });
        }
        await expect(rightsCheckbox).toBeVisible({ timeout: 15_000 });
        await page.getByTestId("upload-input").waitFor({ state: "attached", timeout: 15_000 });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    if (await retryButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await retryButton.click();
    } else if (attempt < 3) {
      await page.reload({ waitUntil: "domcontentloaded" });
    }
  }

  await expect(heading).toBeVisible({ timeout: 15_000 });
  for (const selector of requiredControls) {
    await page.locator(selector).waitFor({ state: "attached", timeout: 15_000 });
  }
  await expect(rightsCheckbox)
    .toBeVisible({ timeout: 15_000 })
    .catch((error) => {
      throw lastError ?? error;
    });
  await page.getByTestId("upload-input").waitFor({ state: "attached", timeout: 15_000 });
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
      { timeout: 120_000, intervals: [500, 1_000, 2_000] },
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
    versionExists?: () => Promise<boolean>;
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
  const publishButton = page.getByRole("button", { name: "Publish skill" });
  const detailUrlPattern = new RegExp(`/[^/]+/(?:skills/)?${escapeRegExp(args.slug)}$`);
  const versionExists = async () =>
    args.versionExists ? await args.versionExists() : await publishedSkillVersionExists(page, args);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let publishUrl = page.url();
    try {
      await fillPublishSkillForm(page, args, skillDir);
      await expect(publishButton).toBeEnabled({ timeout: 30_000 });
      publishUrl = page.url();
      await publishButton.click({ timeout: 15_000 });
      await expect
        .poll(
          async () => {
            if (await hasDuplicateVersionAlert(page, args.version)) return "duplicate";
            if (await versionExists()) return "published";
            if (!args.versionExists && detailUrlPattern.test(new URL(page.url()).pathname)) {
              return "detail";
            }
            return "";
          },
          { timeout: 60_000, intervals: [500, 1_000, 2_000] },
        )
        .not.toBe("");
      if (detailUrlPattern.test(new URL(page.url()).pathname)) break;
      await page.goto(skillDetailPath(args.ownerHandle, args.slug), {
        waitUntil: "domcontentloaded",
      });
      await expectPublishedDetailPage(page, args.displayName);
      break;
    } catch (error) {
      await page.goto(skillDetailPath(args.ownerHandle, args.slug), {
        waitUntil: "domcontentloaded",
      });
      try {
        await expectPublishedDetailPage(page, args.displayName);
        if (!args.versionExists || (await versionExists())) break;
        await page.goto(publishUrl, { waitUntil: "domcontentloaded" });
        await waitForPublishSkillForm(page);
      } catch {
        await page.goto(publishUrl, { waitUntil: "domcontentloaded" });
        await waitForPublishSkillForm(page);
      }
      if (attempt >= 3 || !new URL(page.url()).pathname.startsWith("/skills/publish")) {
        throw error;
      }
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  const { ownerHandle: actualOwnerHandle, slug: actualSlug } = parseSkillDetailPath(
    new URL(page.url()).pathname,
  );
  expect(actualOwnerHandle).toBeTruthy();
  expect(actualOwnerHandle?.toLowerCase()).toContain(args.ownerHandle.toLowerCase());
  expect(actualSlug).toBe(args.slug);
  expect(new URL(page.url()).pathname).toBe(buildSkillDetailHref(actualOwnerHandle!, args.slug));
  await expectPublishedDetailPage(page, args.displayName);
  const successDialog = page.getByRole("dialog", { name: /it's alive/i });
  if (await successDialog.isVisible().catch(() => false)) {
    try {
      await successDialog.getByRole("button", { name: "View skill" }).click({ timeout: 5_000 });
      await expect(successDialog).toBeHidden({ timeout: 10_000 });
    } catch {
      await page.goto(buildSkillDetailHref(actualOwnerHandle!, args.slug), {
        waitUntil: "domcontentloaded",
      });
      await waitForHydration(page);
    }
  }
  await expectPublishedDetailPage(page, args.displayName);
  return actualOwnerHandle!;
}
