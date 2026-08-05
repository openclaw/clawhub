/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const CONFIRM = "manage-claw-590-canonical-trending-test-proof";
const SNAPSHOT_ID = `claw-590-proof-${"a".repeat(40)}`;

beforeEach(() => {
  vi.stubEnv("CLAWHUB_ENV", "test");
  vi.stubEnv("CLAWHUB_DISABLE_CRONS", "1");
  vi.stubEnv("CLAWHUB_DEPLOYMENT_NAME", "academic-chihuahua-392");
  vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CLAW-590 permanent Test snapshot ownership", () => {
  it("seeds and removes an exact owned 20-row source corpus", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(internal.canonicalTrendingTestFixtures.seedCanonicalTrendingSourceFixture, {
        confirm: CONFIRM,
      }),
    ).resolves.toEqual({ ok: true, created: true, nativeCount: 12, externalCount: 8 });
    await expect(
      t.query(internal.canonicalTrendingTestFixtures.readCanonicalTrendingSourceFixture, {
        confirm: CONFIRM,
      }),
    ).resolves.toMatchObject({
      present: true,
      nativeCount: 12,
      nativePublisherCount: 6,
      externalCount: 8,
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    await expect(
      t.mutation(internal.canonicalTrendingTestFixtures.seedCanonicalTrendingSourceFixture, {
        confirm: CONFIRM,
      }),
    ).resolves.toEqual({ ok: true, created: false, nativeCount: 12, externalCount: 8 });

    const materialized = await t.action(internal.canonicalTrending.materializeInternal, {
      proofSnapshotId: SNAPSHOT_ID,
    });
    if (materialized.status !== "ready") throw new Error("Expected ready fixture materialization");
    expect(materialized).toMatchObject({
      status: "ready",
      snapshotId: SNAPSHOT_ID,
      totalItems: 20,
      sourceCounts: { clawhubTrending: 12, clawhubRising: 12, skillsShTrending: 8 },
    });
    expect(materialized.sample.map((row) => row.lane)).toEqual([
      "clawhub-trending",
      "skills-sh-trending",
      "clawhub-rising",
      "clawhub-trending",
      "skills-sh-trending",
      "clawhub-trending",
      "skills-sh-trending",
      "clawhub-rising",
      "clawhub-trending",
      "skills-sh-trending",
      "clawhub-trending",
      "skills-sh-trending",
      "clawhub-rising",
      "clawhub-trending",
      "skills-sh-trending",
      "clawhub-trending",
      "skills-sh-trending",
      "clawhub-rising",
      "clawhub-trending",
      "skills-sh-trending",
    ]);
    await expect(
      t.action(internal.canonicalTrendingTestFixtures.cleanupCanonicalTrendingProof, {
        confirm: CONFIRM,
        snapshotId: SNAPSHOT_ID,
      }),
    ).resolves.toMatchObject({ ok: true, itemsDeleted: 20, snapshotDeleted: true });

    await expect(
      t.mutation(internal.canonicalTrendingTestFixtures.cleanupCanonicalTrendingSourceFixture, {
        confirm: CONFIRM,
      }),
    ).resolves.toEqual({
      ok: true,
      removed: true,
      nativeDeleted: 12,
      externalDeleted: 8,
      usersDeleted: 6,
    });
    await expect(
      t.query(internal.canonicalTrendingTestFixtures.readCanonicalTrendingSourceFixture, {
        confirm: CONFIRM,
      }),
    ).resolves.toEqual({ present: false });
  });

  it("reports an absent owned snapshot without broad reads", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.query(internal.canonicalTrendingTestFixtures.readCanonicalTrendingProof, {
        confirm: CONFIRM,
        snapshotId: SNAPSHOT_ID,
      }),
    ).resolves.toEqual({ present: false });
  });

  it("removes an exact owned snapshot and all item batches", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("canonicalTrendingSnapshots", {
        snapshotId: SNAPSHOT_ID,
        kind: "skills",
        status: "failed",
        rankingVersion: "skills-trending-v4",
        generatedAt: 1_000,
        completedAt: 2_000,
        expiresAt: Date.now() + 100_000,
        windowHours: 24,
        windowStartDay: 1,
        windowEndDay: 1,
        writtenItems: 0,
        error: "proof failure",
      });
    });

    await expect(
      t.action(internal.canonicalTrendingTestFixtures.cleanupCanonicalTrendingProof, {
        confirm: CONFIRM,
        snapshotId: SNAPSHOT_ID,
      }),
    ).resolves.toMatchObject({ ok: true, itemsDeleted: 0, snapshotDeleted: true, batches: 1 });
    await expect(
      t.query(internal.canonicalTrendingTestFixtures.readCanonicalTrendingProof, {
        confirm: CONFIRM,
        snapshotId: SNAPSHOT_ID,
      }),
    ).resolves.toEqual({ present: false });
  });

  it("rejects IDs outside the exact CLAW-590 proof namespace", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.query(internal.canonicalTrendingTestFixtures.readCanonicalTrendingProof, {
        confirm: CONFIRM,
        snapshotId: "skills-123",
      }),
    ).rejects.toThrow("Invalid CLAW-590 proof snapshot ID");
  });
});
