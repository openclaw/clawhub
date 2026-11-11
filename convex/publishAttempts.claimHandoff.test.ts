/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processPrePublicationAttempt } from "../scripts/security/run-prepublication-worker";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { claimPrePublicationChecks } from "./publishAttempts";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const token = "synthetic-claim-worker";
const reviewedScannerSource = "b08e2907eb60b33bf712b07673aff565c13d9ad7";
const handler = (
  claimPrePublicationChecks as unknown as {
    _handler: (
      ctx: ActionCtx,
      args: {
        token: string;
        attemptId?: Id<"publishAttempts">;
        kind?: "skill" | "package";
        slug?: string;
        version?: string;
        preferRetry?: boolean;
      },
    ) => Promise<unknown>;
  }
)._handler;
type TestBackend = ReturnType<typeof convexTest>;

async function seed(
  t: TestBackend,
  kind: "skill" | "package" = "skill",
  ready = false,
  empty = false,
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    const storageId = await ctx.storage.store(new Blob(["synthetic retained original"]));
    const archiveStorageId = await ctx.storage.store(new Blob(["synthetic original archive"]));
    const attemptId = await ctx.db.insert("publishAttempts", {
      kind,
      status: ready ? "ready_to_finalize" : "pending_checks",
      userId,
      slug: "synthetic-claim-handoff",
      displayName: "Synthetic Claim Handoff",
      version: "1.0.0",
      idempotencyKey: `synthetic-${kind}-${ready}-${storageId}`,
      artifactFingerprint: "original-fingerprint",
      files: empty ? [] : [{ path: "SKILL.md", size: 27, sha256: "original-file-hash", storageId }],
      ...(kind === "package" && !empty ? { clawpackStorageId: archiveStorageId } : {}),
      checks: {
        trufflehog: { status: ready ? "clean" : "pending", summary: "original check evidence" },
        clawscan: { status: ready ? "clean" : "pending", summary: "original scanner evidence" },
      },
      checkFailureCount: 2,
      checkClaimLastError: "Previous scanner failure",
      createdAt: 1,
      updatedAt: 1,
      expiresAt: Date.now() + 3_600_000,
    });
    return { attemptId, storageId, archiveStorageId };
  });
}

function actionContext(
  t: TestBackend,
  getUrl: (id: Id<"_storage">) => Promise<string | null>,
  beforeMutation?: (name: string) => Promise<void>,
) {
  return {
    runMutation: async (ref: FunctionReference<"mutation", "internal" | "public">, args: never) => {
      await beforeMutation?.(getFunctionName(ref));
      return await t.mutation(ref, args);
    },
    storage: { getUrl },
  } as unknown as ActionCtx;
}

const state = (t: TestBackend, attemptId: Id<"publishAttempts">) =>
  t.run(async (ctx) => await ctx.db.get(attemptId));
const bytes = (t: TestBackend, storageId: Id<"_storage">) =>
  t.run(async (ctx) => await (await ctx.storage.get(storageId))?.text());
const realUrl = (t: TestBackend) => async (id: Id<"_storage">) =>
  await t.run(async (ctx) => await ctx.storage.getUrl(id));

