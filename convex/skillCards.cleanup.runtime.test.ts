/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const token = "synthetic-card-worker";

afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { handle: "card-fixture" });
    const skillId = await ctx.db.insert("skills", {
      slug: "card-fixture",
      displayName: "Card fixture",
      ownerUserId: ownerId,
      tags: {},
      stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const sourceId = await ctx.storage.store(new Blob(["# Source\n"]));
    const versionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: "1.0.0",
      changelog: "Initial",
      parsed: { frontmatter: {}, metadata: { settings: { zeta: 2, alpha: 1 } } },
      files: [{ path: "SKILL.md", size: 9, storageId: sourceId, sha256: "a".repeat(64) }],
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "clean",
        engineVersion: "fixture",
        checkedAt: 1,
      },
      llmAnalysis: { status: "clean", summary: "No risks", checkedAt: 1 },
      createdBy: ownerId,
      createdAt: 1,
    });
    const jobId = await ctx.db.insert("skillCardGenerationJobs", {
      skillId,
      skillVersionId: versionId,
      status: "running",
      source: "manual",
      priority: 1,
      nextRunAt: 1,
      attempts: 1,
      leaseToken: "current-lease",
      leaseExpiresAt: Date.now() + 60_000,
      createdAt: 1,
      updatedAt: 1,
    });
    return { ownerId, skillId, sourceId, versionId, jobId };
  });
  return { t, ...ids };
}

it.each(["stale-lease", "deleted-version", "missing-version"])(
  "removes the new blob after a %s attachment rejection",
  async (failure) => {
    const { t, sourceId, versionId, jobId } = await fixture();
    await t.run(async (ctx) => {
      if (failure === "deleted-version") await ctx.db.patch(versionId, { softDeletedAt: 2 });
      if (failure === "missing-version") await ctx.db.delete(versionId);
    });
    await expect(
      t.action(api.skillCards.completeSkillCardJob, {
        token,
        jobId,
        leaseToken: failure === "stale-lease" ? "expired-lease" : "current-lease",
        markdown: "# Rejected card\n",
      }),
    ).rejects.toThrow(failure === "stale-lease" ? "Lease mismatch" : "Skill version not found");
    const blobs = await t.run((ctx) => ctx.db.system.query("_storage").collect());
    expect(blobs.map((blob) => blob._id)).toEqual([sourceId]);
    expect(await t.run(async (ctx) => (await ctx.storage.get(sourceId))?.text())).toBe(
      "# Source\n",
    );
    expect(await t.run(async (ctx) => (await ctx.db.get(jobId))?.status)).toBe("running");
  },
);

it("retains successful cards and historical fingerprints when a later card replaces them", async () => {
  const { t, versionId, jobId } = await fixture();
  await t.action(api.skillCards.completeSkillCardJob, {
    token,
    jobId,
    leaseToken: "current-lease",
    markdown: "# First card\n",
  });
  const firstVersion = await t.run((ctx) => ctx.db.get(versionId));
  const firstFingerprints = await t.run((ctx) =>
    ctx.db.query("skillVersionFingerprints").collect(),
  );
  expect(firstFingerprints).toHaveLength(1);
  const firstCard = firstVersion!.files.find((file) => file.path === "skill-card.md")!;
  expect(await t.run(async (ctx) => (await ctx.storage.get(firstCard.storageId))?.text())).toBe(
    "# First card\n",
  );
  await t.run((ctx) => ctx.db.patch(jobId, { status: "running", leaseToken: "next-lease" }));
  await t.action(api.skillCards.completeSkillCardJob, {
    token,
    jobId,
    leaseToken: "next-lease",
    markdown: "# Second card\n",
  });
  const version = await t.run((ctx) => ctx.db.get(versionId));
  const currentCard = version!.files.find((file) => file.path === "skill-card.md")!;
  expect(currentCard.storageId).not.toBe(firstCard.storageId);
  expect(await t.run(async (ctx) => (await ctx.storage.get(currentCard.storageId))?.text())).toBe(
    "# Second card\n",
  );
  expect(await t.run(async (ctx) => (await ctx.storage.get(firstCard.storageId))?.text())).toBe(
    "# First card\n",
  );
  const fingerprints = await t.run((ctx) => ctx.db.query("skillVersionFingerprints").collect());
  expect(fingerprints).toHaveLength(2);
  expect(fingerprints.map((entry) => entry.fingerprint)).toEqual(
    expect.arrayContaining(firstFingerprints.map((entry) => entry.fingerprint)),
  );
  expect(await t.run(async (ctx) => (await ctx.db.get(jobId))?.status)).toBe("succeeded");
});

