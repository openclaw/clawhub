import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page, test } from "@playwright/test";
import convexBrowser from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { parseArk } from "../../packages/schema/src/ark";
import { ApiV1SkillListResponseSchema } from "../../packages/schema/src/schemas";
import {
  expectNoFatalErrorUi,
  expectNoRuntimeErrors,
  trackRuntimeErrors,
  waitForHydration,
  withoutRecoverableReactHydrationErrors,
} from "../helpers/runtimeErrors";
import {
  completeMockPrePublicationChecks,
  claimMockPrePublicationChecks,
  expectOwnerHandleSelected,
  publishedSkillVersionExists,
  publishSkillVersion,
  signInAsLocalPublisher,
  skillMd,
} from "./helpers";
import { proveSkillCardReuse } from "./skill-card-reuse";

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
  target?: { skill?: { slug?: string }; version?: { _id: Id<"skillVersions">; version?: string } };
};

type PrePublicationSkillAttemptState = {
  ok: true;
  attemptExists: boolean;
  attempt?: {
    status: string;
    slug: string;
    version: string;
    filesCount: number;
    hasSkillInsertArgs: boolean;
    hasFollowup: boolean;
    trufflehogStatus: string;
    trufflehogRedactedFindingCount: number;
    clawscanStatus: string;
    blockedAt: number | null;
  };
  skillExists: boolean;
  skillLatestVersionId: string | null;
  versionExists: boolean;
  versionPublicationStatus: string | null;
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

function getPrePublicationSkillAttemptState(attemptId: string) {
  return runDevSeed<PrePublicationSkillAttemptState>("devSeed:getPrePublicationSkillAttemptState", {
    attemptId,
  });
}

function readLocalStorageIds() {
  const result = spawnSync(
    "bunx",
    [
      "convex",
      "run",
      "--inline-query",
      '({ ids: (await ctx.db.system.query("_storage").collect()).map((blob) => blob._id).sort() })',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, CONVEX_DEPLOYMENT: localConvexDeployment() },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to inspect local storage: ${result.stderr}`);
  }
  return (JSON.parse(extractLastJsonObject(result.stdout)) as { ids: string[] }).ids;
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
    withoutRecoverableReactHydrationErrors(errors).filter(
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
    aigAnalysis: {
      status: "clean" as const,
      issueCount: 0,
      findings: [],
      scannerVersion: "mock-local-e2e",
      summary: "Mock A.I.G found no issues in the local e2e fixture.",
      checkedAt: llmAnalysis.checkedAt,
    },
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
  const storageBeforeRejectedCard = readLocalStorageIds();
  await expect(
    client.action(api.skillCards.completeSkillCardJob, {
      token: WORKER_TOKEN,
      jobId: cardJob.job._id,
      leaseToken: "stale-local-card-lease",
      markdown,
    }),
  ).rejects.toThrow(/Lease mismatch/);
  expect(readLocalStorageIds()).toEqual(storageBeforeRejectedCard);

  await client.action(api.skillCards.completeSkillCardJob, {
    token: WORKER_TOKEN,
    jobId: cardJob.job._id,
    leaseToken: cardJob.job.leaseToken,
    runId: "playwright-local-auth",
    markdown,
  });
  expect(readLocalStorageIds()).toHaveLength(storageBeforeRejectedCard.length + 1);

  const cardResponse = await waitForSkillCardEndpoint(page, slug, markdown);
  const catalogResponse = await page.request.get(
    `${convexSiteUrl()}/api/v1/skills?prefix=${encodeURIComponent(slug)}&limit=1`,
  );
  expect(catalogResponse.status()).toBe(200);
  const catalog = parseArk(
    ApiV1SkillListResponseSchema,
    await catalogResponse.json(),
    "published skill catalog",
  );
  expect(catalog.items).toHaveLength(1);
  expect(catalog.items[0]).toMatchObject({
    ownerHandle,
    slug,
    latestVersion: { version: "1.0.0" },
  });

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

  await proveSkillCardReuse(
    client,
    cardJob.target!.version!._id,
    WORKER_TOKEN,
    readLocalStorageIds,
  );

  await expectHealthyPublishPage(page, errors);
});

async function capturePublicationState(
  page: Page,
  testInfo: { outputPath: (file: string) => string },
  state: string,
  expectedTitle: string,
) {
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["laptop", { width: 1366, height: 768 }],
    ["tablet", { width: 768, height: 1024 }],
    ["mobile", { width: 390, height: 844 }],
  ] as const) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("link", { name: "New version", exact: true })).toBeVisible();
    if (process.env.CLAWHUB_OWNER_PUBLICATION_BASELINE !== "1") {
      await expect(page.getByText(expectedTitle, { exact: true })).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${state}-${name}.png`), fullPage: true });
  }
}

