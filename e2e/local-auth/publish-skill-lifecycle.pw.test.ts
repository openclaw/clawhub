import { expect, type APIRequestContext, type Page, test } from "@playwright/test";
import convexBrowser from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  expectNoFatalErrorUi,
  expectNoRuntimeErrors,
  trackRuntimeErrors,
  waitForHydration,
} from "../helpers/runtimeErrors";
import {
  completeMockPrePublicationChecks,
  expectOwnerHandleSelected,
  publishedSkillVersionExists,
  publishSkillVersion,
  signInAsLocalPublisher,
  skillMd,
} from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth lifecycle tests require the local dev auth runner",
);

test.setTimeout(600_000);

const WORKER_TOKEN = process.env.SECURITY_SCAN_WORKER_TOKEN ?? "local-e2e-worker-token";
const JOB_WAIT_TIMEOUT_MS = 90_000;
const { ConvexHttpClient } = convexBrowser;
type ConvexHttpClientInstance = InstanceType<typeof ConvexHttpClient>;

type ClaimedScanJob = {
  job: { _id: Id<"securityScanJobs">; leaseToken: string };
  target?: { skill?: { slug?: string }; version?: { version?: string } };
};

type ClaimedSkillCardJob = {
  job: { _id: Id<"skillCardGenerationJobs">; leaseToken: string };
  target?: { skill?: { slug?: string }; version?: { version?: string } };
};

function convexClient() {
  const convexUrl = process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("VITE_CONVEX_URL is required");
  return new ConvexHttpClient(convexUrl);
}

function convexSiteUrl() {
  const url = process.env.VITE_CONVEX_SITE_URL;
  if (!url) throw new Error("VITE_CONVEX_SITE_URL is required");
  return url.replace(/\/$/u, "");
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function expectHealthyPublishPage(page: Page, errors: string[]) {
  const expectedTransientTimeouts = [
    "CONVEX Q(users:me)",
    "CONVEX Q(publishers:getMyProfileHandle)",
    "CONVEX Q(publishers:listMine)",
    "CONVEX Q(skills:checkSlugAvailability)",
    "CONVEX Q(skills:getBySlug)",
    "CONVEX Q(skills:getBySlugForStaff)",
    "CONVEX Q(skills:getActivityTrendForSlug)",
    "CONVEX Q(skills:list)",
    "CONVEX Q(skills:listVersions)",
    "CONVEX A(skills:publishVersion)",
    "CONVEX M(securityScan:enqueueSkillVersionScanInternal)",
    "CONVEX M(skillCards:enqueueForVersionInternal)",
  ];
  await expectNoFatalErrorUi(page);
  await expectNoRuntimeErrors(
    page,
    errors.filter(
      (error) =>
        !(
          error.includes("Function execution timed out (maximum duration: 1s)") &&
          expectedTransientTimeouts.some((functionName) => error.includes(functionName))
        ),
    ),
  );
}

async function expectCurrentVersion(page: Page, version: string) {
  const detailUrl = page.url().split("#", 1)[0];
  const expectedVersion = `v${version}`;

  await expect
    .poll(
      async () => {
        await waitForHydration(page).catch(() => {});
        const metadata = page.locator(".detail-sidebar-stats .sidebar-metadata");
        const text = await metadata.innerText({ timeout: 3_000 }).catch(() => "");
        if (text.includes("Current version") && text.includes(expectedVersion)) {
          return expectedVersion;
        }
        await page.goto(detailUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
        return text;
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(expectedVersion);
}

function isConvexTimeout(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Function execution timed out");
}

async function waitForClaimedScanJob(client: ConvexHttpClientInstance, slug: string) {
  const deadline = Date.now() + JOB_WAIT_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const jobs = (await client.action(api.securityScan.claimCodexScanJobs, {
        token: WORKER_TOKEN,
        workerId: `pw-skill-card-${slug}`,
        limit: 20,
        leaseMs: 60_000,
      })) as ClaimedScanJob[];
      const match = jobs.find((job) => job.target?.skill?.slug === slug);
      if (match) return match;
    } catch (error) {
      if (!isConvexTimeout(error)) throw error;
      lastError = error;
    }
    await sleep(500);
  }
  if (lastError) throw lastError;
  throw new Error(`Timed out waiting for security scan job for ${slug}`);
}

async function waitForClaimedSkillCardJob(client: ConvexHttpClientInstance, slug: string) {
  const deadline = Date.now() + JOB_WAIT_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const jobs = (await client.action(api.skillCards.claimSkillCardJobs, {
        token: WORKER_TOKEN,
        workerId: `pw-skill-card-${slug}`,
        limit: 20,
        leaseMs: 60_000,
      })) as ClaimedSkillCardJob[];
      const match = jobs.find((job) => job.target?.skill?.slug === slug);
      if (match) return match;
    } catch (error) {
      if (!isConvexTimeout(error)) throw error;
      lastError = error;
    }
    await sleep(500);
  }
  if (lastError) throw lastError;
  throw new Error(`Timed out waiting for Skill Card generation job for ${slug}`);
}