const generationHash = "1".repeat(64);

async function generatedFixture() {
  const fixtureState = await fixture();
  const { t, jobId } = fixtureState;
  await t.mutation(internal.skillCards.prepareJobTargetInternal, {
    jobId,
    leaseToken: "current-lease",
    generationHash,
  });
  await t.action(api.skillCards.completeSkillCardJob, {
    token,
    jobId,
    leaseToken: "current-lease",
    markdown: "# Certified card\n",
  });
  return fixtureState;
}

async function enqueueAndClaim(
  { t, versionId }: Awaited<ReturnType<typeof fixture>>,
  recipe = generationHash,
) {
  await t.mutation(internal.skillCards.enqueueForVersionInternal, { versionId, source: "scan" });
  return t.action(api.skillCards.claimSkillCardJobs, {
    token,
    workerId: "fixture",
    limit: 1,
    generationHash: recipe,
  });
}

it("reuses a completed card across timestamps, object key ordering and fresh scan bookkeeping", async () => {
  const state = await generatedFixture();
  const before = await state.t.run((ctx) => ctx.db.get(state.versionId));
  const files = [...before!.files];
  files.reverse();
  await state.t.run((ctx) =>
    ctx.db.patch(state.versionId, {
      llmAnalysis: { checkedAt: 999, model: "new-scanner", summary: "No risks", status: "clean" },
      staticScan: { ...before!.staticScan!, checkedAt: 999 },
      parsed: { frontmatter: {}, metadata: { settings: { alpha: 1, zeta: 2 } } },
      files,
    }),
  );
  const receipt = (await enqueueAndClaim(state))[0];
  expect(receipt).toMatchObject({ reused: true });
  expect(receipt).not.toHaveProperty("target");
  expect(await state.t.run((ctx) => ctx.db.get(receipt.job._id))).toMatchObject({
    status: "succeeded",
    attempts: 0,
  });
  const after = await state.t.run((ctx) => ctx.db.get(state.versionId));
  expect(after!.skillCardGeneration).toEqual(before!.skillCardGeneration);
  expect(after!.files.find((file) => file.path === "skill-card.md")).toEqual(
    before!.files.find((file) => file.path === "skill-card.md"),
  );
});

it.each(["source", "security", "publisher", "metadata", "recipe", "attached-card"])(
  "regenerates when %s changes",
  async (change) => {
    const state = await generatedFixture();
    await state.t.run(async (ctx) => {
      const version = (await ctx.db.get(state.versionId))!;
      if (change === "source" || change === "attached-card") {
        await ctx.db.patch(state.versionId, {
          files: version.files.map((file) =>
            file.path === (change === "source" ? "SKILL.md" : "skill-card.md")
              ? { ...file, sha256: "f".repeat(64) }
              : file,
          ),
        });
      }
      if (change === "security")
        await ctx.db.patch(state.versionId, {
          llmAnalysis: { ...version.llmAnalysis!, summary: "New risk evidence" },
        });
      if (change === "publisher")
        await ctx.db.patch(state.ownerId, { handle: "renamed-publisher" });
      if (change === "metadata")
        await ctx.db.patch(state.skillId, { summary: "Changed capability" });
    });
    const receipt = (
      await enqueueAndClaim(state, change === "recipe" ? "2".repeat(64) : generationHash)
    )[0];
    expect(receipt).toHaveProperty("target");
    expect(receipt).not.toHaveProperty("reused");
    expect(await state.t.run((ctx) => ctx.db.get(receipt.job._id))).toMatchObject({
      status: "running",
      attempts: 1,
    });
  },
);

