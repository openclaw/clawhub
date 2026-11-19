/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const fingerprint = "f".repeat(64);
const version = "1.2.0";
const displayName = "Morning Brief";
const email = "creator@example.invalid";
const summary = {
  schemaVersion: 1,
  agent: { id: "brief", name: displayName },
  workspace: { bootstrapFiles: [], fileCount: 0 },
  packages: { skillCount: 0, pluginCount: 0 },
  mcpServerCount: 0,
  cronJobCount: 0,
};
const clean = { status: "clean" as const };
const failed = { status: "failed" as const, summary: "private scanner detail" };
const blocked = { status: "blocked" as const, redactedFindings: ["private finding"] };
const checks = internal.publishAttempts;
const successAction = "emailsNode:sendTemplatePublicationOutcomeInternal";
const secretAction = "emailsNode:sendSecretPublishBlockedNotificationInternal";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture(
  options: { name?: string; channel?: "private"; noAddress?: boolean; plugin?: boolean } = {},
) {
  const t = convexTest(schema, modules);
  const name = options.name ?? "@newsroom/brief";
  const family = options.plugin ? ("code-plugin" as const) : ("claw" as const);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      handle: "writer",
      email: options.noAddress ? undefined : email,
    });
    const ownerUserId = await ctx.db.insert("users", {
      handle: "owner",
      email: "not-the-submitter@example.invalid",
    });
    const ownerPublisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "newsroom",
      displayName: "The Newsroom",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("publisherMembers", {
      publisherId: ownerPublisherId,
      userId,
      role: "publisher",
      createdAt: 1,
      updatedAt: 1,
    });
    const packageId = await ctx.db.insert("packages", {
      name,
      normalizedName: name,
      displayName: name,
      ownerUserId,
      ownerPublisherId,
      family,
      channel: "community",
      isOfficial: false,
      tags: {},
      stats: { installs: 0, downloads: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
    const releaseId = await ctx.db.insert("packageReleases", {
      packageId,
      version,
      createdBy: userId,
      createdAt: 1,
      publicationStatus: "pending",
      pendingPublication: { channel: options.channel ?? "community", family, tags: ["latest"] },
      distTags: ["latest"],
      changelog: "Release",
      files: [],
      integritySha256: fingerprint,
      ...(options.plugin ? {} : { clawpackSha256: fingerprint, clawManifestSummary: summary }),
    });
    const attemptId = await ctx.db.insert("publishAttempts", {
      kind: "package",
      userId,
      ownerUserId,
      ownerPublisherId,
      packageId,
      packageReleaseId: releaseId,
      createdNewParent: true,
      slug: name,
      displayName: name,
      version,
      artifactFingerprint: fingerprint,
      status: "pending_checks",
      idempotencyKey: "attempt",
      files: [],
      scanContext: { package: { family } },
      packageFollowup: {},
      checks: { trufflehog: { status: "pending" }, clawscan: { status: "pending" } },
      createdAt: 1,
      updatedAt: 1,
      expiresAt: Date.now() + 86400000,
    });
    await ctx.db.patch(releaseId, { publishAttemptId: attemptId });
    return { userId, ownerUserId, ownerPublisherId, packageId, releaseId, attemptId };
  });
  const jobs = async () =>
    (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) =>
      job.name.startsWith("emailsNode:"),
    );
  const claim = (claimId: string) =>
    t.mutation(checks.claimPendingPublishAttemptChecksInternal, {
      attemptId: ids.attemptId,
      claimId,
    });
  const complete = (
    claimId: string,
    trufflehog: typeof clean | typeof failed | typeof blocked,
    clawscan: typeof clean | typeof failed | typeof blocked,
    verdict?: string,
  ) =>
    t.mutation(checks.completePendingPublishAttemptChecksInternal, {
      attemptId: ids.attemptId,
      claimId,
      artifactFingerprint: fingerprint,
      trufflehog,
      clawscan,
      ...(verdict ? { clawscanAnalysis: { status: verdict, checkedAt: Date.now() } } : {}),
    });
  const finalize = () =>
    t.action(internal.packages.finalizePackagePublishAttemptInternal, { attemptId: ids.attemptId });
  return { t, name, jobs, claim, complete, finalize, ...ids };
}