test("owner sees failed publication checks while the version stays private", async ({
  page,
  request,
}, testInfo) => {
  const slug = "pw-owner-publication-check-failure";
  const version = "1.0.0";
  const ownerHandle = await signInAsLocalPublisher(page, "user");
  await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName: "Local Owner Publication Failure",
    version,
    versionLabel: "operational scanner failure",
    changelog: "Owner can distinguish a failed check from an active scan.",
    completeChecks: false,
  });
  await page.goto(`/${ownerHandle}/${slug}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByText("Pending publication", { exact: true })).toBeVisible();
  await capturePublicationState(page, testInfo, "owner-checks-pending", "Pending publication");
  const completed = await completeMockPrePublicationChecks({
    kind: "skill",
    slug,
    version,
    clawscan: "failed",
  });
  expect(completed).toMatchObject({ status: "pending_checks" });
  expect(await publicSkillVersionExists(request, { ownerHandle, slug, version })).toBe(false);
  await page.goto(`/${ownerHandle}/${slug}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.locator("h1.skill-page-title")).toHaveText("Local Owner Publication Failure");
  await capturePublicationState(page, testInfo, "owner-checks-failed", "Publication checks failed");
  await expect(page.getByText("Publication checks failed", { exact: true })).toBeVisible();
  await expect(page.getByText(/not yet public or installable/i)).toBeVisible();
  await expect(page.getByRole("article", { name: "Install" })).toHaveCount(0);
});

test.describe("owner publication progress after a clean public release", () => {
  for (const outcome of ["failed", "incomplete"] as const) {
    test(`owner sees ${outcome} checks on a newer version`, async ({ page, request }, testInfo) => {
      const slug = `pw-owner-update-${outcome}`;
      const displayName = "Local Owner Public Release";
      const ownerHandle = await signInAsLocalPublisher(page, "user");
      const client = convexClient();
      const cleanAnalysis = {
        status: "completed",
        verdict: "clean",
        confidence: "high",
        summary: "Local fixture completed review.",
        model: "mock-local-e2e",
        checkedAt: Date.now(),
      };
      const aigAnalysis = {
        status: "clean",
        issueCount: 0,
        findings: [],
        scannerVersion: "mock-local-e2e",
        checkedAt: Date.now(),
      };
      const check = { status: "clean" as const };
      await publishSkillVersion(page, testInfo, {
        ownerHandle,
        slug,
        displayName,
        version: "1.0.0",
        versionLabel: "public clean baseline",
        changelog: "Public baseline.",
        completeChecks: false,
      });
      const first = await claimMockPrePublicationChecks({ kind: "skill", slug, version: "1.0.0" });
      const published = (await client.action(api.publishAttempts.completePrePublicationChecks, {
        token: WORKER_TOKEN,
        attemptId: first.attemptId as Id<"publishAttempts">,
        claimId: first.claimId,
        artifactFingerprint: first.artifactFingerprint,
        trufflehog: check,
        clawscan: check,
        clawscanAnalysis: cleanAnalysis,
        aigAnalysis,
      })) as { status: string };
      expect(published.status).toBe("finalized");
      const version =
        "2.0.0-beta.owner-publication-progress-with-required-security-evidence-and-a-retained-private-candidate";
      await page.goto("/skills/publish", { waitUntil: "domcontentloaded" });
      await publishSkillVersion(page, testInfo, {
        ownerHandle,
        slug,
        displayName,
        version,
        versionLabel: `new ${outcome} checks`,
        changelog: "New version stays private.",
        completeChecks: false,
      });
      const next = await claimMockPrePublicationChecks({ kind: "skill", slug, version });
      const completed = (await client.action(api.publishAttempts.completePrePublicationChecks, {
        token: WORKER_TOKEN,
        attemptId: next.attemptId as Id<"publishAttempts">,
        claimId: next.claimId,
        artifactFingerprint: next.artifactFingerprint,
        trufflehog: check,
        clawscan: { status: outcome === "failed" ? "failed" : "clean" },
        ...(outcome === "failed" ? { aigAnalysis } : { clawscanAnalysis: cleanAnalysis }),
      })) as { status: string };
      expect(completed.status).toBe("pending_checks");
      expect(await publicSkillVersionExists(request, { ownerHandle, slug, version: "1.0.0" })).toBe(
        true,
      );
      expect(await publicSkillVersionExists(request, { ownerHandle, slug, version })).toBe(false);
      await page.goto(`/${ownerHandle}/${slug}`, { waitUntil: "domcontentloaded" });
      await waitForHydration(page);
      await expect(page.locator("h1.skill-page-title")).toHaveText(displayName);
      await capturePublicationState(
        page,
        testInfo,
        `owner-update-${outcome}`,
        `Publication checks ${outcome}`,
      );
      await expect(page.getByText(`Publication checks ${outcome}`, { exact: true })).toBeVisible();
      await expect(page.getByRole("status")).toContainText("current public version, 1.0.0");
    });
  }
});