it("discards stale generated output, releases its lease, and regenerates changed evidence", async () => {
  const state = await generatedFixture();
  const jobs = await enqueueAndClaim(state, "2".repeat(64));
  const job = jobs[0].job;
  const beforeBlobs = await state.t.run((ctx) => ctx.db.system.query("_storage").collect());
  const beforeVersion = await state.t.run((ctx) => ctx.db.get(state.versionId));
  await state.t.run((ctx) =>
    ctx.db.patch(state.skillId, { summary: "Changed while model was running" }),
  );
  expect(
    await state.t.action(api.skillCards.completeSkillCardJob, {
      token,
      jobId: job._id,
      leaseToken: job.leaseToken!,
      markdown: "# Stale result\n",
    }),
  ).toMatchObject({ requeued: true });
  expect(await state.t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual(
    beforeBlobs,
  );
  expect((await state.t.run((ctx) => ctx.db.get(state.versionId)))!.files).toEqual(
    beforeVersion!.files,
  );
  expect(await state.t.run((ctx) => ctx.db.get(job._id))).toMatchObject({
    status: "queued",
    attempts: 0,
  });
  const next = (
    await state.t.action(api.skillCards.claimSkillCardJobs, {
      token,
      workerId: "next",
      limit: 1,
      generationHash: "2".repeat(64),
    })
  )[0];
  expect(next).toHaveProperty("target");
  expect(next.job.leaseToken).not.toBe(job.leaseToken);
  await expect(
    state.t.action(api.skillCards.completeSkillCardJob, {
      token,
      jobId: job._id,
      leaseToken: job.leaseToken!,
      markdown: "# Late stale result\n",
    }),
  ).rejects.toThrow("Lease mismatch");
});

it("defers unsettled inputs without consuming the failure budget", async () => {
  const state = await fixture();
  await state.t.run(async (ctx) => {
    await ctx.db.patch(state.versionId, { llmAnalysis: { status: "pending", checkedAt: 2 } });
    await ctx.db.patch(state.jobId, { attempts: 3 });
  });
  expect(
    await state.t.mutation(internal.skillCards.prepareJobTargetInternal, {
      jobId: state.jobId,
      leaseToken: "current-lease",
      generationHash,
    }),
  ).toEqual({ deferred: true });
  const job = await state.t.run((ctx) => ctx.db.get(state.jobId));
  expect(job).toMatchObject({ status: "queued", attempts: 0 });
  expect(job!.leaseToken).toBeUndefined();
  expect(job!.nextRunAt).toBeGreaterThan(Date.now());
});

it("does not certify a legacy worker's unknown recipe during a rolling deployment", async () => {
  const state = await generatedFixture();
  await state.t.mutation(internal.skillCards.enqueueForVersionInternal, {
    versionId: state.versionId,
    source: "scan",
  });
  const legacy = (
    await state.t.action(api.skillCards.claimSkillCardJobs, {
      token,
      workerId: "old-checkout",
      limit: 1,
    })
  )[0];
  expect(legacy).toHaveProperty("target");
  await state.t.action(api.skillCards.completeSkillCardJob, {
    token,
    jobId: legacy.job._id,
    leaseToken: legacy.job.leaseToken!,
    markdown: "# Legacy card\n",
  });
  expect(
    (await state.t.run((ctx) => ctx.db.get(state.versionId)))!.skillCardGeneration,
  ).toBeUndefined();
  expect((await enqueueAndClaim(state))[0]).toHaveProperty("target");
});

it("returns progress for a fully reused batch and leaves later real work discoverable", async () => {
  const state = await generatedFixture();
  await state.t.mutation(internal.skillCards.enqueueForVersionInternal, {
    versionId: state.versionId,
    source: "scan",
    priority: 1,
  });
  const nextVersionId = await state.t.run(async (ctx) => {
    const {
      _id,
      _creationTime,
      skillCardGeneration: _receipt,
      ...version
    } = (await ctx.db.get(state.versionId))!;
    return ctx.db.insert("skillVersions", {
      ...version,
      version: "2.0.0",
      files: version.files.filter((file) => file.path !== "skill-card.md"),
    });
  });
  await state.t.mutation(internal.skillCards.enqueueForVersionInternal, {
    versionId: nextVersionId,
    source: "scan",
  });
  const first = await state.t.action(api.skillCards.claimSkillCardJobs, {
    token,
    workerId: "drain",
    limit: 1,
    generationHash,
  });
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({ reused: true });
  const second = await state.t.action(api.skillCards.claimSkillCardJobs, {
    token,
    workerId: "drain",
    limit: 1,
    generationHash,
  });
  expect(second).toHaveLength(1);
  expect(second[0].job.skillVersionId).toBe(nextVersionId);
  expect(second[0]).toHaveProperty("target");
});
