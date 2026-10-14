/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));

const modules = import.meta.glob("./**/*.ts");
const WORKER_TOKEN = "fail-closed-worker-token";
const FINGERPRINT = "f".repeat(64);
const PACKAGE_NAME = "fail-closed-plugin";

afterEach(() => {
  vi.unstubAllEnvs();
});

type Kind = "skill" | "package";

// Stages a pending target and its publish attempt through the same mutations every publish
// entry point uses, so the checks below exercise the production verdict pipeline.
async function stagedFixture(kind: Kind) {
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", WORKER_TOKEN);
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const fixture = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "fail-closed-owner", role: "user" });
    const storageId = await ctx.storage.store(new Blob(["# Fail closed\n"]));
    const file = { path: "SKILL.md", size: 14, storageId, sha256: "a".repeat(64) };
    if (kind === "skill") {
      const skillId = await ctx.db.insert("skills", {
        slug: "fail-closed-skill",
        displayName: "Fail Closed Skill",
        ownerUserId: userId,
        tags: {},
        stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
        createdAt: 1,
        updatedAt: 1,
      });
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        publicationStatus: "pending",
        fingerprint: FINGERPRINT,
        changelog: "",
        files: [file],
        parsed: { frontmatter: {} },
        createdBy: userId,
        createdAt: 1,
      });
      return { userId, file, skillId, versionId };
    }
    const verification = {
      tier: "structural" as const,
      scope: "artifact-only" as const,
      scanStatus: "pending" as const,
    };
    const packageId = await ctx.db.insert("packages", {
      name: PACKAGE_NAME,
      normalizedName: PACKAGE_NAME,
      displayName: "Fail Closed Plugin",
      ownerUserId: userId,
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      tags: {},
      compatibility: {},
      verification,
      scanStatus: "pending",
      stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
    const releaseId = await ctx.db.insert("packageReleases", {
      packageId,
      version: "1.0.0",
      publicationStatus: "pending",
      changelog: "",
      distTags: [],
      files: [{ ...file, path: "package.json" }],
      integritySha256: FINGERPRINT,
      compatibility: {},
      verification,
      createdBy: userId,
      publishActor: { kind: "user", userId },
      createdAt: 1,
    });
    return { userId, file, packageId, releaseId };
  });

  const staged =
    kind === "skill"
      ? await t.mutation(internal.publishAttempts.createSkillPublishAttemptInternal, {
          userId: fixture.userId,
          skillId: fixture.skillId as Id<"skills">,
          skillVersionId: fixture.versionId as Id<"skillVersions">,
          slug: "fail-closed-skill",
          displayName: "Fail Closed Skill",
          version: "1.0.0",
          idempotencyKey: "fail-closed-skill",
          artifactFingerprint: FINGERPRINT,
          files: [fixture.file],
          followup: { skipWebhook: true },
        })
      : await t.mutation(internal.publishAttempts.createPackagePublishAttemptInternal, {
          userId: fixture.userId,
          ownerUserId: fixture.userId,
          packageId: fixture.packageId as Id<"packages">,
          packageReleaseId: fixture.releaseId as Id<"packageReleases">,
          name: PACKAGE_NAME,
          displayName: "Fail Closed Plugin",
          version: "1.0.0",
          idempotencyKey: "fail-closed-package",
          artifactFingerprint: FINGERPRINT,
          files: [{ ...fixture.file, path: "package.json" }],
          packageFollowup: { ownerUserId: fixture.userId, packageName: PACKAGE_NAME },
        });
  expect(staged.status).toBe("pending_checks");

  const claim = async () => {
    const claimed = (await t.action(api.publishAttempts.claimPrePublicationChecks, {
      token: WORKER_TOKEN,
      attemptId: staged.attemptId,
    })) as { claimId: string; artifactFingerprint: string } | null;
    expect(claimed?.artifactFingerprint).toBe(FINGERPRINT);
    return claimed as { claimId: string; artifactFingerprint: string };
  };
  const complete = (
    claimId: string,
    verdict: {
      trufflehog: { status: "clean" | "blocked" | "failed"; summary?: string };
      clawscan: { status: "clean" | "blocked" | "failed"; summary?: string };
      clawscanAnalysis?: { status: string; verdict?: string; summary?: string; checkedAt: number };
    },
  ) =>
    t.action(api.publishAttempts.completePrePublicationChecks, {
      token: WORKER_TOKEN,
      attemptId: staged.attemptId,
      claimId,
      artifactFingerprint: FINGERPRINT,
      ...verdict,
    });
  const attempt = () => t.run((ctx) => ctx.db.get(staged.attemptId));
  const target = async (): Promise<Doc<"skillVersions"> | Doc<"packageReleases"> | null> =>
    kind === "skill"
      ? await t.run((ctx) => ctx.db.get(fixture.versionId as Id<"skillVersions">))
      : await t.run((ctx) => ctx.db.get(fixture.releaseId as Id<"packageReleases">));
  const expectNotPublic = async () => {
    if (kind === "skill") {
      expect(
        await t.query(api.skills.getVersionById, {
          versionId: fixture.versionId as Id<"skillVersions">,
        }),
      ).toBeNull();
      expect(
        (await t.run((ctx) => ctx.db.get(fixture.skillId as Id<"skills">)))?.latestVersionId,
      ).toBeUndefined();
      return;
    }
    expect(
      await t.query(internal.packages.getVersionByNameForViewerInternal, {
        name: PACKAGE_NAME,
        version: "1.0.0",
      }),
    ).toBeNull();
    expect((await t.fetch(`/api/v1/packages/${PACKAGE_NAME}/download?version=1.0.0`)).status).toBe(
      404,
    );
    expect(
      (await t.run((ctx) => ctx.db.get(fixture.packageId as Id<"packages">)))?.latestReleaseId,
    ).toBeUndefined();
  };
  // Models the worker retry backoff or an abandoned lease elapsing.
  const elapseClaim = () =>
    t.run((ctx) => ctx.db.patch(staged.attemptId, { checkClaimExpiresAt: Date.now() - 1 }));

  return { t, claim, complete, attempt, target, expectNotPublic, elapseClaim };
}

