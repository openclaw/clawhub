/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const TEST_ENV = {
  CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
  CLAWHUB_DISABLE_CRONS: "1",
  CLAWHUB_ENV: "test",
  CONVEX_CLOUD_URL: "https://academic-chihuahua-392.convex.cloud",
};

function useTestEnvironment() {
  for (const [name, value] of Object.entries(TEST_ENV)) vi.stubEnv(name, value);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const githubRow = {
  externalId: "vercel-labs/skills/find-skills",
  sourceType: "github" as const,
  upstreamSourceType: "github",
  owner: "vercel-labs",
  repo: "skills",
  slug: "find-skills",
  displayName: "Find Skills",
  sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills",
  canonicalRepoUrl: "https://github.com/vercel-labs/skills",
  upstreamInstalls: 42,
  upstreamScanners: {
    genAgentTrustHub: {
      status: "pass",
      sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills/security/agent-trust-hub",
    },
    socket: {
      status: "pass",
      sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills/security/socket",
    },
    snyk: {
      status: "warn",
      sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills/security/snyk",
    },
  },
  inferredCategories: ["development"],
  inferredTopics: ["skill-discovery"],
  inferredCategoryConfidence: "high" as const,
  inferredTopicConfidence: "medium" as const,
  inferredClassifierVersion: "taxonomy-prototype-v9",
  inferredTopicClassifierVersion: "topic-prototype-v1",
  inferredInputHash: "github-input-hash",
  inferredTopicInputHash: "github-topic-input-hash",
  inferredAt: 123,
  sourceContentHash: "a".repeat(64),
  detail: {
    contentKind: "skill-md" as const,
    path: "SKILL.md",
    content: "# Find Skills",
    contentBytes: 13,
    sourceBytes: 13,
    sourceFileCount: 1,
    truncated: false,
  },
};

const wellKnownRow = {
  externalId: "open.feishu.cn/lark-doc",
  sourceType: "well-known" as const,
  upstreamSourceType: "well-known",
  sourceHost: "open.feishu.cn",
  slug: "lark-doc",
  displayName: "lark-doc",
  sourceUrl: "https://www.skills.sh/site/open.feishu.cn/lark-doc",
  upstreamInstalls: 7,
  upstreamScanners: {
    genAgentTrustHub: { status: "unavailable" },
    socket: { status: "unavailable" },
    snyk: { status: "unavailable" },
  },
  inferredCategories: ["productivity"],
  inferredTopics: ["documents"],
  inferredCategoryConfidence: "medium" as const,
  inferredTopicConfidence: "medium" as const,
  inferredClassifierVersion: "taxonomy-prototype-v9",
  inferredTopicClassifierVersion: "topic-prototype-v1",
  inferredInputHash: "well-known-input-hash",
  inferredTopicInputHash: "well-known-topic-input-hash",
  inferredAt: 123,
  sourceContentHash: "b".repeat(64),
  detail: {
    contentKind: "readme" as const,
    path: "README.md",
    content: "# Lark Doc",
    contentBytes: 10,
    sourceBytes: 10,
    sourceFileCount: 1,
    truncated: false,
  },
};

async function configure(t: ReturnType<typeof convexTest>) {
  return await t.mutation(internal.skillsShMirror.configureInternal, {
    actor: "codex-test",
    reason: "CLAW-563 mirror test",
    confirm: "enable-skills-sh-mirror-test",
    enabled: true,
    maxRowsPerRun: 10_000,
    maxRowsPerBatch: 50,
    maxDetailBytes: 64 * 1024,
  });
}

async function startRun(
  t: ReturnType<typeof convexTest>,
  snapshotId: string,
  sourceTotal = 2,
  sourceSnapshotHash?: string,
) {
  return (await t.mutation(internal.skillsShMirror.startRunInternal, {
    actor: "codex-test",
    reason: "CLAW-563 mirror test",
    snapshotId,
    ...(sourceSnapshotHash ? { sourceSnapshotHash } : {}),
    sourceTotal,
    sourcePageSize: 500,
    sourceMeasuredAt: "2026-07-22T20:14:10.881Z",
  })) as { runId: Id<"skillsShMirrorRuns"> };
}

const mirrorLeaseRefs = internal.skillsShMirror as unknown as {
  claimBatchLeaseInternal: Parameters<ReturnType<typeof convexTest>["mutation"]>[0];
  releaseBatchLeaseInternal: Parameters<ReturnType<typeof convexTest>["mutation"]>[0];
};

let leaseSequence = 0;

async function processBatch(
  t: ReturnType<typeof convexTest>,
  args: Omit<FunctionArgs<typeof internal.skillsShMirror.processBatchInternal>, "leaseToken">,
) {
  const leaseToken = `test-lease:${(leaseSequence += 1)}`;
  await t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
    runId: args.runId,
    page: args.page,
    offset: args.offset,
    leaseToken,
  });
  return await t.mutation(internal.skillsShMirror.processBatchInternal, {
    ...args,
    leaseToken,
  });
}

