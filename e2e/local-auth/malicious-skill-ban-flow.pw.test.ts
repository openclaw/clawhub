import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import convexBrowser from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "../helpers/runtimeErrors";
import { publishSkillVersion, signInAsLocalPublisher } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "malicious skill ban flow requires the local dev auth runner",
);
test.setTimeout(360_000);
test.describe.configure({ retries: 0 });

const WORKER_TOKEN = process.env.SECURITY_SCAN_WORKER_TOKEN ?? "local-e2e-worker-token";
const { ConvexHttpClient } = convexBrowser;
type ConvexHttpClientInstance = InstanceType<typeof ConvexHttpClient>;

type ClaimedScanJob = {
  job: { _id: Id<"securityScanJobs">; leaseToken: string };
  target?: { skill?: { slug?: string }; version?: { version?: string } };
};

type CapturedEmail = {
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  capturedAt: number;
};

const ACCOUNT_SUSPENDED_SUBJECT = "Your ClawHub account has been suspended";

function convexClient() {
  const convexUrl = process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("VITE_CONVEX_URL is required");
  return new ConvexHttpClient(convexUrl);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCapturedEmails() {
  const captureFile = process.env.CLAWHUB_EMAIL_CAPTURE_FILE;
  if (!captureFile) throw new Error("CLAWHUB_EMAIL_CAPTURE_FILE is required");
  if (!existsSync(captureFile)) return [];
  const raw = await readFile(captureFile, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedEmail);
}

async function waitForCapturedEmails(predicate: (emails: CapturedEmail[]) => boolean) {
  const deadline = Date.now() + 20_000;
  let latest: CapturedEmail[] = [];
  while (Date.now() < deadline) {
    latest = await readCapturedEmails();
    if (predicate(latest)) return latest;
    await sleep(500);
  }
  throw new Error(
    `Timed out waiting for captured emails. Saw: ${latest
      .map((email) => email.subject)
      .join(", ")}`,
  );
}

async function waitForClaimedScanJob(
  client: ConvexHttpClientInstance,
  slug: string,
  version: string,
) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const jobs = (await client.action(api.securityScan.claimCodexScanJobs, {
      token: WORKER_TOKEN,
      workerId: `pw-malicious-skill-${slug}-${version}`,
      limit: 20,
      leaseMs: 60_000,
    })) as ClaimedScanJob[];
    const match = jobs.find(
      (job) => job.target?.skill?.slug === slug && job.target?.version?.version === version,
    );
    if (match) return match;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for security scan job for ${slug}@${version}`);
}

async function completeScan(
  client: ConvexHttpClientInstance,
  args: { slug: string; version: string; verdict: "benign" | "malicious" },
) {
  const scanJob = await waitForClaimedScanJob(client, args.slug, args.version);
  const malicious = args.verdict === "malicious";
  await client.action(api.securityScan.completeCodexScanJob, {
    token: WORKER_TOKEN,
    jobId: scanJob.job._id,
    leaseToken: scanJob.job.leaseToken,
    runId: "playwright-local-auth",
    llmAnalysis: {
      status: malicious ? "malicious" : "clean",
      verdict: args.verdict,
      confidence: "high",
      summary: malicious
        ? "Synthetic local e2e malicious verdict."
        : "Synthetic local e2e clean verdict.",
      guidance: malicious
        ? "Synthetic local e2e blocked upload."
        : "Synthetic local e2e clean upload.",
      model: "mock-local-e2e",
      checkedAt: Date.now(),
    },
  });
}

async function expectCurrentVersion(page: import("@playwright/test").Page, version: string) {
  const metadata = page.locator(".detail-sidebar-stats .sidebar-metadata");
  await expect(metadata.getByText("Current version", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(metadata.getByText(`v${version}`, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

function withoutExpectedBannedSessionTeardownErrors(errors: string[]) {
  const timedOutDuringBannedSessionTeardown = [
    "CONVEX Q(skills:listVersions)",
    "CONVEX Q(skills:list)",
    "CONVEX Q(skills:checkSlugAvailability)",
    "CONVEX Q(users:me)",
    "CONVEX Q(publishers:listMine)",
    "CONVEX Q(publishers:getMyProfileHandle)",
    "CONVEX M(packages:applyBanToOwnedPackagesBatchInternal)",
  ];
  return errors.filter(
    (error) =>
      !(error.includes("CONVEX M(users:ensure)") && error.includes("User not found")) &&
      !(
        error.includes("Function execution timed out (maximum duration: 1s)") &&
        timedOutDuringBannedSessionTeardown.some((functionName) => error.includes(functionName))
      ),
  );
}

test("malicious skill retries keep the clean latest visible, email the publisher, and ban on third rejection", async ({
  page,
}, testInfo) => {
  await page.route("https://openclaw.ai/**", (route) => route.fulfill({ status: 204 }));
  const errors = trackRuntimeErrors(page);
  const client = convexClient();
  const slug = `pw-malware-${Date.now().toString(36)}`;
  const displayName = "Playwright Malicious Skill Flow";

  const ownerHandle = await signInAsLocalPublisher(page, "abusePublisher");
  await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName,
    version: "1.0.0",
    versionLabel: "clean baseline release",
    changelog: "Clean baseline release before malicious retry validation.",
  });
  await completeScan(client, { slug, version: "1.0.0", verdict: "benign" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expectCurrentVersion(page, "1.0.0");

  const maliciousVersions = ["1.0.1", "1.0.2", "1.0.3"] as const;
  const finalMaliciousVersion = maliciousVersions[maliciousVersions.length - 1];
  for (const version of maliciousVersions) {
    await page.getByRole("link", { name: "New version" }).click();
    await expect(page).toHaveURL(/\/skills\/publish\?updateSlug=/);
    await publishSkillVersion(page, testInfo, {
      ownerHandle,
      slug,
      displayName,
      version,
      versionLabel: `malicious retry ${version}`,
      changelog: `Synthetic malicious retry ${version}.`,
    });
    await completeScan(client, { slug, version, verdict: "malicious" });
    if (version === finalMaliciousVersion) {
      await waitForCapturedEmails((emails) =>
        emails.some((email) => email.subject === ACCOUNT_SUSPENDED_SUBJECT),
      );
    } else {
      await waitForCapturedEmails(
        (emails) =>
          emails.filter(
            (email) =>
              email.subject === "ClawHub blocked a skill version" &&
              email.text.includes(`Version: ${version}`) &&
              email.text.includes(`clawhub scan download ${slug} --version ${version}`),
          ).length === 1,
      );
    }
    await page.goto(`/${ownerHandle}/${slug}`, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    if (version !== finalMaliciousVersion) {
      await expectCurrentVersion(page, "1.0.0");
    }
  }

  const emails = await waitForCapturedEmails(
    (captured) =>
      captured.filter((email) => email.subject === "ClawHub blocked a skill version").length ===
        2 && captured.some((email) => email.subject === ACCOUNT_SUSPENDED_SUBJECT),
  );
  const artifactEmails = emails.filter(
    (email) => email.subject === "ClawHub blocked a skill version",
  );
  expect(artifactEmails).toHaveLength(2);
  for (const email of artifactEmails) {
    expect(email.text).toContain("Your account can still sign in.");
    expect(email.text).toContain("Repeated malicious rejections may lead to account disablement");
    expect(email.text).not.toContain("appeals.openclaw.ai");
  }

  const accountBanEmail = emails.find((email) => email.subject === ACCOUNT_SUSPENDED_SUBJECT);
  expect(accountBanEmail?.text).toContain("Appeal: https://appeals.openclaw.ai/");
  expect(accountBanEmail?.text).not.toContain("clawhub scan download");

  await page.getByRole("button", { name: "Open local dev personas" }).click();
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await page.goto("/dashboard?error_description=This%20account%20has%20been%20banned", {
    waitUntil: "domcontentloaded",
  });
  await expect(page).toHaveURL(/\/account-banned$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Your ClawHub account has been banned" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open an appeal" })).toHaveAttribute(
    "href",
    "https://appeals.openclaw.ai/",
  );

  await expectHealthyPage(page, withoutExpectedBannedSessionTeardownErrors(errors));
});
