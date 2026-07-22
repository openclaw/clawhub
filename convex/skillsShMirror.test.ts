/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
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

const githubRow = {
  externalId: "vercel-labs/skills/find-skills",
  sourceType: "github" as const,
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

async function startRun(t: ReturnType<typeof convexTest>, snapshotId: string, sourceTotal = 2) {
  return (await t.mutation(internal.skillsShMirror.startRunInternal, {
    actor: "codex-test",
    reason: "CLAW-563 mirror test",
    snapshotId,
    sourceTotal,
    sourcePageSize: 500,
    sourceMeasuredAt: "2026-07-22T20:14:10.881Z",
  })) as { runId: Id<"skillsShMirrorRuns"> };
}

describe("skills.sh external mirror", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("processes durable source cursors without creating scan work", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:first");

    const result = await t.mutation(internal.skillsShMirror.processBatchInternal, {
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
    });
  });

  it("pauses and resumes from the exact page and offset", async () => {
    useTestEnvironment();
    const t = convexTest(schema, modules);
    await configure(t);
    const { runId } = await startRun(t, "snapshot:pause", 3);

    await t.mutation(internal.skillsShMirror.processBatchInternal, {
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
      t.mutation(internal.skillsShMirror.processBatchInternal, {
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
    const resumed = await t.mutation(internal.skillsShMirror.processBatchInternal, {
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

    await t.mutation(internal.skillsShMirror.processBatchInternal, {
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
    const conflicted = await t.mutation(internal.skillsShMirror.processBatchInternal, {
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
    await t.mutation(internal.skillsShMirror.processBatchInternal, {
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
    await t.mutation(internal.skillsShMirror.processBatchInternal, {
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

    const third = await startRun(t, "snapshot:return", 2);
    await t.mutation(internal.skillsShMirror.processBatchInternal, {
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