function backoffArgs(attempt: Doc<"publishAttempts">) {
  return {
    attemptId: attempt._id,
    claimId: attempt.checkClaimId!,
    artifactFingerprint: attempt.artifactFingerprint,
    kind: attempt.kind,
    status: attempt.status as "pending_checks" | "ready_to_finalize",
    checkClaimExpiresAt: attempt.checkClaimExpiresAt!,
    phase: "files" as const,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-03T00:00:00Z") });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("keeps a physical Template claim leased through native MCP and judge drain", async () => {
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
  const t = convexTest(schema, modules);
  const fixture = await seed(t, "package");
  await t.run(async (ctx) => {
    const attempt = (await ctx.db.get(fixture.attemptId))!;
    const packageId = await ctx.db.insert("packages", {
      name: "@fixture/template-lease",
      normalizedName: "@fixture/template-lease",
      displayName: "Template lease fixture",
      ownerUserId: attempt.userId,
      family: "claw",
      channel: "community",
      isOfficial: false,
      tags: {},
      scanStatus: "pending",
      stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(fixture.attemptId, { packageId });
  });
  await t.action(api.publishAttempts.claimPrePublicationChecks, {
    token,
    attemptId: fixture.attemptId,
  });
  const claimed = (await state(t, fixture.attemptId))!;
  expect(claimed.checkClaimExpiresAt).toBe(claimed.checkClaimedAt! + 70 * 60_000);
  vi.setSystemTime(claimed.checkClaimedAt! + 31 * 60_000);
  await expect(
    t.action(api.publishAttempts.claimPrePublicationChecks, {
      token,
      attemptId: fixture.attemptId,
    }),
  ).resolves.toBeNull();
  expect((await state(t, fixture.attemptId))?.checkClaimId).toBe(claimed.checkClaimId);
});

describe("failed finalization claim handoff", () => {
  async function seedFinalization(t: TestBackend, kind: "skill" | "package") {
    const fixture = await seed(t, kind, true);
    await t.run((ctx) =>
      ctx.db.patch(
        fixture.attemptId,
        kind === "skill" ? { skillInsertArgs: {}, followup: {} } : { packageInsertArgs: {} },
      ),
    );
    return fixture;
  }

  const finalizers = {
    skill: {
      claim: internal.publishAttempts.claimSkillPublishAttemptForFinalizationInternal,
      release: internal.publishAttempts.releaseSkillPublishAttemptFinalizationClaimInternal,
    },
    package: {
      claim: internal.publishAttempts.claimPackagePublishAttemptForFinalizationInternal,
      release: internal.publishAttempts.releasePackagePublishAttemptFinalizationClaimInternal,
    },
  };

  it.each(["skill", "package"] as const)(
    "lets a new worker retry %s finalization immediately after failure",
    async (kind) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      const t = convexTest(schema, modules);
      const { attemptId } = await seedFinalization(t, kind);
      const before = (await state(t, attemptId))!;
      const claim = await t.action(api.publishAttempts.claimPrePublicationChecks, {
        token,
        attemptId,
      });
      expect(claim).toMatchObject({ attemptId, status: "ready_to_finalize" });
      const claimed = (await state(t, attemptId))!;
      expect(claimed.checkClaimExpiresAt).toBe(
        claimed.checkClaimedAt! + (kind === "package" ? 70 : 30) * 60_000,
      );
      await t.mutation(finalizers[kind].claim, { attemptId, claimId: "finalizer:failed" });
      await t.mutation(finalizers[kind].release, {
        attemptId,
        claimId: "finalizer:failed",
        error: "Synthetic transient finalization failure",
      });
      const released = (await state(t, attemptId))!;
      expect(released.status).toBe("ready_to_finalize");
      expect(released.finalizationClaimId).toBeUndefined();
      expect(released.finalizationClaimedAt).toBeUndefined();
      expect(released.finalizationClaimExpiresAt).toBeUndefined();
      expect(released.finalizationLastError).toBe("Synthetic transient finalization failure");
      expect(released.checks).toEqual(before.checks);
      expect(released.files).toEqual(before.files);
      const retry = await t.action(api.publishAttempts.claimPrePublicationChecks, {
        token,
        attemptId,
      });
      expect(retry).toMatchObject({ attemptId, status: "ready_to_finalize" });
      expect(retry!.claimId).not.toBe(claim!.claimId);
      expect(released.checkClaimId).toBeUndefined();
      expect(released.checkClaimedAt).toBeUndefined();
      expect(released.checkClaimExpiresAt).toBeUndefined();
    },
  );

  it.each(["skill", "package"] as const)(
    "ignores stale %s cleanup after another worker acquires the retry",
    async (kind) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      const t = convexTest(schema, modules);
      const { attemptId } = await seedFinalization(t, kind);
      await t.action(api.publishAttempts.claimPrePublicationChecks, { token, attemptId });
      await t.mutation(finalizers[kind].claim, { attemptId, claimId: "finalizer:old" });
      await t.mutation(finalizers[kind].release, {
        attemptId,
        claimId: "finalizer:old",
        error: "Synthetic transient finalization failure",
      });
      // Also exercise replacement after the old lease expires on the unfixed baseline.
      vi.advanceTimersByTime(70 * 60_000 + 1);
      expect(
        await t.action(api.publishAttempts.claimPrePublicationChecks, { token, attemptId }),
      ).toMatchObject({ attemptId, status: "ready_to_finalize" });
      const retryClaimed = await state(t, attemptId);
      await t.mutation(finalizers[kind].release, { attemptId, claimId: "finalizer:old" });
      expect(await state(t, attemptId)).toEqual(retryClaimed);
      await t.mutation(finalizers[kind].claim, { attemptId, claimId: "finalizer:new" });
      const finalizing = await state(t, attemptId);
      await t.mutation(finalizers[kind].release, { attemptId, claimId: "finalizer:old" });
      expect(await state(t, attemptId)).toEqual(finalizing);
      expect(
        await t.action(api.publishAttempts.claimPrePublicationChecks, { token, attemptId }),
      ).toBeNull();
      expect(await state(t, attemptId)).toEqual(finalizing);
    },
  );
});

