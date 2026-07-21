import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import convexBrowser from "convex/browser";
import { api } from "../../convex/_generated/api";
import { buildPublisherProfileHref, buildSkillDetailHref } from "../../src/lib/ownerRoute";
import {
  buildPluginDetailHref,
  buildPluginSecurityAuditHref,
  buildPluginValidationHref,
} from "../../src/lib/pluginRoutes";
import { recoverFromTransientErrorScreen, waitForHydration } from "../helpers/runtimeErrors";

type DevPersona = "owner" | "user" | "admin" | "abusePublisher";
const WORKER_TOKEN = process.env.SECURITY_SCAN_WORKER_TOKEN ?? "local-e2e-worker-token";
const { ConvexHttpClient } = convexBrowser;

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

type LocalAuthPersona = DevPersona | "officialOrgMember";

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

async function expectPublishedDetailCurrentVersion(
  page: Page,
  args: { displayName: string; version: string },
) {
  await expectPublishedDetailPage(page, args.displayName);
  const metadata = page.locator(".detail-sidebar-stats .sidebar-metadata");
  await expect(metadata.getByText("Current version", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(metadata.getByText(`v${args.version}`, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function isPublishedDetailCurrentVersionVisible(
  page: Page,
  args: { displayName: string; version: string },
) {
  await waitForHydration(page);
  const title = page.locator(".skill-page-title");
  const metadata = page.locator(".detail-sidebar-stats .sidebar-metadata");
  return (
    (await title.textContent({ timeout: 500 }).catch(() => null)) === args.displayName &&
    (await metadata
      .getByText(`v${args.version}`, { exact: true })
      .isVisible({ timeout: 500 })
      .catch(() => false))
  );
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
  await page.getByTestId("upload-input").setInputFiles(skillDir, { timeout: 15_000 });
  await waitForPublishSkillMetadataForm(page);
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
}

async function hasDuplicateVersionAlert(page: Page, version: string) {
  const alert = page.getByRole("alert");
  const text = await alert.textContent({ timeout: 500 }).catch(() => "");
  return text?.includes(`Version ${version} already exists`) ?? false;
}

function skillDetailPath(ownerHandle: string, slug: string) {
  return buildSkillDetailHref(ownerHandle, slug);
}

export async function publishedSkillVersionExists(
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

function convexClient() {
  const convexUrl = process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("VITE_CONVEX_URL is required");
  return new ConvexHttpClient(convexUrl);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type MockPrePublicationClaim = {
  attemptId: string;
  claimId: string;
  artifactFingerprint: string;
  files?: Array<{ path: string; storageId?: string; url?: string | null }>;
};

export async function claimMockPrePublicationChecks(args: {
  kind: "skill" | "package";
  slug: string;
  version: string;
}) {
  let lastClaimError: unknown;
  let claim: MockPrePublicationClaim | null = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const claimed = (await convexClient()
      .action(api.publishAttempts.claimPrePublicationChecks, {
        token: WORKER_TOKEN,
        kind: args.kind,
        slug: args.slug,
        version: args.version,
      })
      .catch((error: unknown) => {
        lastClaimError = error;
        return null;
      })) as MockPrePublicationClaim | null;
    if (claimed) {
      claim = claimed;
      break;
    }
    await wait(Math.min(500 * attempt, 2_000));
  }
  if (!claim) {
    const detail =
      lastClaimError instanceof Error
        ? ` Last claim error: ${lastClaimError.message}`
        : lastClaimError
          ? ` Last claim error: ${String(lastClaimError)}`
          : "";
    throw new Error(
      `No pending ${args.kind} publish attempt for ${args.slug}@${args.version}.${detail}`,
    );
  }
  return claim;
}

export async function expectSingleMockPrePublicationCheckRejected(args: {
  kind: "skill" | "package";
  slug: string;
  version: string;
}) {
  const claim = await claimMockPrePublicationChecks(args);
  await expect(
    convexClient().action(api.publishAttempts.completePrePublicationChecks, {
      token: WORKER_TOKEN,
      attemptId: claim.attemptId,
      claimId: claim.claimId,
      artifactFingerprint: claim.artifactFingerprint,
      trufflehog: {
        status: "clean",
        summary: "Mock TruffleHog found no secrets in the local e2e fixture.",
      },
    } as never),
  ).rejects.toThrow();
  return claim;
}

export async function completeMockPrePublicationChecks(args: {
  kind: "skill" | "package";
  slug: string;
  version: string;
  claim?: MockPrePublicationClaim;
  trufflehog?: "clean" | "blocked";
  clawscan?: "clean" | "suspicious" | "malicious" | "failed";
}) {
  const claim = args.claim ?? (await claimMockPrePublicationChecks(args));
  const clawscan = args.clawscan ?? "clean";
  const clawscanBlocked = clawscan === "malicious";
  const clawscanFailed = clawscan === "failed";
  const clawscanAnalysis =
    clawscan === "suspicious" || clawscan === "malicious"
      ? {
          status: "completed",
          verdict: clawscan,
          confidence: "high",
          summary: `Mock ClawScan marked the local e2e fixture ${clawscan}.`,
          model: "mock-local-e2e",
          checkedAt: Date.now(),
        }
      : undefined;
  const completion = (await convexClient().action(
    api.publishAttempts.completePrePublicationChecks,
    {
      token: WORKER_TOKEN,
      attemptId: claim.attemptId,
      claimId: claim.claimId,
      artifactFingerprint: claim.artifactFingerprint,
      trufflehog: {
        status: args.trufflehog ?? "clean",
        summary:
          args.trufflehog === "blocked"
            ? "Mock TruffleHog found a redacted secret in the local e2e fixture."
            : "Mock TruffleHog found no secrets in the local e2e fixture.",
        redactedFindings: args.trufflehog === "blocked" ? ["redacted-secret"] : undefined,
      },
      clawscan: {
        status: clawscanBlocked ? "blocked" : clawscanFailed ? "failed" : "clean",
        summary: "Mock ClawScan completed for the local e2e fixture.",
        redactedFindings:
          clawscan === "suspicious" || clawscan === "malicious"
            ? [`status=completed; verdict=${clawscan}`]
            : undefined,
      },
      clawscanAnalysis,
    },
  )) as Record<string, unknown>;
  return { ...completion, claim };
}

function devPersonaHeaderPattern(persona: LocalAuthPersona, expectedHandle: string) {
  const displayName =
    persona === "owner"
      ? "Local Owner"
      : persona === "user"
        ? "Local User"
        : persona === "officialOrgMember"
          ? "Local Official Org Member"
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

function devPersonaMenuLabel(persona: LocalAuthPersona) {
  if (persona === "abusePublisher") return "abuse publisher";
  if (persona === "officialOrgMember") return "org member";
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

function devPersonaHandle(persona: LocalAuthPersona) {
  return persona === "owner"
    ? "local"
    : persona === "officialOrgMember"
      ? "local-official-member"
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

export async function expectLocalPersonaActive(page: Page, persona: LocalAuthPersona) {
  const expectedHandle = devPersonaHandle(persona);
  await expect(page.locator("header .user-trigger")).toContainText(
    devPersonaHeaderPattern(persona, expectedHandle),
    { timeout: 15_000 },
  );
}

export async function signInAsLocalPersona(page: Page, persona: LocalAuthPersona) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForHydration(page);
      await recoverFromTransientErrorScreen(page);

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
      await recoverFromTransientErrorScreen(page).catch(() => {});
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
  return await ownerControl.evaluate(
    (node) => node.tagName.toLowerCase() === "select" && node.checkVisibility(),
  );
}

async function getSelectedOwnerHandle(page: Page, selector: string) {
  const ownerControl = page.locator(selector).first();
  if (await isNativeOwnerSelect(page, selector)) {
    const value = await ownerControl.inputValue();
    if (value) return value;
  }
  // Empty publish states keep the owner control mounted but visually hidden until upload.
  const directText = (await ownerControl.textContent().catch(() => "")) ?? "";
  const directHandle = parseOwnerHandle(directText);
  if (directHandle) return directHandle;

  const visibleComboboxText = await page
    .getByRole("combobox", { name: "Publishing as" })
    .filter({ hasText: /@/ })
    .first()
    .innerText({ timeout: 500 })
    .catch(() => "");
  return parseOwnerHandle(visibleComboboxText);
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
  const heading = page.getByRole("heading", { name: /Publish(?: a skill| Skill)/ });
  const retryButton = page.getByRole("button", { name: "Try again" });
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await waitForHydration(page).catch(() => {});
    await recoverFromTransientErrorScreen(page);
    if (await heading.isVisible({ timeout: 5_000 }).catch(() => false)) {
      try {
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
  await page
    .getByTestId("upload-input")
    .waitFor({ state: "attached", timeout: 15_000 })
    .catch((error) => {
      throw lastError ?? error;
    });
}

async function waitForPublishSkillMetadataForm(page: Page) {
  const requiredControls = ["#ownerHandle", "#slug", "#displayName", "#version", "#tags"] as const;
  const rightsCheckbox = page.getByLabel(/i have the rights to publish this skill/i);
  for (const selector of requiredControls) {
    await page.locator(selector).waitFor({ state: "attached", timeout: 15_000 });
  }
  await expect(rightsCheckbox).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("upload-input").waitFor({ state: "attached", timeout: 15_000 });
}

export async function signInAsLocalPublisher(page: Page, persona: LocalAuthPersona) {
  await signInAsLocalPersona(page, persona);
  await page.goto("/skills/publish", { waitUntil: "domcontentloaded" });
  await waitForPublishSkillForm(page);
  await expect
    .poll(
      async () => {
        await recoverFromTransientErrorScreen(page);
        await waitForPublishSkillForm(page);
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
    skillMarkdown?: string;
    completeChecks?: boolean;
    expectedError?: string;
    files?: Array<{ path: string; contents: string | Uint8Array }>;
  },
) {
  const skillDir = testInfo.outputPath(`${args.slug}-${args.version}`);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    args.skillMarkdown ??
      skillMd({
        slug: args.slug,
        displayName: args.displayName,
        versionLabel: args.versionLabel,
      }),
    "utf8",
  );
  for (const file of args.files ?? []) {
    const filePath = join(skillDir, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.contents);
  }

  await waitForPublishSkillForm(page);
  const publishButton = page.getByRole("button", { name: "Publish skill" });
  const detailUrlPattern = new RegExp(`/[^/]+/(?:skills/)?${escapeRegExp(args.slug)}$`);
  const versionExists = async () =>
    args.versionExists ? await args.versionExists() : await publishedSkillVersionExists(page, args);
  type PublishState =
    | "duplicate"
    | "pending"
    | "private-detail"
    | "published"
    | "rejected"
    | "staged"
    | "";
  const readPublishState = async (): Promise<PublishState> => {
    if (await hasDuplicateVersionAlert(page, args.version)) return "duplicate";
    if (
      args.expectedError &&
      (await page
        .getByRole("alert")
        .filter({ hasText: args.expectedError })
        .isVisible({ timeout: 500 })
        .catch(() => false))
    ) {
      return "rejected";
    }
    const pathname = new URL(page.url()).pathname;
    // Staged publishes redirect to the dashboard as soon as Convex accepts the
    // upload. Treat that navigation as success instead of waiting and retrying.
    if (pathname === "/dashboard") return "staged";
    if (detailUrlPattern.test(pathname)) {
      if (await isPublishedDetailCurrentVersionVisible(page, args)) {
        return "published";
      }
      if (await versionExists()) return "staged";
      return "private-detail";
    }
    const pendingChecks = page.getByText("Running TruffleHog and ClawScan", { exact: false });
    if (await pendingChecks.isVisible({ timeout: 500 }).catch(() => false)) {
      return "pending";
    }
    if (await versionExists()) return "staged";
    return "";
  };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let publishUrl = page.url();
    try {
      await fillPublishSkillForm(page, args, skillDir);
      await expect(publishButton).toBeEnabled({ timeout: 30_000 });
      publishUrl = page.url();
      await publishButton.click({ timeout: 15_000 });
      await expect
        .poll(readPublishState, { timeout: 60_000, intervals: [500, 1_000, 2_000] })
        .not.toBe("");
      const observedPublishState = await readPublishState();
      if (observedPublishState === "rejected") {
        return args.ownerHandle;
      }
      if (observedPublishState !== "published") {
        if (args.completeChecks === false) {
          return args.ownerHandle;
        }
        await page.goto(skillDetailPath(args.ownerHandle, args.slug), {
          waitUntil: "domcontentloaded",
        });
        if (!(await isPublishedDetailCurrentVersionVisible(page, args))) {
          const completion = await completeMockPrePublicationChecks({
            kind: "skill",
            slug: args.slug,
            version: args.version,
          });
          expect((completion as { status?: unknown }).status).toBe("finalized");
        }
      }
      if (detailUrlPattern.test(new URL(page.url()).pathname)) break;
      await page.goto(skillDetailPath(args.ownerHandle, args.slug), {
        waitUntil: "domcontentloaded",
      });
      await expectPublishedDetailCurrentVersion(page, args);
      break;
    } catch (error) {
      await page.goto(skillDetailPath(args.ownerHandle, args.slug), {
        waitUntil: "domcontentloaded",
      });
      try {
        await expectPublishedDetailCurrentVersion(page, args);
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
  await expectPublishedDetailCurrentVersion(page, args);
  return actualOwnerHandle!;
}