async function waitForSkillCardEndpoint(page: Page, slug: string, markdown: string) {
  const url = `${convexSiteUrl()}/api/v1/skills/${slug}/card`;
  const deadline = Date.now() + JOB_WAIT_TIMEOUT_MS;
  let lastStatus = 0;
  let lastText = "";
  while (Date.now() < deadline) {
    const response = await page.request.get(url);
    lastStatus = response.status();
    lastText = await response.text();
    if (lastStatus === 200 && lastText === markdown) return response;
    await sleep(500);
  }
  throw new Error(
    `Timed out waiting for Skill Card endpoint for ${slug}; last status=${lastStatus} body=${lastText.slice(
      0,
      120,
    )}`,
  );
}

async function publicSkillVersionExists(
  request: APIRequestContext,
  args: {
    ownerHandle: string;
    slug: string;
    version: string;
  },
) {
  const url = `${convexSiteUrl()}/api/v1/skills/${encodeURIComponent(args.slug)}/versions/${encodeURIComponent(
    args.version,
  )}?ownerHandle=${encodeURIComponent(args.ownerHandle)}`;
  const response = await request.get(url, { timeout: 2_000 }).catch(() => null);
  if (!response?.ok()) return false;
  const body = (await response.json().catch(() => null)) as {
    version?: { version?: unknown };
  } | null;
  return body?.version?.version === args.version;
}

async function completeScanJob(
  client: ConvexHttpClientInstance,
  scanJob: ClaimedScanJob,
  llmAnalysis: {
    status: "clean";
    verdict: "benign";
    confidence: "high";
    summary: string;
    guidance: string;
    model: string;
    checkedAt: number;
  },
) {
  const args = {
    token: WORKER_TOKEN,
    jobId: scanJob.job._id,
    leaseToken: scanJob.job.leaseToken,
    runId: "playwright-local-auth",
    llmAnalysis,
  };

  let sawTimeout = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await client.action(api.securityScan.completeCodexScanJob, args);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        sawTimeout &&
        (message.includes("Lease mismatch") || message.includes("Unsupported security scan target"))
      ) {
        return;
      }
      if (!isConvexTimeout(error) || attempt >= 3) throw error;
      sawTimeout = true;
      await sleep(1_000 * attempt);
    }
  }
}

test("publishing a skill queues scan, queues skill-card generation, and shows the generated card", async ({
  page,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);
  const client = convexClient();
  const slug = `pw-card-${Date.now().toString(36)}`;
  const displayName = "Playwright Skill Card Skill";

  const ownerHandle = await signInAsLocalPublisher(page, "admin");
  await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName,
    version: "1.0.0",
    versionLabel: "skill card release",
    changelog: "Initial release for the generated Skill Card lifecycle.",
  });

  const scanJob = await waitForClaimedScanJob(client, slug);
  expect(scanJob.target?.version?.version).toBe("1.0.0");

  await completeScanJob(client, scanJob, {
    status: "clean",
    verdict: "benign",
    confidence: "high",
    summary: "No suspicious behavior in the local Playwright fixture.",
    guidance: "Fixture is safe for local e2e validation.",
    model: "mock-local-e2e",
    checkedAt: Date.now(),
  });

  const cardJob = await waitForClaimedSkillCardJob(client, slug);
  expect(cardJob.target?.version?.version).toBe("1.0.0");

  const markdown = [
    "# Skill Card",
    "",
    `Skill: ${displayName}`,
    "",
    "Generated by the local Playwright worker harness.",
  ].join("\n");
  await client.action(api.skillCards.completeSkillCardJob, {
    token: WORKER_TOKEN,
    jobId: cardJob.job._id,
    leaseToken: cardJob.job.leaseToken,
    runId: "playwright-local-auth",
    markdown,
  });

  const cardResponse = await waitForSkillCardEndpoint(page, slug, markdown);

  const detailUrl = page.url().split("#", 1)[0];
  await page.goto(`${detailUrl}#skill-card`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  const skillCardTab = page.getByRole("tab", { name: "Skill Card" });
  await expect(skillCardTab).toHaveAttribute("aria-selected", "true", {
    timeout: 30_000,
  });
  const skillCardPanel = page.locator(".tab-body", {
    hasText: "Skill Cards follow",
  });
  await expect(skillCardPanel).toContainText("Generated by the local Playwright worker harness.", {
    timeout: 30_000,
  });
  await expect(skillCardPanel).toContainText("Skill Card");

  expect(await cardResponse.text()).toBe(markdown);

  await expectHealthyPublishPage(page, errors);
});