describe("recovery scanner source claims", () => {
  it("leaves a protected original untouched when an old worker omits its source", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    await t.run(
      async (ctx) =>
        await ctx.db.patch(fixture.attemptId, { requiredScannerSource: reviewedScannerSource }),
    );
    const before = await state(t, fixture.attemptId);
    expect(
      await t.action(api.publishAttempts.claimPrePublicationChecks, {
        token,
        attemptId: fixture.attemptId,
      }),
    ).toBeNull();
    expect(await state(t, fixture.attemptId)).toEqual(before);
    expect(await bytes(t, fixture.storageId)).toBe("synthetic retained original");
    expect(await t.run((ctx) => ctx.db.query("auditLogs").collect())).toEqual([]);
  });

  it.each(["skill", "package"] as const)(
    "accepts only the required source for a protected %s and binds its scan lease",
    async (kind) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      const t = convexTest(schema, modules);
      const fixture = await seed(t, kind);
      await t.run((ctx) =>
        ctx.db.patch(fixture.attemptId, { requiredScannerSource: reviewedScannerSource }),
      );
      const before = (await state(t, fixture.attemptId))!;
      expect(
        await t.action(api.publishAttempts.claimPrePublicationChecks, {
          token,
          attemptId: fixture.attemptId,
          scannerSource: "7".repeat(40),
        }),
      ).toBeNull();
      expect(await state(t, fixture.attemptId)).toEqual(before);
      const claimed = (await t.action(api.publishAttempts.claimPrePublicationChecks, {
        token,
        attemptId: fixture.attemptId,
        scannerSource: reviewedScannerSource,
      })) as { claimId: string; attemptId: Id<"publishAttempts"> };
      expect(claimed.attemptId).toBe(fixture.attemptId);
      const after = (await state(t, fixture.attemptId))!;
      expect(after.lastScannerSourceClaim).toEqual({
        claimId: claimed.claimId,
        source: reviewedScannerSource,
        claimedAt: after.checkClaimedAt,
      });
      expect(after.checkClaimedAt).toBe(after.updatedAt);
      expect(after.files).toEqual(before.files);
      expect(after.checks).toEqual(before.checks);
      expect(after.checkFailureCount).toBe(2);
      expect(await bytes(t, fixture.storageId)).toBe("synthetic retained original");
      expect(await bytes(t, fixture.archiveStorageId)).toBe("synthetic original archive");
      // A matching-source worker still cannot steal an unexpired lease.
      expect(
        await t.action(api.publishAttempts.claimPrePublicationChecks, {
          token,
          attemptId: fixture.attemptId,
          scannerSource: reviewedScannerSource,
        }),
      ).toBeNull();
      expect(await state(t, fixture.attemptId)).toEqual(after);
      expect(
        await t.action(api.publishAttempts.completePrePublicationChecks, {
          token,
          attemptId: fixture.attemptId,
          claimId: claimed.claimId,
          artifactFingerprint: before.artifactFingerprint,
          trufflehog: { status: "clean" },
          clawscan: { status: "failed", summary: "Synthetic operational failure" },
        }),
      ).toMatchObject({ status: "failed" });
      expect((await state(t, fixture.attemptId))!.lastScannerSourceClaim).toEqual(
        after.lastScannerSourceClaim,
      );
      expect((await state(t, fixture.attemptId))!.checkFailureCount).toBe(3);
    },
  );

  it.each([false, true])(
    "lets an older generic worker claim unrelated work (retry=%s)",
    async (retry) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      const t = convexTest(schema, modules);
      const protectedFixture = await seed(t);
      const ordinary = await seed(t);
      await t.run(async (ctx) => {
        await ctx.db.patch(protectedFixture.attemptId, {
          requiredScannerSource: reviewedScannerSource,
          checkClaimExpiresAt: Date.now() - 2,
        });
        await ctx.db.patch(ordinary.attemptId, { checkClaimExpiresAt: Date.now() - 1 });
      });
      const before = await state(t, protectedFixture.attemptId);
      expect(
        await t.action(api.publishAttempts.claimPrePublicationChecks, {
          token,
          preferRetry: retry,
        }),
      ).toMatchObject({ attemptId: ordinary.attemptId });
      expect(await state(t, protectedFixture.attemptId)).toEqual(before);
    },
  );

  it("does not apply scan-source restrictions to finalization-only claims", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    const t = convexTest(schema, modules);
    const fixture = await seed(t, "skill", true);
    const previous = { claimId: "previous-scan", source: reviewedScannerSource, claimedAt: 2 };
    await t.run((ctx) =>
      ctx.db.patch(fixture.attemptId, {
        requiredScannerSource: reviewedScannerSource,
        lastScannerSourceClaim: previous,
      }),
    );
    expect(
      await t.action(api.publishAttempts.claimPrePublicationChecks, {
        token,
        attemptId: fixture.attemptId,
      }),
    ).toMatchObject({ attemptId: fixture.attemptId, status: "ready_to_finalize" });
    expect((await state(t, fixture.attemptId))!.lastScannerSourceClaim).toEqual(previous);
  });

  it("clears stale attribution when a new unreported scan lease replaces an expired one", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    await t.run((ctx) =>
      ctx.db.patch(fixture.attemptId, {
        lastScannerSourceClaim: { claimId: "expired", source: reviewedScannerSource, claimedAt: 1 },
      }),
    );
    expect(
      await t.action(api.publishAttempts.claimPrePublicationChecks, {
        token,
        attemptId: fixture.attemptId,
      }),
    ).toMatchObject({ attemptId: fixture.attemptId });
    expect((await state(t, fixture.attemptId))!.lastScannerSourceClaim).toBeUndefined();
  });

  it.each(["", "ABCDEF".repeat(7), "a".repeat(39), "g".repeat(40)])(
    "rejects malformed reported source %j at both claim boundaries without writes",
    async (scannerSource) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      const t = convexTest(schema, modules);
      const fixture = await seed(t);
      const before = await state(t, fixture.attemptId);
      await expect(
        t.action(api.publishAttempts.claimPrePublicationChecks, {
          token,
          attemptId: fixture.attemptId,
          scannerSource,
        }),
      ).rejects.toThrow("40-character lowercase Git revision");
      await expect(
        t.mutation(internal.publishAttempts.claimPendingPublishAttemptChecksInternal, {
          claimId: "invalid-source",
          attemptId: fixture.attemptId,
          scannerSource,
        }),
      ).rejects.toThrow("40-character lowercase Git revision");
      expect(await state(t, fixture.attemptId)).toEqual(before);
    },
  );
});