test("owner sees failed publication status over HTTP and the built CLI", async ({
  request,
}, testInfo) => {
  const built = spawnSync("bun", ["run", "--cwd", "packages/clawhub", "build"], {
    encoding: "utf8",
    timeout: 120_000,
  });
  expect(built.status, built.stderr).toBe(0);
  const fixture = runDevSeed<{ user: { handle: string; token: string } }>(
    "devSeed:seedCliRoleHelpFixtures",
    {},
  );
  const root = await mkdtemp(join(tmpdir(), "clawhub-owner-status-"));
  const registry = convexSiteUrl();
  const slug = "pw-owner-cli-status";
  const version = "1.0.0";
  const ownerHandle = fixture.user.handle;
  const configPath = join(root, "config.json");
  const parseJson = (value: string): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      return { error: value.trim() };
    }
  };
  const runCli = (args: string[]) =>
    spawnSync(
      process.execPath,
      [
        "packages/clawhub/bin/clawdhub.js",
        "--site",
        registry,
        "--registry",
        registry,
        "--workdir",
        root,
        ...args,
      ],
      {
        encoding: "utf8",
        timeout: 120_000,
        env: {
          ...process.env,
          CLAWHUB_CONFIG_PATH: configPath,
          CLAWHUB_DISABLE_TELEMETRY: "1",
        },
      },
    );
  try {
    await writeFile(configPath, JSON.stringify({ registry, token: fixture.user.token }), {
      mode: 0o600,
    });
    const skillDir = join(root, slug);
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      skillMd({
        slug,
        displayName: "Owner CLI Status",
        versionLabel: "retained operational failure",
      }),
    );
    const publish = runCli([
      "publish",
      skillDir,
      "--slug",
      slug,
      "--name",
      "Owner CLI Status",
      "--version",
      version,
      "--changelog",
      "Verify exact owner diagnostics for a retained failed upload.",
    ]);
    expect(publish.status, publish.stderr).toBe(0);
    await completeMockPrePublicationChecks({ kind: "skill", slug, version, clawscan: "failed" });

    const path = `${registry}/api/v1/skills/${slug}/versions/${version}/publication?ownerHandle=${ownerHandle}`;
    const ownerStatus = await request.get(path, {
      headers: { Authorization: `Bearer ${fixture.user.token}` },
    });
    const statusBody = parseJson(await ownerStatus.text());
    const anonymous = await request.get(path);
    const publicVersion = await request.get(path.replace("/publication?", "?"));
    const publicDownload = await request.get(
      `${registry}/api/v1/download?slug=${slug}&version=${version}&ownerHandle=${ownerHandle}`,
    );

    const inspectArgs = ["inspect", `@${ownerHandle}/${slug}`, "--version", version];
    const json = runCli([...inspectArgs, "--json"]);
    const cliBody = parseJson(json.stdout);
    const text = runCli(inspectArgs);
    const file = runCli([...inspectArgs, "--file", "SKILL.md", "--json"]);
    await writeFile(
      testInfo.outputPath("owner-publication-cli-proof.json"),
      JSON.stringify(
        {
          httpStatus: ownerStatus.status(),
          response: statusBody,
          anonymousStatus: anonymous.status(),
          publicVersionStatus: publicVersion.status(),
          publicDownloadStatus: publicDownload.status(),
          cliExit: json.status,
          cli: cliBody,
          cliStderr: json.stderr,
          fileExit: file.status,
        },
        null,
        2,
      ),
    );
    await writeFile(
      testInfo.outputPath("owner-publication-cli-proof.txt"),
      text.stdout || text.stderr,
    );

    expect(ownerStatus.status()).toBe(200);
    expect(statusBody).toMatchObject({
      publication: { version, stage: "checks_failed", retrying: true },
    });
    expect(ownerStatus.headers()["cache-control"]).toBe("private, no-store");
    expect(anonymous.status()).toBe(401);
    expect(publicVersion.status()).toBe(404);
    expect(publicDownload.status()).toBe(404);
    expect(json.status, json.stderr).toBe(0);
    expect(cliBody).toMatchObject({
      publication: { version, stage: "checks_failed", retrying: true },
      version: null,
      file: null,
    });
    expect(text.status, text.stderr).toBe(0);
    expect(text.stdout).toContain("Publication checks failed");
    expect(text.stdout).toContain("not public or installable");
    expect(text.stdout).toContain("you do not need a new version");
    expect(text.stdout).toContain("clawhub scan download");

    expect(file.status).toBe(1);
    expect(JSON.parse(file.stdout)).toMatchObject({
      publication: { stage: "checks_failed" },
      file: null,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clean skill publish stays private until TruffleHog and ClawScan pass", async ({
  page,
  request,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);
  const slug = `pw-staged-skill-${Date.now().toString(36)}`;
  const displayName = "Playwright Staged Clean Skill";
  const version = "1.0.0";
  const ownerHandle = await signInAsLocalPublisher(page, "admin");

  await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName,
    version,
    versionLabel: "clean staged release",
    changelog: "Clean release should wait for both scanners.",
    completeChecks: false,
  });

  await expect(await publicSkillVersionExists(request, { ownerHandle, slug, version })).toBe(false);
  await expect(await publishedSkillVersionExists(page, { ownerHandle, slug, version })).toBe(false);

  await page.goto(`/${ownerHandle}/${slug}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.locator("h1.skill-page-title", { hasText: displayName })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Pending publication", { exact: true })).toBeVisible();
  await expect(page.getByText(/not yet public or installable/i)).toBeVisible();
  await expect(page.getByText("Files pending security checks")).toBeVisible();
  await expect(page.getByRole("article", { name: "Install" })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("owner-pending-publication.png"),
    fullPage: true,
  });

  const result = (await completeMockPrePublicationChecks({
    kind: "skill",
    slug,
    version,
  })) as { status?: string; result?: { versionId?: string } };
  expect(result.status).toBe("finalized");
  await expect
    .poll(() => publicSkillVersionExists(request, { ownerHandle, slug, version }), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(true);

  await page.goto(`/${ownerHandle}/${slug}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.locator("h1.skill-page-title", { hasText: displayName })).toBeVisible({
    timeout: 30_000,
  });
  await expectCurrentVersion(page, version);
  await expectHealthyPublishPage(page, errors);
});