it.each(["@newsroom/brief", "brief"])(
  "notifies the submitting user once, only when %s goes public",
  async (name) => {
    vi.stubEnv("SITE_URL", "https://not-the-public-origin.invalid");
    const f = await fixture({ name });
    await f.claim("scan");
    await f.complete("scan", clean, clean, "benign");
    expect(await f.jobs()).toEqual([]);
    const receipt = await f.finalize();
    expect(await f.finalize()).toEqual(receipt);
    expect(
      await f.t.query(api.packages.getVersionByName, { name: "@newsroom/brief", version }),
    ).not.toBeNull();
    expect(await f.jobs()).toMatchObject([
      {
        name: successAction,
        args: [
          {
            attemptId: f.attemptId,
            releaseId: f.releaseId,
            to: email,
            outcome: "published",
            displayName,
            packageName: name,
            version,
            auditPassed: true,
            templateUrl: "https://clawhub.ai/newsroom/templates/brief",
            publishedAt: (await f.t.run((ctx) => ctx.db.get(f.packageId)))!.updatedAt,
          },
        ],
      },
    ]);
  },
);

it("notifies on a legacy finalizer's new direct insert but not a direct internal import or reused release", async () => {
  const f = await fixture();
  const legacy = {
    actorUserId: f.userId,
    ownerUserId: f.userId,
    ownerPublisherId: f.ownerPublisherId,
    name: f.name,
    displayName,
    version,
    family: "claw" as const,
    changelog: "Initial",
    tags: ["latest"],
    summary: "Morning",
    files: [],
    integritySha256: fingerprint,
    sha256hash: fingerprint,
    clawpackSha256: fingerprint,
    clawManifestSummary: summary,
  };
  await f.t.run(async (ctx) => {
    await ctx.db.delete(f.releaseId);
    await ctx.db.patch(f.attemptId, {
      status: "ready_to_finalize",
      packageId: undefined,
      packageReleaseId: undefined,
      ownerUserId: f.userId,
      packageInsertArgs: legacy,
    });
  });
  const result = await f.finalize();
  await f.finalize();
  expect(await f.jobs()).toMatchObject([
    {
      args: [
        {
          attemptId: f.attemptId,
          outcome: "published",
          auditPassed: false,
          releaseId: result.releaseId,
        },
      ],
    },
  ]);
  const next = { ...legacy, version: "1.3.0" };
  await f.t.mutation(internal.packages.insertReleaseInternal, next);
  const retryId = await f.t.run(async (ctx) => {
    const attempt = (await ctx.db.get(f.attemptId))!;
    const { _id, _creationTime, result: _result, ...prior } = attempt;
    return ctx.db.insert("publishAttempts", {
      ...prior,
      status: "ready_to_finalize",
      idempotencyKey: "legacy-retry",
      version: next.version,
      packageInsertArgs: next,
    });
  });
  await f.t.action(internal.packages.finalizePackagePublishAttemptInternal, { attemptId: retryId });
  expect(await f.jobs()).toHaveLength(1);
});

it("does not link an unscoped version to a different package at its canonical URL", async () => {
  const f = await fixture({ name: "brief" });
  await f.t.run(async (ctx) => {
    const { _id, _creationTime, ...pkg } = (await ctx.db.get(f.packageId))!;
    const name = "@newsroom/brief";
    const shadow = await ctx.db.insert("packages", { ...pkg, name, normalizedName: name });
    const { _id: _release, _creationTime: _created, ...release } = (await ctx.db.get(f.releaseId))!;
    const id = await ctx.db.insert("packageReleases", {
      ...release,
      packageId: shadow,
      publicationStatus: "published",
      publishAttemptId: undefined,
      pendingPublication: undefined,
    });
    await ctx.db.patch(shadow, { latestReleaseId: id });
  });
  await f.claim("scan");
  await f.complete("scan", clean, clean, "benign");
  await f.finalize();
  expect(await f.jobs()).toEqual([]);
});

it("manual moderation, post-publication scan results and backfills are not new submissions", async () => {
  const f = await fixture();
  await f.claim("scan");
  await f.complete("scan", clean, clean, "benign");
  await f.finalize();
  const initial = await f.jobs();
  expect(initial).toHaveLength(1);
  const reviewer = await f.t.run((ctx) => ctx.db.insert("users", { role: "moderator" }));
  for (const state of ["quarantined", "approved"] as const) {
    await f.t.mutation(internal.packages.moderatePackageReleaseForUserInternal, {
      actorUserId: reviewer,
      name: f.name,
      version,
      state,
      reason: "Review fixture",
    });
  }
  await f.t.mutation(internal.packages.updateReleaseLlmAnalysisInternal, {
    releaseId: f.releaseId,
    llmAnalysis: { status: "benign", checkedAt: Date.now() },
  });
  await f.t.mutation(internal.packages.backfillLatestPackageScanStatusInternal, {});
  expect(await f.jobs()).toEqual(initial);
});