describe("bounded pre-publication URL hydration", () => {
  async function manyFiles(t: TestBackend, count: number) {
    const fixture = await seed(t);
    const files = Array.from({ length: count }, (_, index) => ({
      path: `files/${index}.txt`,
      size: 27,
      sha256: `original-file-hash-${index}`,
      storageId: fixture.storageId,
    }));
    await t.run(async (ctx) => await ctx.db.patch(fixture.attemptId, { files }));
    return { ...fixture, files };
  }

  it.each([0, 1, 8, 9, 237])(
    "hydrates %i files within storage capacity and preserves their order and originals",
    async (count) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      const t = convexTest(schema, modules);
      const fixture = await manyFiles(t, count);
      let active = 0;
      let peak = 0;
      let calls = 0;
      const result = (await handler(
        actionContext(t, async () => {
          const index = calls++;
          active += 1;
          peak = Math.max(peak, active);
          try {
            if (active > 8) throw new Error("synthetic concurrent storage capacity exceeded");
            // Complete peers out of order; output must retain manifest order.
            for (let step = 0; step < 8 - (index % 8); step += 1) await Promise.resolve();
            return `https://synthetic.invalid/file-${index}`;
          } finally {
            active -= 1;
          }
        }),
        { token, attemptId: fixture.attemptId },
      )) as { files: Array<(typeof fixture.files)[number] & { url: string }> };
      expect(result.files).toEqual(
        fixture.files.map((file, index) => ({
          ...file,
          url: `https://synthetic.invalid/file-${index}`,
        })),
      );
      expect(calls).toBe(count);
      expect(peak).toBeLessThanOrEqual(8);
      expect(active).toBe(0);
      const after = (await state(t, fixture.attemptId))!;
      expect(after.files).toEqual(fixture.files);
      expect(after.checkFailureCount).toBe(2);
      expect(after.checkClaimExpiresAt).toBe(after.checkClaimedAt! + 30 * 60_000);
      expect(await bytes(t, fixture.storageId)).toBe("synthetic retained original");
    },
  );

  it("preserves a null file URL without dropping or replacing any file", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    const t = convexTest(schema, modules);
    const fixture = await manyFiles(t, 237);
    let calls = 0;
    const result = (await handler(
      actionContext(t, async () => {
        const index = calls++;
        return index === 91 ? null : `https://synthetic.invalid/file-${index}`;
      }),
      { token, attemptId: fixture.attemptId },
    )) as { files: Array<(typeof fixture.files)[number] & { url: string | null }> };
    expect(result.files).toEqual(
      fixture.files.map((file, index) => ({
        ...file,
        url: index === 91 ? null : `https://synthetic.invalid/file-${index}`,
      })),
    );
    expect((await state(t, fixture.attemptId))?.files).toEqual(fixture.files);
  });

  it("drains the failed batch, rethrows the first rejection and never starts later batches", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const fixture = await manyFiles(t, 237);
    const before = (await state(t, fixture.attemptId))!;
    const firstFailure = new Error("synthetic first storage rejection");
    const laterFailure = new Error("synthetic later storage rejection");
    let calls = 0;
    let active = 0;
    let releasePeers!: () => void;
    const peers = new Promise<void>((resolve) => {
      releasePeers = resolve;
    });
    let batchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      batchStarted = resolve;
    });
    const pending = handler(
      actionContext(t, async () => {
        const index = calls++;
        active += 1;
        if (calls === 8) batchStarted();
        try {
          if (index === 4) throw firstFailure;
          await peers;
          if (index === 0) throw laterFailure;
          return "https://synthetic.invalid/peer";
        } finally {
          active -= 1;
        }
      }),
      { token, attemptId: fixture.attemptId },
    );
    let finished = false;
    void pending.then(
      () => {
        finished = true;
      },
      () => {
        finished = true;
      },
    );
    await started;
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    const finishedBeforePeers = finished;
    releasePeers();
    await expect(pending).rejects.toBe(firstFailure);
    expect(finishedBeforePeers).toBe(false);
    expect(calls).toBe(8);
    expect(active).toBe(0);
    const after = (await state(t, fixture.attemptId))!;
    expect(after.files).toEqual(before.files);
    expect(after.checks).toEqual(before.checks);
    expect(after.checkFailureCount).toBe(before.checkFailureCount);
    expect(after.checkClaimLastError).toBe(before.checkClaimLastError);
    expect(after.checkClaimExpiresAt).toBe(after.updatedAt + 300_000);
    expect(await bytes(t, fixture.storageId)).toBe("synthetic retained original");
  });
});

