/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type JobSeed = Pick<Doc<"securityScanJobs">, "source"> &
  Partial<Pick<Doc<"securityScanJobs">, "hasMaliciousSignal" | "nextRunAt">>;

async function seedJobs(seeds: Record<string, JobSeed>) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const ids = await t.run(async (ctx) => {
    const entries: Array<[string, Id<"securityScanJobs">]> = [];
    let order = 0;
    for (const [name, seed] of Object.entries(seeds)) {
      order += 1;
      entries.push([
        name,
        await ctx.db.insert("securityScanJobs", {
          targetKind: "skillVersion",
          status: "queued",
          source: seed.source,
          priority: 0,
          hasMaliciousSignal: seed.hasMaliciousSignal ?? false,
          nextRunAt: seed.nextRunAt ?? order,
          attempts: 0,
          createdAt: order,
          updatedAt: order,
        }),
      ]);
    }
    return Object.fromEntries(entries);
  });
  const nameOf = new Map(Object.entries(ids).map(([name, id]) => [id, name]));
  return { t, ids, nameOf };
}

function claimLeases(
  t: ReturnType<typeof convexTest>,
  args: { workerId: string; lane: "shared" | "priority"; limit: number },
) {
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "fixture-worker-token");
  return t.action(api.securityScan.claimCodexScanJobLeases, {
    token: "fixture-worker-token",
    ...args,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

it("claims queued work in source priority order through the planned path", async () => {
  const { t, nameOf } = await seedJobs({
    backfill: { source: "backfill" },
    publish: { source: "publish" },
    maliciousBulk: { source: "bulk-rescan", hasMaliciousSignal: true },
    manual: { source: "manual" },
    future: { source: "manual", nextRunAt: Number.MAX_SAFE_INTEGER },
  });

  const first = await claimLeases(t, { workerId: "worker-1", lane: "shared", limit: 3 });
  expect(first.map((job) => nameOf.get(job._id))).toEqual(["manual", "maliciousBulk", "publish"]);
  expect(first.every((job) => job.status === "running" && job.workerId === "worker-1")).toBe(true);

  const second = await claimLeases(t, { workerId: "worker-2", lane: "shared", limit: 3 });
  // A short queue returns a short claim; the future job is never leased.
  expect(second.map((job) => nameOf.get(job._id))).toEqual(["backfill"]);
});

it("keeps bulk sources out of the priority lane", async () => {
  const { t, nameOf } = await seedJobs({
    backfill: { source: "backfill" },
    bulk: { source: "bulk-rescan" },
    publish: { source: "publish" },
  });

  const priority = await claimLeases(t, { workerId: "priority-0", lane: "priority", limit: 4 });
  expect(priority.map((job) => nameOf.get(job._id))).toEqual(["publish"]);
  await expect(
    claimLeases(t, { workerId: "priority-0", lane: "priority", limit: 4 }),
  ).resolves.toEqual([]);
});

it("skips candidates another worker leased after planning", async () => {
  const { t, ids, nameOf } = await seedJobs({
    one: { source: "backfill" },
    two: { source: "backfill" },
    three: { source: "backfill" },
  });
  const plan = await t.query(internal.securityScan.planCodexScanClaimsInternal, {
    lane: "shared",
    limit: 2,
  });
  expect(plan.requiresLegacyClaim).toBe(false);
  expect(plan.candidates.map((candidate) => nameOf.get(candidate.jobId))).toEqual([
    "one",
    "two",
    "three",
  ]);

  await t.mutation(internal.securityScan.claimPlannedJobsInternal, {
    workerId: "winner",
    lane: "shared",
    limit: 1,
    jobIds: [ids.one],
  });
  const result = await t.mutation(internal.securityScan.claimPlannedJobsInternal, {
    workerId: "loser",
    lane: "shared",
    limit: 2,
    jobIds: plan.candidates.map((candidate) => candidate.jobId),
  });

  expect(result.staleCount).toBe(1);
  expect(result.jobs.map((job) => nameOf.get(job._id))).toEqual(["two", "three"]);
  const winner = await t.run((ctx) => ctx.db.get(ids.one));
  expect(winner).toMatchObject({ status: "running", workerId: "winner", attempts: 1 });
});

it("refuses priority-lane admission of a planned bulk job", async () => {
  const { t, ids } = await seedJobs({ backfill: { source: "backfill" } });
  const result = await t.mutation(internal.securityScan.claimPlannedJobsInternal, {
    workerId: "priority-0",
    lane: "priority",
    limit: 1,
    jobIds: [ids.backfill],
  });
  expect(result).toEqual({ jobs: [], staleCount: 1 });
  await expect(t.run((ctx) => ctx.db.get(ids.backfill))).resolves.toMatchObject({
    status: "queued",
  });
});