describe("skills.sh external mirror", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns the durable cursor summary when starting a run", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);

    const started = await t.mutation(internal.skillsShMirror.startRunInternal, {
      actor: "codex-test",
      reason: "CLAW-563 mirror test",
      snapshotId: "snapshot:start-summary",
      sourceTotal: 9_571,
      sourcePageSize: 500,
      sourceMeasuredAt: "2026-07-22T20:14:10.881Z",
    });

    expect(started).toMatchObject({
      snapshotId: "snapshot:start-summary",
      status: "running",
      sourceTotal: 9_571,
      sourcePageSize: 500,
      page: 0,
      offset: 0,
      completedAt: null,
    });
    expect(started.runId).toEqual(expect.any(String));
  });

  it("stores immutable source pages and returns them with the exact leased cursor", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const snapshotHash = "a".repeat(64);
    const rows = [
      {
        id: "vercel-labs/skills/find-skills",
        installUrl: "https://github.com/vercel-labs/skills",
        installs: 42,
        name: "Find Skills",
        slug: "find-skills",
        source: "vercel-labs/skills",
        sourceType: "github",
        url: "https://skills.sh/vercel-labs/skills/find-skills",
      },
    ];
    const identityHash = await sha256Hex(`${rows[0]!.id}\n`);
    const contentHash = await sha256Hex(JSON.stringify(rows));
    const sourcePage = {
      snapshotHash,
      page: 0,
      sourceTotal: 1,
      pageLength: 1,
      hasMore: false,
      identityHash,
      contentHash,
      sourceBytes: 512,
      serializedBytes: 768,
      rows,
    };

    await expect(
      t.mutation(internal.skillsShMirror.storeSourcePageInternal, sourcePage),
    ).resolves.toEqual({ stored: true, page: 0, rows: 1 });
    await expect(
      t.mutation(internal.skillsShMirror.storeSourcePageInternal, sourcePage),
    ).resolves.toEqual({ stored: false, page: 0, rows: 1 });
    await expect(
      t.mutation(internal.skillsShMirror.storeSourcePageInternal, {
        ...sourcePage,
        sourceBytes: sourcePage.sourceBytes + 1,
      }),
    ).rejects.toThrow("captured skills.sh source page is immutable");
    await expect(
      t.mutation(internal.skillsShMirror.storeSourcePageInternal, {
        ...sourcePage,
        contentHash: "d".repeat(64),
      }),
    ).rejects.toThrow("captured skills.sh source page content hash mismatch");

    const { runId } = await startRun(t, "skills-sh:proof:captured", 1, snapshotHash);
    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:captured",
      }),
    ).resolves.toMatchObject({
      sourcePage: {
        snapshotHash,
        page: 0,
        sourceTotal: 1,
        pageLength: 1,
        hasMore: false,
        identityHash,
        contentHash,
        rows,
      },
    });
    await expect(
      t.query(internal.skillsShMirror.getSourceCaptureSummaryInternal, { snapshotHash }),
    ).resolves.toEqual({
      snapshotHash,
      pageDocuments: 1,
      rows: 1,
      sourceBytes: 512,
      serializedBytes: 768,
    });
  });

  it("counts a captured-page lookup even when the controlled page has no source document", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const snapshotHash = "a".repeat(64);
    const { runId } = await startRun(t, "skills-sh:proof:controlled", 1, snapshotHash);
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { page: 1 });
    });

    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId,
        page: 1,
        offset: 0,
        leaseToken: "lease:controlled",
      }),
    ).resolves.toMatchObject({ sourcePage: null });
    const run = await t.run(async (ctx) => await ctx.db.get(runId));
    expect(run?.operations.dbReads).toBe(5);
  });

  it("cancels a stale captured run so a fresh authenticated run can start", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const stale = await startRun(t, "skills-sh-captured:missing-live-run");

    await expect(startRun(t, "skills-sh:fresh-blocked")).rejects.toThrow(
      "already has an active run",
    );
    await expect(
      t.mutation(internal.skillsShMirror.cancelRunInternal, {
        runId: stale.runId,
        actor: "codex-test",
        reason: "discard stale captured recovery",
        confirm: "cancel-skills-sh-mirror-test-run",
      }),
    ).resolves.toMatchObject({
      runId: stale.runId,
      status: "canceled",
    });
    await expect(startRun(t, "skills-sh:fresh-live")).resolves.toMatchObject({
      status: "running",
      snapshotId: "skills-sh:fresh-live",
    });
  });

  it("allows only one active batch lease for an exact durable cursor", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:lease", 1);

    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:first",
      }),
    ).resolves.toMatchObject({
      runId,
      page: 0,
      offset: 0,
      leaseExpiresAt: expect.any(Number),
    });
    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:second",
      }),
    ).rejects.toThrow("already leased");
  });

  it("renews an active batch lease when the same worker heartbeats", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:lease-renewal", 1);
    const first = (await t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
      runId,
      page: 0,
      offset: 0,
      leaseToken: "lease:worker",
    })) as {
      leaseExpiresAt: number;
      snapshotId: string;
      sourcePageSize: number;
      sourceTotal: number;
    };
    expect(first).toMatchObject({
      snapshotId: "snapshot:lease-renewal",
      sourcePageSize: 500,
      sourceTotal: 1,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { batchLeaseExpiresAt: first.leaseExpiresAt - 60_000 });
    });

    const renewed = (await t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
      runId,
      page: 0,
      offset: 0,
      leaseToken: "lease:worker",
    })) as { leaseExpiresAt: number };

    expect(renewed.leaseExpiresAt).toBeGreaterThan(first.leaseExpiresAt - 1_000);
  });

  it("permits stale lease takeover and rejects the superseded token", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:stale-lease", 1);
    await t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
      runId,
      page: 0,
      offset: 0,
      leaseToken: "lease:stale",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { batchLeaseExpiresAt: Date.now() - 1 });
    });

    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:fresh",
      }),
    ).resolves.toMatchObject({ leaseToken: "lease:fresh" });
    await expect(
      t.mutation(internal.skillsShMirror.processBatchInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:stale",
        pageLength: 1,
        hasMore: false,
        sourceTotal: 1,
        sourceRequests: 3,
        sourceBytes: 1_024,
        rows: [githubRow],
      }),
    ).rejects.toThrow("lease token mismatch");
  });

  it("requires the exact lease token to release or commit a batch", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:lease-token", 1);
    await t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
      runId,
      page: 0,
      offset: 0,
      leaseToken: "lease:owner",
    });

    await expect(
      t.mutation(mirrorLeaseRefs.releaseBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:wrong",
      }),
    ).rejects.toThrow("lease token mismatch");
    await expect(
      t.mutation(internal.skillsShMirror.processBatchInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:wrong",
        pageLength: 1,
        hasMore: false,
        sourceTotal: 1,
        sourceRequests: 3,
        sourceBytes: 1_024,
        rows: [githubRow],
      }),
    ).rejects.toThrow("lease token mismatch");

    await expect(
      t.mutation(mirrorLeaseRefs.releaseBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:owner",
      }),
    ).resolves.toMatchObject({ released: true });
    await expect(
      t.mutation(mirrorLeaseRefs.claimBatchLeaseInternal, {
        runId,
        page: 0,
        offset: 0,
        leaseToken: "lease:replacement",
      }),
    ).resolves.toMatchObject({ leaseToken: "lease:replacement" });

    const committed = await t.mutation(internal.skillsShMirror.processBatchInternal, {
      runId,
      page: 0,
      offset: 0,
      leaseToken: "lease:replacement",
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow],
    });
    expect(committed).toMatchObject({ status: "reconciling", page: 1, offset: 0 });
    const storedRun = await t.run(async (ctx) => await ctx.db.get(runId));
    expect(storedRun).not.toHaveProperty("batchLeaseToken");
    expect(storedRun).not.toHaveProperty("batchLeaseExpiresAt");
  });

  it("processes durable source cursors without creating scan work", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "skills-sh:proof:compact.evidence-hash.evidence");

    const result = await processBatch(t, {
      runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow, wellKnownRow],
    });

    expect(result).toMatchObject({
      status: "reconciling",
      page: 1,
      offset: 0,
      counts: {
        observed: 2,
        inserted: 2,
        conflicts: 0,
        scansPlanned: 0,
        scansAdmitted: 0,
      },
    });
    expect(
      await t.run(async (ctx) => await ctx.db.query("skillsShCatalogScanAttempts").collect()),
    ).toEqual([]);
    expect(await t.run(async (ctx) => await ctx.db.query("securityScanJobs").collect())).toEqual(
      [],
    );
    const storedSourceReferences = await t.run(async (ctx) => {
      const digest = await ctx.db
        .query("skillsShMirrorDigests")
        .withIndex("by_external_id", (q) => q.eq("externalId", githubRow.externalId))
        .unique();
      const detail = await ctx.db
        .query("skillsShMirrorDetails")
        .withIndex("by_external_id", (q) => q.eq("externalId", githubRow.externalId))
        .unique();
      return {
        digest: digest?.sourceSnapshotId,
        detail: detail?.sourceSnapshotId,
      };
    });
    expect(storedSourceReferences).toEqual({
      digest: "skills-sh:proof:compact.evidence-hash",
      detail: "skills-sh:proof:compact.evidence-hash",
    });
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      normalizedSlug: "find-skills",
      normalizedSlugFirstToken: "find",
      normalizedDisplayName: "find skills",
      normalizedDisplayNameFirstToken: "find",
      upstreamScanners: githubRow.upstreamScanners,
      inferredCategories: ["development"],
      inferredTopics: ["skill-discovery"],
    });
  });

  it("preserves classifier topic labels and indexes their normalized topic slugs", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:topic-labels", 1);
    const topicRow = {
      ...githubRow,
      inferredTopics: ["Code Review", "股票分析"],
    };

    await expect(
      processBatch(t, {
        runId,
        page: 0,
        offset: 0,
        pageLength: 1,
        hasMore: false,
        sourceTotal: 1,
        sourceRequests: 3,
        sourceBytes: 1_024,
        rows: [topicRow],
      }),
    ).resolves.toMatchObject({
      counts: {
        inserted: 1,
        rejected: 0,
        conflicts: 0,
      },
    });
    await expect(
      t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: topicRow.externalId,
      }),
    ).resolves.toMatchObject({
      inferredTopics: ["Code Review", "股票分析"],
    });

    for (const topic of ["Code Review", "股票分析"]) {
      const result = await t.query(internal.skillsShMirror.listActiveByTopicInternal, {
        topic,
        paginationOpts: { cursor: null, numItems: 10 },
      });
      expect(result.page.map((digest) => digest.externalId)).toEqual([topicRow.externalId]);
    }
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId,
      limit: 250,
    });
    await t.run(async (ctx) => {
      const digest = await ctx.db
        .query("skillsShMirrorDigests")
        .withIndex("by_external_id", (q) => q.eq("externalId", topicRow.externalId))
        .unique();
      if (!digest) throw new Error("topic digest missing");
      const canonical = await ctx.db
        .query("skillsShMirrorFacets")
        .withIndex("by_digest_id_and_kind_and_term", (q) => q.eq("digestId", digest._id))
        .filter((q) => q.eq(q.field("term"), "code-review"))
        .unique();
      if (!canonical) throw new Error("canonical topic facet missing");
      await ctx.db.delete(canonical._id);
      await ctx.db.insert("skillsShMirrorFacets", {
        digestId: canonical.digestId,
        externalId: canonical.externalId,
        kind: "topic",
        term: "code review",
        active: true,
        installs: canonical.installs,
        createdAt: canonical.createdAt,
        updatedAt: canonical.updatedAt,
      });
    });
    const replay = await startRun(t, "snapshot:topic-label-replay", 1);
    await processBatch(t, {
      runId: replay.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [topicRow],
    });
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query("skillsShMirrorFacets").collect())
          .filter((facet) => facet.kind === "topic" && facet.active)
          .map((facet) => facet.term)
          .sort(),
      ),
    ).toEqual(["code-review", "股票分析"]);
  });

  it("serves bounded active exact, prefix, first-token, and full-text recall", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:search");
    await processBatch(t, {
      runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 5,
      sourceBytes: 1_024,
      rows: [githubRow, wellKnownRow],
    });

    const externalIds = (rows: Doc<"skillsShMirrorDigests">[]) => rows.map((row) => row.externalId);
    expect(
      externalIds(
        await t.query(internal.skillsShMirror.listActiveByNormalizedSlugInternal, {
          value: "find-skills",
          limit: 10,
        }),
      ),
    ).toEqual([githubRow.externalId]);
    expect(
      externalIds(
        await t.query(internal.skillsShMirror.listActiveByNormalizedDisplayNameInternal, {
          value: "find skills",
          limit: 10,
        }),
      ),
    ).toEqual([githubRow.externalId]);
    expect(
      externalIds(
        await t.query(internal.skillsShMirror.listActiveByNormalizedSlugPrefixInternal, {
          prefix: "find",
          limit: 10,
        }),
      ),
    ).toEqual([githubRow.externalId]);
    expect(
      externalIds(
        await t.query(internal.skillsShMirror.listActiveByNormalizedDisplayNamePrefixInternal, {
          prefix: "find",
          limit: 10,
        }),
      ),
    ).toEqual([githubRow.externalId]);
    expect(
      externalIds(
        await t.query(internal.skillsShMirror.listActiveByNormalizedSlugFirstTokenPrefixInternal, {
          prefix: "fi",
          limit: 10,
        }),
      ),
    ).toEqual([githubRow.externalId]);
    expect(
      externalIds(
        await t.query(
          internal.skillsShMirror.listActiveByNormalizedDisplayNameFirstTokenPrefixInternal,
          {
            prefix: "fi",
            limit: 10,
          },
        ),
      ),
    ).toEqual([githubRow.externalId]);

    const fullText = (await t.query(internal.skillsShMirror.searchActiveBySearchTextInternal, {
      query: "vercel find",
      limit: 10,
    })) as Doc<"skillsShMirrorDigests">[];
    expect(fullText.map((row) => row.externalId)).toEqual([githubRow.externalId]);
    const byOwner = await t.query(internal.skillsShMirror.listActiveGithubByOwnerInternal, {
      owner: " VERCEL-LABS ",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(byOwner.page.map((row) => row.externalId)).toEqual([githubRow.externalId]);
    expect(byOwner.isDone).toBe(true);
    const byCategory = await t.query(internal.skillsShMirror.listActiveByCategoryInternal, {
      categorySlug: " DEVELOPMENT ",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(byCategory.page.map((row) => row.externalId)).toEqual([githubRow.externalId]);
    const byTopic = await t.query(internal.skillsShMirror.listActiveByTopicInternal, {
      topic: "skill-discovery",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(byTopic.page.map((row) => row.externalId)).toEqual([githubRow.externalId]);
    const byPopularity = await t.query(
      internal.skillsShMirror.listActiveByUpstreamInstallsInternal,
      { limit: 10 },
    );
    expect(byPopularity.map((row) => row.externalId)).toEqual([
      githubRow.externalId,
      wellKnownRow.externalId,
    ]);
    const classificationStates = await t.query(
      internal.skillsShMirror.getClassificationStatesInternal,
      { externalIds: [githubRow.externalId, "missing/repo/skill"] },
    );
    expect(classificationStates).toEqual([
      expect.objectContaining({
        externalId: githubRow.externalId,
        sourceContentHash: githubRow.sourceContentHash,
        inferredClassifierVersion: githubRow.inferredClassifierVersion,
      }),
    ]);
    const replayRows = await t.query(internal.skillsShMirror.getReplayRowsInternal, {
      externalIds: [githubRow.externalId],
    });
    expect(replayRows).toEqual([
      {
        digest: expect.objectContaining({
          externalId: githubRow.externalId,
          active: true,
        }),
        detail: expect.objectContaining({
          externalId: githubRow.externalId,
          content: githubRow.detail.content,
        }),
      },
    ]);
    await expect(
      t.query(internal.skillsShMirror.listActiveByNormalizedSlugPrefixInternal, {
        prefix: "",
        limit: 10,
      }),
    ).rejects.toThrow("prefix is required");
  });

  it("records a quarantined source row and continues the batch cursor", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:quarantine", 2);

    const result = await processBatch(t, {
      runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 4,
      sourceBytes: 2_048,
      rows: [
        {
          quarantined: true,
          externalId: "larksuite/cli/lark-doc",
          upstreamSourceType: "well-known",
          reason: "identity-page-fetch-failed",
        },
        githubRow,
      ],
    });

    expect(result).toMatchObject({
      status: "reconciling",
      page: 1,
      offset: 0,
      counts: {
        observed: 2,
        inserted: 1,
        rejected: 1,
        quarantined: 1,
        scansPlanned: 0,
        scansAdmitted: 0,
      },
    });
    expect(
      await t.run(async (ctx) => await ctx.db.query("skillsShMirrorConflicts").collect()),
    ).toEqual([
      expect.objectContaining({
        externalId: "larksuite/cli/lark-doc",
        kind: "source-quarantine",
        reason: "identity-page-fetch-failed",
      }),
    ]);
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: "larksuite/cli/lark-doc",
      }),
    ).toBeNull();
    expect(await t.query(internal.skillsShMirror.getStatusInternal, {})).toMatchObject({
      latestRunConflicts: [
        {
          externalId: "larksuite/cli/lark-doc",
          kind: "source-quarantine",
          reason: "identity-page-fetch-failed",
        },
      ],
    });
    expect(
      await t.query(internal.skillsShMirror.listConflictsByRunInternal, {
        runId,
        limit: 50,
      }),
    ).toEqual([
      expect.objectContaining({
        runId,
        externalId: "larksuite/cli/lark-doc",
        kind: "source-quarantine",
      }),
    ]);
  });

  it("removes stale detail when an available observation becomes missing before replay", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const firstRun = await startRun(t, "snapshot:detail-available", 1);
    await processBatch(t, {
      runId: firstRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: firstRun.runId,
      limit: 10,
    });

    const secondRun = await startRun(t, "snapshot:detail-missing", 1);
    await processBatch(t, {
      runId: secondRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 512,
      rows: [{ ...githubRow, detail: undefined }],
    });

    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({ detailStatus: "missing", lastObservedRunId: secondRun.runId });
    expect(
      await t.query(internal.skillsShMirror.getDetailByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toBeNull();
    expect(
      await t.query(internal.skillsShMirror.getReplayRowsInternal, {
        externalIds: [githubRow.externalId],
      }),
    ).toEqual([
      {
        digest: expect.objectContaining({ detailStatus: "missing" }),
        detail: null,
      },
    ]);
  });

  it("preserves an existing digest when identity-page transport is quarantined", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const firstRun = await startRun(t, "snapshot:before-transient-quarantine", 1);
    await processBatch(t, {
      runId: firstRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: firstRun.runId,
      limit: 10,
    });
    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("skillsShMirrorDigests")
        .withIndex("by_external_id", (q) => q.eq("externalId", githubRow.externalId))
        .unique();
      expect(existing).not.toBeNull();
      await ctx.db.patch(existing!._id, { upstreamSourceType: undefined });
    });

    const secondRun = await startRun(t, "snapshot:transient-quarantine", 1);
    const result = await processBatch(t, {
      runId: secondRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 2,
      sourceBytes: 1_024,
      rows: [
        {
          quarantined: true,
          externalId: githubRow.externalId,
          upstreamSourceType: "well-known",
          reason: "identity-page-fetch-failed",
        },
      ],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: secondRun.runId,
      limit: 10,
    });

    expect(result.counts).toMatchObject({
      quarantined: 1,
      quarantinedPreserved: 1,
      tombstoned: 0,
    });
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      active: true,
      lastObservedRunId: secondRun.runId,
      sourceFreshnessStatus: "stale",
      upstreamSourceType: "well-known",
    });
    expect(
      await t.query(internal.skillsShMirror.getDetailByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      lastObservedRunId: firstRun.runId,
    });

    const disappearanceRun = await startRun(t, "snapshot:disappearance-before-quarantine", 1);
    await processBatch(t, {
      runId: disappearanceRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [wellKnownRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: disappearanceRun.runId,
      limit: 10,
    });

    const inactiveQuarantineRun = await startRun(t, "snapshot:inactive-quarantine", 1);
    const inactiveResult = await processBatch(t, {
      runId: inactiveQuarantineRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 2,
      sourceBytes: 1_024,
      rows: [
        {
          quarantined: true,
          externalId: githubRow.externalId,
          upstreamSourceType: "well-known",
          reason: "identity-page-fetch-failed",
        },
      ],
    });
    expect(inactiveResult.counts.quarantinedPreserved).toBe(0);
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      active: false,
      lastObservedRunId: secondRun.runId,
    });
  });

  it("keeps a successful same-run observation authoritative over a later quarantine", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:same-run-quarantine", 2);

    const result = await processBatch(t, {
      runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 4,
      sourceBytes: 2_048,
      rows: [
        githubRow,
        {
          quarantined: true,
          externalId: githubRow.externalId,
          upstreamSourceType: "well-known",
          reason: "identity-page-http-404",
        },
      ],
    });

    expect(result.counts).toMatchObject({
      inserted: 1,
      quarantined: 1,
      quarantinedPreserved: 0,
    });
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      active: true,
      lastObservedRunId: runId,
      sourceFreshnessStatus: "observed-only",
    });
  });

  it("accepts a valid observation after preserving an earlier-run quarantined digest", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const firstRun = await startRun(t, "snapshot:before-quarantine-first", 1);
    await processBatch(t, {
      runId: firstRun.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: firstRun.runId,
      limit: 10,
    });

    const secondRun = await startRun(t, "snapshot:quarantine-first", 2);
    const result = await processBatch(t, {
      runId: secondRun.runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 4,
      sourceBytes: 2_048,
      rows: [
        {
          quarantined: true,
          externalId: githubRow.externalId,
          upstreamSourceType: "well-known",
          reason: "identity-page-fetch-failed",
        },
        { ...githubRow, upstreamInstalls: githubRow.upstreamInstalls + 1 },
      ],
    });

    expect(result.counts).toMatchObject({
      updated: 1,
      quarantined: 1,
      quarantinedPreserved: 0,
    });
    expect(
      await t.query(internal.skillsShMirror.getByExternalIdInternal, {
        externalId: githubRow.externalId,
      }),
    ).toMatchObject({
      active: true,
      lastObservedRunId: secondRun.runId,
      sourceFreshnessStatus: "observed-only",
      upstreamInstalls: githubRow.upstreamInstalls + 1,
    });
  });

  it("pauses and resumes from the exact page and offset", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:pause", 3);

    await processBatch(t, {
      runId,
      page: 0,
      offset: 0,
      pageLength: 3,
      hasMore: false,
      sourceTotal: 3,
      sourceRequests: 2,
      sourceBytes: 512,
      rows: [githubRow],
    });
    await t.mutation(internal.skillsShMirror.setPausedInternal, {
      runId,
      paused: true,
      actor: "codex-test",
      reason: "prove pause",
      confirm: "set-skills-sh-mirror-pause",
    });
    await expect(
      processBatch(t, {
        runId,
        page: 0,
        offset: 1,
        pageLength: 3,
        hasMore: false,
        sourceTotal: 3,
        sourceRequests: 2,
        sourceBytes: 512,
        rows: [wellKnownRow],
      }),
    ).rejects.toThrow("paused");
    await t.mutation(internal.skillsShMirror.setPausedInternal, {
      runId,
      paused: false,
      actor: "codex-test",
      reason: "resume exact cursor",
      confirm: "set-skills-sh-mirror-pause",
    });
    const resumed = await processBatch(t, {
      runId,
      page: 0,
      offset: 1,
      pageLength: 3,
      hasMore: false,
      sourceTotal: 3,
      sourceRequests: 2,
      sourceBytes: 512,
      rows: [wellKnownRow, { ...githubRow, externalId: "vercel-labs/skills/other", slug: "other" }],
    });
    expect(resumed).toMatchObject({ status: "reconciling", page: 1, offset: 0 });
  });

  it("records conflicting same-run observations instead of overwriting them", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:conflict", 2);

    await processBatch(t, {
      runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 2,
      sourceBytes: 512,
      rows: [githubRow],
    });
    const conflicted = await processBatch(t, {
      runId,
      page: 0,
      offset: 1,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 2,
      sourceBytes: 512,
      rows: [{ ...githubRow, upstreamInstalls: 99 }],
    });

    expect(conflicted).toMatchObject({
      status: "reconciling",
      counts: { observed: 2, conflicts: 1, rejected: 1 },
    });
    expect(
      await t.run(async (ctx) => await ctx.db.query("skillsShMirrorConflicts").collect()),
    ).toHaveLength(1);
  });

  it("tombstones disappeared rows and restores them on a later run", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const first = await startRun(t, "snapshot:all");
    await processBatch(t, {
      runId: first.runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow, wellKnownRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: first.runId,
      limit: 100,
    });

    const second = await startRun(t, "snapshot:missing", 1);
    await processBatch(t, {
      runId: second.runId,
      page: 0,
      offset: 0,
      pageLength: 1,
      hasMore: false,
      sourceTotal: 1,
      sourceRequests: 2,
      sourceBytes: 512,
      rows: [githubRow],
    });
    const reconciled = await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: second.runId,
      limit: 100,
    });
    expect(reconciled).toMatchObject({ status: "completed", counts: { tombstoned: 1 } });
    const activeFacets = await t.query(internal.skillsShMirror.listFacetsPageInternal, {
      cursor: null,
      limit: 500,
    });
    expect(activeFacets.page.every((facet) => facet.active)).toBe(true);
    expect(activeFacets.page.some((facet) => facet.externalId === wellKnownRow.externalId)).toBe(
      false,
    );

    const third = await startRun(t, "snapshot:return", 2);
    await processBatch(t, {
      runId: third.runId,
      page: 0,
      offset: 0,
      pageLength: 2,
      hasMore: false,
      sourceTotal: 2,
      sourceRequests: 3,
      sourceBytes: 1_024,
      rows: [githubRow, wellKnownRow],
    });
    await t.mutation(internal.skillsShMirror.reconcileBatchInternal, {
      runId: third.runId,
      limit: 100,
    });
    const restored = (await t.query(internal.skillsShMirror.getByExternalIdInternal, {
      externalId: wellKnownRow.externalId,
    })) as Doc<"skillsShMirrorDigests"> | null;
    expect(restored).toMatchObject({ active: true });
    expect(restored).not.toHaveProperty("tombstonedAt");
    expect(
      await t.query(internal.skillsShMirror.getRunInternal, { runId: third.runId }),
    ).toMatchObject({ counts: { reactivated: 1 } });
  });
});