test("mocked TruffleHog deletes a secret-positive pending skill upload before it becomes public", async ({
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
LOCAL_E2E_SECRET_MARKER=redacted-secret-marker-not-real
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

  const blocked = (await completeMockPrePublicationChecks({
    kind: "skill",
    slug,
    version,
    trufflehog: "blocked",
  })) as {
    status?: string;
    claim?: {
      attemptId: string;
      files?: Array<{ url?: string | null }>;
    };
  };
  expect(blocked.status).toBe("blocked");

  await expect(await publicSkillVersionExists(request, { ownerHandle, slug, version })).toBe(false);
  await expect(await publishedSkillVersionExists(page, { ownerHandle, slug, version })).toBe(false);

  const attemptId = blocked.claim?.attemptId;
  expect(attemptId).toBeTruthy();
  const uploadedFileUrls =
    blocked.claim?.files
      ?.map((file) => file.url)
      .filter((url): url is string => typeof url === "string" && url.length > 0) ?? [];
  expect(uploadedFileUrls.length).toBeGreaterThan(0);

  await expect
    .poll(() => getPrePublicationSkillAttemptState(attemptId!), {
      timeout: 30_000,
      intervals: [500, 1_000, 2_000],
    })
    .toEqual(
      expect.objectContaining({
        attemptExists: true,
        attempt: expect.objectContaining({
          status: "blocked",
          slug,
          version,
          filesCount: 0,
          hasSkillInsertArgs: false,
          hasFollowup: false,
          trufflehogStatus: "blocked",
          trufflehogRedactedFindingCount: 1,
          clawscanStatus: "clean",
        }),
        skillExists: false,
        versionExists: false,
      }),
    );

  for (const url of uploadedFileUrls) {
    await expect
      .poll(
        async () => {
          const response = await request.get(url, { timeout: 2_000 }).catch(() => null);
          return response?.ok() ?? false;
        },
        { timeout: 30_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(false);
  }

  await expectHealthyPublishPage(page, errors);
});

test("suspicious ClawScan verdict publishes the skill with review metadata", async ({
  page,
  request,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);
  const slug = `pw-suspicious-${Date.now().toString(36)}`;
  const displayName = "Playwright Suspicious Review Skill";
  const version = "1.0.0";
  const ownerHandle = await signInAsLocalPublisher(page, "admin");

  await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName,
    version,
    versionLabel: "suspicious review release",
    changelog: "Suspicious review result should remain public and flagged.",
    completeChecks: false,
  });

  const result = (await completeMockPrePublicationChecks({
    kind: "skill",
    slug,
    version,
    clawscan: "suspicious",
  })) as { status?: string };
  expect(result.status).toBe("finalized");
  await expect
    .poll(() => publicSkillVersionExists(request, { ownerHandle, slug, version }), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(true);

  await page.goto(`/${ownerHandle}/${slug}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.locator("h1.skill-page-title", { hasText: displayName })).toBeVisible({
    timeout: 30_000,
  });
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
    files: [
      {
        path: "main.tf",
        contents: 'resource "null_resource" "demo" {}\n',
      },
      {
        path: "terraform.tfvars",
        contents: 'region = "us-east-1"\n',
      },
      {
        path: "assets/payload.bin",
        contents: Uint8Array.from([0, 1, 2, 255]),
      },
    ],
  });

  await expectCurrentVersion(page, "1.0.1");
  await page.getByRole("tab", { name: "Files" }).click();
  await expect(page.getByRole("button", { name: /main\.tf/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /terraform\.tfvars/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /assets\/payload\.bin/i })).toBeVisible();

  await page.getByRole("button", { name: /main\.tf/i }).click();
  await expect(page.locator("pre.file-viewer-code")).toContainText(
    'resource "null_resource" "demo" {}',
  );
  await page.getByRole("button", { name: "Back to file list" }).click();

  await page.getByRole("button", { name: /assets\/payload\.bin/i }).click();
  await expect(
    page.getByText("This file is available to download but cannot be previewed as text."),
  ).toBeVisible();
  const downloadLink = page.getByRole("link", { name: "Download payload.bin" });
  const downloadHref = await downloadLink.getAttribute("href");
  expect(downloadHref).toContain(
    `/api/v1/skills/${slug}/file?path=assets%2Fpayload.bin&ownerHandle=${ownerHandle}`,
  );

  const rawResponse = await page.request.get(
    `${convexSiteUrl()}/api/v1/skills/${slug}/file?path=assets%2Fpayload.bin&ownerHandle=${ownerHandle}`,
  );
  expect(rawResponse.status()).toBe(200);
  expect(new Uint8Array(await rawResponse.body())).toEqual(Uint8Array.from([0, 1, 2, 255]));
  expect(rawResponse.headers()["content-disposition"]).toContain("attachment");
  expect(rawResponse.headers()["x-content-type-options"]).toBe("nosniff");
  await page.screenshot({
    path: testInfo.outputPath("mixed-skill-files.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Back to file list" }).click();
  await page.getByRole("tab", { name: "Versions" }).click();
  await expect(page.getByRole("heading", { name: "Versions" })).toBeVisible();
  await expect(page.getByText(/^v1\.0\.1\b/).first()).toBeVisible();
  await expect(page.getByText(/^v1\.0\.0\b/).first()).toBeVisible();

  await expectHealthyPublishPage(page, errors);
});