test("mocked TruffleHog blocks a secret-positive skill upload until the secret is removed", async ({
  page,
  request,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);
  const slug = `pw-secret-${Date.now().toString(36)}`;
  const displayName = "Playwright Secret Block Skill";
  const ownerHandle = await signInAsLocalPublisher(page, "admin");
  const version = "1.0.0";
  const secretMarkdown = `${skillMd({
    slug,
    displayName,
    versionLabel: "secret-positive release",
  })}

## Local secret fixture

This fake token is intentionally redacted by the mocked TruffleHog worker:
OPENAI_API_KEY=sk-local-e2e-redacted-secret-not-real
`;

  await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName,
    version,
    versionLabel: "secret-positive release",
    changelog: "Secret-positive release should remain private.",
    skillMarkdown: secretMarkdown,
    completeChecks: false,
  });

  await completeMockPrePublicationChecks({
    kind: "skill",
    slug,
    version,
    trufflehog: "blocked",
  });

  await expect(await publicSkillVersionExists(request, { ownerHandle, slug, version })).toBe(false);
  await expect(await publishedSkillVersionExists(page, { ownerHandle, slug, version })).toBe(false);

  await page.goto("/skills/publish", { waitUntil: "domcontentloaded" });
  await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName,
    version,
    versionLabel: "clean retry release",
    changelog: "Clean retry after removing the secret.",
    skillMarkdown: skillMd({
      slug,
      displayName,
      versionLabel: "clean retry release",
    }),
  });

  await expectCurrentVersion(page, version);
  await expectHealthyPublishPage(page, errors);
});

test("skill publishers can create a skill and publish a new version", async ({
  page,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);
  const slug = `pw-life-${Date.now().toString(36)}`;
  const displayName = "Playwright Lifecycle Skill";

  let ownerHandle = await signInAsLocalPublisher(page, "admin");

  ownerHandle = await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName,
    version: "1.0.0",
    versionLabel: "first release",
    changelog: "Initial release from the browser publish flow.",
  });

  await expectCurrentVersion(page, "1.0.0");

  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  const newVersionHref = await page.getByRole("link", { name: "New version" }).getAttribute("href");
  expect(newVersionHref).toBeTruthy();
  await page.goto(newVersionHref!, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/\/skills\/publish\?updateSlug=/);
  await expect(page.locator("#slug")).toHaveValue(slug);
  await expect(page.locator("#displayName")).toHaveValue(displayName);
  await expect(page.locator("#version")).toHaveValue("1.0.1");
  await expectOwnerHandleSelected(page, "#ownerHandle", ownerHandle);

  await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName,
    version: "1.0.1",
    versionLabel: "second release",
    changelog: "Second release published through the owner new-version workflow.",
  });

  await expectCurrentVersion(page, "1.0.1");
  await page.getByRole("tab", { name: "Versions" }).click();
  await expect(page.getByRole("heading", { name: "Versions" })).toBeVisible();
  await expect(page.getByText(/^v1\.0\.1\b/).first()).toBeVisible();
  await expect(page.getByText(/^v1\.0\.0\b/).first()).toBeVisible();

  await expectHealthyPublishPage(page, errors);
});