describe.each(["skill", "package"] as const)("%s pre-publication checks fail closed", (kind) => {
  it("keeps the release unpublished when the scanner keeps failing or timing out", async () => {
    const f = await stagedFixture(kind);
    const outcomes: unknown[] = [];
    for (let run = 0; run < 3; run += 1) {
      const { claimId } = await f.claim();
      outcomes.push(
        await f.complete(claimId, {
          trufflehog: { status: "clean" },
          clawscan: {
            status: "failed",
            summary: "ClawScan timed out before returning a verdict.",
          },
        }),
      );
      expect((await f.target())?.publicationStatus).toBe("pending");
      await f.expectNotPublic();
      if (run < 2) {
        expect(await f.attempt()).toMatchObject({
          status: "pending_checks",
          checkFailureCount: run + 1,
        });
        await f.elapseClaim();
      }
    }

    expect(outcomes.map((outcome) => (outcome as { status: string }).status)).toEqual([
      "pending_checks",
      "pending_checks",
      "failed",
    ]);
    expect(await f.attempt()).toMatchObject({
      status: "failed",
      checkClaimLastError: "ClawScan timed out before returning a verdict.",
      failedAt: expect.any(Number),
    });
    expect((await f.target())?.publicationStatus).toBe("pending");
    await f.expectNotPublic();
    // A failed attempt cannot be claimed again for checks or finalization.
    await expect(
      f.t.action(api.publishAttempts.claimPrePublicationChecks, {
        token: WORKER_TOKEN,
        kind,
      }),
    ).resolves.toBeNull();
  });

  it("blocks a release when ClawScan returns a malicious verdict", async () => {
    const f = await stagedFixture(kind);
    const { claimId } = await f.claim();

    await expect(
      f.complete(claimId, {
        trufflehog: { status: "clean" },
        clawscan: { status: "blocked", summary: "Malicious credential exfiltration." },
        clawscanAnalysis: {
          status: "malicious",
          verdict: "malicious",
          summary: "Malicious credential exfiltration.",
          checkedAt: Date.now(),
        },
      }),
    ).resolves.toMatchObject({ status: "blocked" });

    expect(await f.attempt()).toMatchObject({ status: "blocked", blockedAt: expect.any(Number) });
    const blocked = await f.target();
    expect(blocked?.publicationStatus).toBe("blocked");
    expect(blocked?.llmAnalysis).toMatchObject({ verdict: "malicious" });
    if (kind === "package") {
      expect(blocked).toMatchObject({ verification: { scanStatus: "malicious" } });
    }
    await f.expectNotPublic();
  });

  it("rejects a late verdict from a worker whose check lease timed out", async () => {
    const f = await stagedFixture(kind);
    const { claimId } = await f.claim();
    await f.elapseClaim();

    await expect(
      f.complete(claimId, {
        trufflehog: { status: "clean" },
        clawscan: { status: "clean" },
      }),
    ).rejects.toThrow("Publish attempt check claim is not active.");

    expect(await f.attempt()).toMatchObject({ status: "pending_checks" });
    expect((await f.target())?.publicationStatus).toBe("pending");
    await f.expectNotPublic();
  });
});