it.each([undefined, "suspicious"])(
  "does not call %s audit evidence a passed security audit",
  async (verdict) => {
    const f = await fixture();
    await f.claim("scan");
    await f.complete("scan", clean, clean, verdict);
    await f.finalize();
    expect(await f.jobs()).toMatchObject([
      { args: [{ outcome: "published", auditPassed: false }] },
    ]);
  },
);

it.each(["secret", "malicious"])(
  "keeps the %s block terminal, sends no duplicate or scanner details",
  async (kind) => {
    const f = await fixture();
    await f.claim("scan");
    const complete = () => f.complete("scan", kind === "secret" ? blocked : clean, blocked);
    await complete();
    await complete();
    const jobs = await f.jobs();
    expect(jobs.map((job) => ({ name: job.name, args: job.args }))).toEqual(
      kind === "secret"
        ? [
            {
              name: secretAction,
              args: [
                {
                  attemptId: f.attemptId,
                  userId: f.userId,
                  to: email,
                  handle: "writer",
                  artifact: { kind: "template", name: f.name },
                  version,
                },
              ],
            },
          ]
        : [
            {
              name: successAction,
              args: [
                {
                  attemptId: f.attemptId,
                  to: email,
                  outcome: "blocked",
                  packageName: f.name,
                  displayName,
                  version,
                },
              ],
            },
          ],
    );
    const release = await f.t.run((ctx) => ctx.db.get(f.releaseId));
    if (kind === "secret") expect(release).toBeNull();
    else expect(release?.publicationStatus).toBe("blocked");
  },
);

it("notifies once at exhaustion, then once for a recovered public release", async () => {
  const f = await fixture();
  const recover = async () => {
    const attempt = await f.t.run((ctx) => ctx.db.get(f.attemptId));
    return f.t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, {
      attemptId: f.attemptId,
      expectedUpdatedAt: attempt!.updatedAt,
      expectedArtifactFingerprint: fingerprint,
      dryRun: false,
      reason: "Worker restored",
    });
  };
  for (let n = 1; n <= 3; n++) {
    const id = "scan-" + n;
    await f.claim(id);
    await f.complete(id, clean, failed);
    if (n < 3) {
      expect(await f.jobs()).toEqual([]);
      vi.setSystemTime(Date.now() + 300001);
    }
  }
  expect((await f.jobs()).map((job) => job.args)).toEqual([
    [
      {
        to: email,
        attemptId: f.attemptId,
        outcome: "scan_failed",
        packageName: f.name,
        displayName,
        version,
      },
    ],
  ]);
  expect(await recover()).toMatchObject({ requeued: true });
  await f.claim("fourth");
  await f.complete("fourth", clean, failed);
  expect(await f.jobs()).toHaveLength(1);
  expect(await recover()).toMatchObject({ requeued: true });
  await f.claim("restored");
  await f.complete("restored", clean, clean, "benign");
  await f.finalize();
  await f.finalize();
  expect(await f.jobs()).toMatchObject([
    { args: [{ outcome: "scan_failed" }] },
    { args: [{ outcome: "published", releaseId: f.releaseId, auditPassed: true }] },
  ]);
});

it.each([
  "private-publication",
  "private-block",
  "private-secret",
  "no-address",
  "plugin-failure",
  "internal-promotion",
])("does not send a template notification for %s", async (scenario) => {
  const f = await fixture({
    channel: scenario.startsWith("private") ? "private" : undefined,
    noAddress: scenario === "no-address",
    plugin: scenario === "plugin-failure",
  });
  if (scenario === "internal-promotion") {
    await f.t.mutation(internal.packages.publishPendingReleaseInternal, { releaseId: f.releaseId });
  } else if (scenario === "plugin-failure") {
    await f.t.run((ctx) => ctx.db.patch(f.attemptId, { checkFailureCount: 2 }));
    await f.claim("scan");
    await f.complete("scan", failed, failed);
  } else {
    await f.claim("scan");
    if (scenario === "private-block") await f.complete("scan", clean, blocked);
    else if (scenario === "private-secret") await f.complete("scan", blocked, blocked);
    else {
      await f.complete("scan", clean, clean, "benign");
      await f.finalize();
    }
  }
  expect(await f.jobs()).toEqual([]);
});