describe("pre-publication failed handoff backoff", () => {
  it("backs off a committed claim after URL hydration fails without losing scanner history", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-03T00:00:00Z") });
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    const before = (await state(t, fixture.attemptId))!;
    const originalBytes = await bytes(t, fixture.storageId);
    const failure = new Error("synthetic URL failure");
    let originalClaim: Doc<"publishAttempts"> | null = null;
    await expect(
      handler(
        actionContext(t, async () => {
          originalClaim = await state(t, fixture.attemptId);
          throw failure;
        }),
        {
          token,
          attemptId: fixture.attemptId,
        },
      ),
    ).rejects.toBe(failure);
    const after = (await state(t, fixture.attemptId))!;
    expect(after.checkClaimExpiresAt).toBe(after.updatedAt + 300_000);
    expect(after.checkClaimId).toEqual(expect.any(String));
    expect(after.checkClaimedAt).toBe(originalClaim!.checkClaimedAt);
    expect(after.checkClaimLastError).toBe("Previous scanner failure");
    for (const key of [
      "kind",
      "status",
      "files",
      "checks",
      "artifactFingerprint",
      "checkFailureCount",
      "userId",
      "expiresAt",
    ] as const)
      expect(after[key]).toEqual(before[key]);
    expect(await bytes(t, fixture.storageId)).toBe(originalBytes);
  });

  it("never extends a lease when URL hydration fails near its natural expiry", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    let originalClaim: Doc<"publishAttempts"> | null = null;
    await expect(
      handler(
        actionContext(t, async () => {
          originalClaim = await state(t, fixture.attemptId);
          vi.setSystemTime(originalClaim!.checkClaimedAt! + 29 * 60_000);
          throw new Error("late URL failure");
        }),
        { token, attemptId: fixture.attemptId },
      ),
    ).rejects.toThrow("late URL failure");
    expect(originalClaim!.checkClaimExpiresAt).toBe(originalClaim!.checkClaimedAt! + 30 * 60_000);
    expect((await state(t, fixture.attemptId))?.checkClaimExpiresAt).toBe(
      originalClaim!.checkClaimExpiresAt,
    );
  });

  it.each(["file", "clawpack"] as const)(
    "backs off a package after its %s URL throws without changing the originals",
    async (artifact) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const t = convexTest(schema, modules);
      const fixture = await seed(t, "package");
      const before = (await state(t, fixture.attemptId))!;
      const failingId = artifact === "file" ? fixture.storageId : fixture.archiveStorageId;
      await expect(
        handler(
          actionContext(t, async (id) => {
            if (id === failingId) throw new Error("package URL failure");
            return await realUrl(t)(id);
          }),
          { token, attemptId: fixture.attemptId },
        ),
      ).rejects.toThrow("package URL failure");
      const after = (await state(t, fixture.attemptId))!;
      expect(after.checkClaimExpiresAt).toBe(after.updatedAt + 300_000);
      expect(after.checkClaimLastError).toBe("Previous scanner failure");
      for (const key of [
        "files",
        "checks",
        "clawpackStorageId",
        "artifactFingerprint",
        "checkFailureCount",
        "status",
      ] as const)
        expect(after[key]).toEqual(before[key]);
      expect(await bytes(t, fixture.storageId)).toBe("synthetic retained original");
      expect(await bytes(t, fixture.archiveStorageId)).toBe("synthetic original archive");
    },
  );

  it("leaves a newer lease unchanged when an older URL request fails late", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    let replacement: Doc<"publishAttempts"> | null = null;
    await expect(
      handler(
        actionContext(t, async () => {
          const expiredLease = (await state(t, fixture.attemptId))!;
          vi.setSystemTime(expiredLease.checkClaimExpiresAt! + 1);
          await t.mutation(internal.publishAttempts.claimPendingPublishAttemptChecksInternal, {
            attemptId: fixture.attemptId,
            claimId: "newer-worker",
          });
          replacement = await state(t, fixture.attemptId);
          throw new Error("old URL failure");
        }),
        { token, attemptId: fixture.attemptId },
      ),
    ).rejects.toThrow("old URL failure");
    expect(await state(t, fixture.attemptId)).toEqual(replacement);
    expect(replacement).toMatchObject({ checkClaimId: "newer-worker", status: "pending_checks" });
  });

  it("keeps a newer recorded error instead of restoring stale history", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    await expect(
      handler(
        actionContext(t, async () => {
          await t.run(async (ctx) => {
            await ctx.db.patch(fixture.attemptId, {
              checkClaimLastError: "Newer scanner evidence",
            });
          });
          throw new Error("URL failure");
        }),
        { token, attemptId: fixture.attemptId },
      ),
    ).rejects.toThrow("URL failure");
    expect((await state(t, fixture.attemptId))?.checkClaimLastError).toBe("Newer scanner evidence");
  });

  it("records a safe phase summary when no previous error exists", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.attemptId, { checkClaimLastError: undefined });
    });
    const unsafeError = new Error(
      "URL failure https://signed.example.invalid/private?secret=fixture",
    );
    await expect(
      handler(
        actionContext(t, async () => {
          throw unsafeError;
        }),
        {
          token,
          attemptId: fixture.attemptId,
        },
      ),
    ).rejects.toBe(unsafeError);
    expect((await state(t, fixture.attemptId))?.checkClaimLastError).toBe(
      "Pre-publication claim handoff failed during files.",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("signed.example.invalid");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret=fixture");
  });

  it.each(
    [
      { order: "normal", preferences: [false, false] },
      { order: "worker slot", preferences: [true, false] },
      { order: "retry-only boundary", preferences: [true, true] },
    ].flatMap((order) =>
      [
        { kind: "skill", artifact: "file" },
        { kind: "package", artifact: "file" },
        { kind: "package", artifact: "clawpack" },
      ].map((fault) => ({ ...order, ...fault })),
    ),
  )(
    "keeps healthy $kind work moving under $order after repeated $artifact failures",
    async ({ kind, artifact, preferences }) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const t = convexTest(schema, modules);
      const bad = await seed(t, kind as "skill" | "package");
      const badOriginal = (await state(t, bad.attemptId))!;
      const failingId = artifact === "file" ? bad.storageId : bad.archiveStorageId;
      const ctx = actionContext(t, async (id) => {
        if (id === failingId) throw new Error("persistent head URL failure");
        return await realUrl(t)(id);
      });
      for (let cycle = 0; cycle < 3; cycle++) {
        const failClaim = () =>
          handler(ctx, { token, kind: kind as "skill" | "package", preferRetry: preferences[0] });
        if (cycle > 0) await expect(failClaim()).rejects.toThrow("persistent head URL failure");
        const healthy = await seed(t, kind as "skill" | "package");
        await t.run(async (db) => {
          await db.db.patch(healthy.attemptId, { createdAt: cycle + 2 });
        });
        if (cycle === 0) await expect(failClaim()).rejects.toThrow("persistent head URL failure");
        const backedOff = (await state(t, bad.attemptId))!;
        expect(backedOff.checkClaimExpiresAt).toBe(backedOff.updatedAt + 300_000);
        expect(backedOff.checkFailureCount).toBe(2);
        expect(backedOff.checkClaimLastError).toBe("Previous scanner failure");
        for (const key of ["files", "checks", "artifactFingerprint", "status"] as const)
          expect(backedOff[key]).toEqual(badOriginal[key]);
        await expect(
          handler(ctx, { token, kind: kind as "skill" | "package", preferRetry: preferences[1] }),
        ).resolves.toMatchObject({ attemptId: healthy.attemptId });
        await expect(
          handler(ctx, { token, kind: kind as "skill" | "package", preferRetry: true }),
        ).resolves.toBeNull();
        vi.setSystemTime(backedOff.checkClaimExpiresAt! + 1);
      }
    },
  );
  it.each(["skill", "package"] as const)(
    "treats empty ready-to-finalize %s claims as normal",
    async (kind) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      const t = convexTest(schema, modules);
      const fixture = await seed(t, kind, true);
      const getUrl = vi.fn().mockRejectedValue(new Error("must never resolve storage"));
      await expect(
        handler(actionContext(t, getUrl), { token, attemptId: fixture.attemptId }),
      ).resolves.toMatchObject({
        attemptId: fixture.attemptId,
        status: "ready_to_finalize",
        files: [],
      });
      expect(getUrl).not.toHaveBeenCalled();
      expect((await state(t, fixture.attemptId))?.checkClaimExpiresAt).toBeGreaterThan(Date.now());
    },
  );

  it.each(["skill", "package"] as const)(
    "keeps successful %s claim URLs and live leases",
    async (kind) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      const t = convexTest(schema, modules);
      const fixture = await seed(t, kind);
      const result = await t.action(api.publishAttempts.claimPrePublicationChecks, {
        token,
        attemptId: fixture.attemptId,
      });
      expect(result).toMatchObject({
        attemptId: fixture.attemptId,
        files: [{ url: expect.any(String), storageId: fixture.storageId }],
      });
      if (kind === "package") expect(result).toHaveProperty("clawpackUrl", expect.any(String));
      expect(result).not.toHaveProperty("clawpackStorageId");
      expect(result).not.toHaveProperty("previousCheckClaimLastError");
      expect((await state(t, fixture.attemptId))?.checkClaimExpiresAt).toBeGreaterThan(Date.now());
    },
  );

  it.each(["skill", "package"] as const)(
    "accepts %s attempts with no file or archive",
    async (kind) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      const t = convexTest(schema, modules);
      const fixture = await seed(t, kind, false, true);
      await expect(
        t.action(api.publishAttempts.claimPrePublicationChecks, {
          token,
          attemptId: fixture.attemptId,
        }),
      ).resolves.toMatchObject({ files: [], status: "pending_checks" });
    },
  );

  it.each([
    { kind: "skill", artifact: "file", previousFailures: 0 },
    { kind: "skill", artifact: "file", previousFailures: 2 },
    { kind: "package", artifact: "file", previousFailures: 0 },
    { kind: "package", artifact: "file", previousFailures: 2 },
    { kind: "package", artifact: "clawpack", previousFailures: 0 },
    { kind: "package", artifact: "clawpack", previousFailures: 2 },
  ] as const)(
    "preserves missing $kind $artifact worker accounting after $previousFailures failures",
    async ({ kind, artifact, previousFailures }) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      const t = convexTest(schema, modules);
      const fixture = await seed(t, kind);
      await t.run(async (ctx) => {
        await ctx.db.patch(fixture.attemptId, { checkFailureCount: previousFailures });
        await ctx.storage.delete(
          artifact === "file" ? fixture.storageId : fixture.archiveStorageId,
        );
      });
      const before = (await state(t, fixture.attemptId))!;
      const claimed = await t.action(api.publishAttempts.claimPrePublicationChecks, {
        token,
        attemptId: fixture.attemptId,
      });
      expect(claimed).toMatchObject(
        artifact === "file" ? { files: [{ url: null }] } : { clawpackUrl: null },
      );
      expect((await state(t, fixture.attemptId))?.checkClaimExpiresAt).toBeGreaterThan(Date.now());
      const runClawScan = vi.fn();
      const runTruffleHog = vi.fn();
      const client = {
        action: (ref: Parameters<typeof t.action>[0], args: never) => t.action(ref, args),
      } as unknown as Parameters<typeof processPrePublicationAttempt>[0];
      await processPrePublicationAttempt(
        client,
        token,
        claimed as Parameters<typeof processPrePublicationAttempt>[2],
        {
          runClawScan,
          runTruffleHog,
          writeWorkspace: vi.fn(),
        },
      );
      expect(runClawScan).not.toHaveBeenCalled();
      expect(runTruffleHog).not.toHaveBeenCalled();
      const after = (await state(t, fixture.attemptId))!;
      expect(after.checkFailureCount).toBe(previousFailures + 1);
      expect(after.status).toBe(previousFailures === 2 ? "failed" : "pending_checks");
      expect(after.checkClaimLastError).toContain(
        artifact === "file" ? "Artifact file unavailable" : "ClawPack artifact unavailable",
      );
      expect(after.checkClaimId).toBeUndefined();
      if (previousFailures === 2) expect(after.checkClaimExpiresAt).toBeUndefined();
      else expect(after.checkClaimExpiresAt).toBeGreaterThan(Date.now() + 290_000);
      for (const key of ["files", "artifactFingerprint", "expiresAt", "clawpackStorageId"] as const)
        expect(after[key]).toEqual(before[key]);
    },
  );

  it("preserves the original failure and lease if compensation cannot commit", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    const originalError = new Error("original URL error");
    const ctx = actionContext(
      t,
      async () => {
        throw originalError;
      },
      async (name) => {
        if (name.endsWith(":backoffFailedPrePublicationHandoffInternal"))
          throw new Error("synthetic compensation failure");
      },
    );
    await expect(handler(ctx, { token, attemptId: fixture.attemptId })).rejects.toBe(originalError);
    expect((await state(t, fixture.attemptId))?.checkClaimExpiresAt).toBeGreaterThan(Date.now());
    expect(log).toHaveBeenCalledWith(
      "[publish-attempt-claim-handoff]",
      expect.objectContaining({ backedOff: false, compensationFailed: true }),
    );
  });

  it("does not compensate when the claim mutation itself rejects", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    const before = await state(t, fixture.attemptId);
    const runMutation = vi.fn().mockRejectedValue(new Error("mutation rejected before commit"));
    await expect(
      handler({ runMutation } as unknown as ActionCtx, { token, attemptId: fixture.attemptId }),
    ).rejects.toThrow("mutation rejected before commit");
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(await state(t, fixture.attemptId)).toEqual(before);
  });

  it("leaves successful claims active when the caller loses the result after return", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    await expect(
      (async () => {
        await t.action(api.publishAttempts.claimPrePublicationChecks, {
          token,
          attemptId: fixture.attemptId,
        });
        throw new Error("synthetic lost result after return");
      })(),
    ).rejects.toThrow("synthetic lost result after return");
    expect((await state(t, fixture.attemptId))?.checkClaimExpiresAt).toBeGreaterThan(Date.now());
  });

  it.each([false, true])(
    "rejects unauthorized workers before any claim (missing configured token=%s)",
    async (missing) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", missing ? "" : token);
      const t = convexTest(schema, modules);
      const fixture = await seed(t);
      const before = await state(t, fixture.attemptId);
      await expect(
        t.action(api.publishAttempts.claimPrePublicationChecks, {
          token: missing ? token : "wrong",
          attemptId: fixture.attemptId,
        }),
      ).rejects.toThrow("Unauthorized");
      expect(await state(t, fixture.attemptId)).toEqual(before);
    },
  );

  it.each(["pending_checks", "ready_to_finalize"] as const)(
    "preserves a genuine active foreign %s claim",
    async (status) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      const t = convexTest(schema, modules);
      const fixture = await seed(t, "skill", status === "ready_to_finalize");
      await t.run(
        async (ctx) =>
          await ctx.db.patch(fixture.attemptId, {
            checkClaimId: "genuine-worker",
            checkClaimedAt: Date.now(),
            checkClaimExpiresAt: Date.now() + 60_000,
          }),
      );
      const before = await state(t, fixture.attemptId);
      await expect(
        t.action(api.publishAttempts.claimPrePublicationChecks, {
          token,
          attemptId: fixture.attemptId,
          preferRetry: true,
        }),
      ).resolves.toBeNull();
      expect(await state(t, fixture.attemptId)).toEqual(before);
    },
  );

  it.each([{ kind: "package" as const }, { slug: "wrong-slug" }, { version: "9.9.9" }])(
    "preserves targeted identity filtering %j",
    async (filter) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
      const t = convexTest(schema, modules);
      const fixture = await seed(t);
      const before = await state(t, fixture.attemptId);
      await expect(
        t.action(api.publishAttempts.claimPrePublicationChecks, {
          token,
          attemptId: fixture.attemptId,
          ...filter,
        }),
      ).rejects.toThrow("does not match");
      expect(await state(t, fixture.attemptId)).toEqual(before);
    },
  );

  it("returns null for no work and keeps retry-first selection ahead of ready work", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.publishAttempts.claimPrePublicationChecks, { token }),
    ).resolves.toBeNull();
    const ready = await seed(t, "skill", true);
    const retry = await seed(t);
    await t.run(
      async (ctx) =>
        await ctx.db.patch(retry.attemptId, {
          checkClaimId: "expired",
          checkClaimExpiresAt: Date.now() - 1,
        }),
    );
    await expect(
      t.action(api.publishAttempts.claimPrePublicationChecks, { token, preferRetry: true }),
    ).resolves.toMatchObject({ attemptId: retry.attemptId });
    expect((await state(t, ready.attemptId))?.checkClaimId).toBeUndefined();
  });
});

