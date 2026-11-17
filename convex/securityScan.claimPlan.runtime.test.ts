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
  vi.useRealTimers();
});

function freezeClock() {
  const now = Date.UTC(2026, 10, 16);
  // Fake only the clock; convex-test still needs real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  return now;
}

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
    now: Date.now(),
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

it("does not let not-yet-due rows hide ready lower-tier work", async () => {
  const now = freezeClock();
  const seeds: Record<string, JobSeed> = {
    readyBulk: { source: "bulk-rescan", nextRunAt: now - 1 },
  };
  // More retries than the plan window, all due inside the planner's clock allowance.
  for (let index = 0; index < 200; index += 1) {
    seeds[`retry-${index}`] = { source: "backfill", nextRunAt: now + 500 };
  }
  const { t, nameOf } = await seedJobs(seeds);

  // A short claim ends a worker's refills, so the ready job must not be missed.
  const claimed = await claimLeases(t, { workerId: "worker-1", lane: "shared", limit: 4 });
  expect(claimed.map((job) => nameOf.get(job._id))).toEqual(["readyBulk"]);
});

it("plans only a claim's worth of not-yet-due rows per tier", async () => {
  const now = freezeClock();
  const seeds: Record<string, JobSeed> = {};
  for (let index = 0; index < 10; index += 1) {
    seeds[`early-${index}`] = { source: "manual", nextRunAt: now + 500 };
  }
  seeds.readyOne = { source: "backfill", nextRunAt: now - 2 };
  seeds.readyTwo = { source: "backfill", nextRunAt: now - 1 };
  const { t, nameOf } = await seedJobs(seeds);

  const plan = await t.query(internal.securityScan.planCodexScanClaimsInternal, {
    lane: "shared",
    limit: 2,
    now,
  });
  expect(plan.candidates.map((candidate) => nameOf.get(candidate.jobId))).toEqual([
    "early-0",
    "early-1",
    "readyOne",
    "readyTwo",
  ]);

  const claimed = await claimLeases(t, { workerId: "worker-1", lane: "shared", limit: 2 });
  // Candidates are shuffled within a tier, so the lease order is not fixed.
  expect(claimed).toHaveLength(2);
  expect(new Set(claimed.map((job) => nameOf.get(job._id)))).toEqual(
    new Set(["readyOne", "readyTwo"]),
  );
});

it("admits a row that a trailing action clock planned as not yet due", async () => {
  const now = freezeClock();
  const { t, nameOf } = await seedJobs({ enqueued: { source: "publish", nextRunAt: now } });

  // The action's clock can trail the mutation that enqueued the job.
  const plan = await t.query(internal.securityScan.planCodexScanClaimsInternal, {
    lane: "shared",
    limit: 1,
    now: now - 500,
  });
  expect(plan.candidates.map((candidate) => nameOf.get(candidate.jobId))).toEqual(["enqueued"]);

  const result = await t.mutation(internal.securityScan.claimPlannedJobsInternal, {
    workerId: "worker-1",
    lane: "shared",
    limit: 1,
    jobIds: plan.candidates.map((candidate) => candidate.jobId),
  });
  expect(result.jobs.map((job) => nameOf.get(job._id))).toEqual(["enqueued"]);
});