describe("exact failed-handoff compensation guard", () => {
  it.each([
    "claim",
    "fingerprint",
    "kind",
    "status",
    "generation",
    "expired",
    "finalizing",
    "finalized",
    "blocked",
    "failed",
    "deleted",
  ] as const)("does not change a mismatching or advanced %s attempt", async (change) => {
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    await t.mutation(internal.publishAttempts.claimPendingPublishAttemptChecksInternal, {
      attemptId: fixture.attemptId,
      claimId: "failed-handoff",
    });
    const original = (await state(t, fixture.attemptId))!;
    const args = backoffArgs(original);
    await t.run(async (ctx) => {
      if (change === "deleted") return await ctx.db.delete(fixture.attemptId);
      const patch =
        change === "claim"
          ? { checkClaimId: "replacement-worker" }
          : change === "fingerprint"
            ? { artifactFingerprint: "replacement-artifact" }
            : change === "kind"
              ? { kind: "package" as const }
              : change === "status"
                ? { status: "ready_to_finalize" as const }
                : change === "generation"
                  ? { checkClaimExpiresAt: original.checkClaimExpiresAt! + 1 }
                  : change === "expired"
                    ? { checkClaimExpiresAt: Date.now() - 1 }
                    : { status: change };
      await ctx.db.patch(fixture.attemptId, patch as Partial<Doc<"publishAttempts">>);
    });
    const before = await state(t, fixture.attemptId);
    await expect(
      t.mutation(internal.publishAttempts.backoffFailedPrePublicationHandoffInternal, args),
    ).resolves.toEqual({ backedOff: false });
    expect(await state(t, fixture.attemptId)).toEqual(before);
  });

  it("does not release another attempt and is idempotent after an exact release", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    const other = await seed(t);
    await t.mutation(internal.publishAttempts.claimPendingPublishAttemptChecksInternal, {
      attemptId: fixture.attemptId,
      claimId: "failed-handoff",
    });
    const args = backoffArgs((await state(t, fixture.attemptId))!);
    const before = await state(t, other.attemptId);
    await expect(
      t.mutation(internal.publishAttempts.backoffFailedPrePublicationHandoffInternal, {
        ...args,
        attemptId: other.attemptId,
      }),
    ).resolves.toEqual({ backedOff: false });
    expect(await state(t, other.attemptId)).toEqual(before);
    await expect(
      t.mutation(internal.publishAttempts.backoffFailedPrePublicationHandoffInternal, args),
    ).resolves.toEqual({ backedOff: true });
    const released = await state(t, fixture.attemptId);
    await expect(
      t.mutation(internal.publishAttempts.backoffFailedPrePublicationHandoffInternal, args),
    ).resolves.toEqual({ backedOff: false });
    expect(await state(t, fixture.attemptId)).toEqual(released);
  });
});
