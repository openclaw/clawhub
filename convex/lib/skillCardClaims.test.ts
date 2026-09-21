import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { admitSkillCardClaims, planSkillCardClaims } from "./skillCardClaims";

const claimSchema = defineSchema({
  skills: defineTable({}),
  skillVersions: defineTable({}),
  skillCardGenerationJobs: schema.tables.skillCardGenerationJobs,
});

async function fixture(count: number) {
  const t = convexTest(claimSchema, import.meta.glob("../_generated/*.{js,ts}"));
  const ids = await t.run(async (ctx) => {
    const skillId = await ctx.db.insert("skills", {});
    const now = Date.now();
    const insertedIds: Id<"skillCardGenerationJobs">[] = [];
    for (let index = 0; index < count; index += 1) {
      const skillVersionId = await ctx.db.insert("skillVersions", {});
      insertedIds.push(
        await ctx.db.insert("skillCardGenerationJobs", {
          skillId,
          skillVersionId,
          status: "queued",
          source: "scan",
          priority: 0,
          nextRunAt: now - 1,
          attempts: 0,
          createdAt: now + index,
          updatedAt: now,
        }),
      );
    }
    return insertedIds;
  });
  const plan = (limit = 4) =>
    t.run((ctx) => planSkillCardClaims(ctx as never, { limit, now: Date.now() }));
  const admit = (p: Awaited<ReturnType<typeof plan>>, limit = 4) =>
    t.run((ctx) => admitSkillCardClaims(ctx as never, { ...p, limit, workerId: "worker" }));
  return { t, ids, plan, admit };
}

describe("Skill Card capacity ownership", () => {
  it("returns stale admission to discovery without reading other owners", async () => {
    const { t, plan, admit } = await fixture(20);
    const sharedPlan = await plan();
    const first = await admit(sharedPlan);
    const stale = await admit(sharedPlan);
    expect(stale).toEqual({ jobs: [], contended: true });
    const second = await admit(await plan());
    expect(first.jobs).toHaveLength(4);
    expect(second.jobs).toHaveLength(4);
    expect(new Set([...first.jobs, ...second.jobs].map((job) => job._id)).size).toBe(8);
    const running = await t.run((ctx) => ctx.db.query("skillCardGenerationJobs").collect());
    const active = running.filter((job) => job.status === "running");
    expect(new Set(active.map((job) => job.claimSlot)).size).toBe(8);
  });

  it("enforces 64 globally even when two plans saw the same free capacity", async () => {
    const { t, plan, admit } = await fixture(100);
    const stale = await plan(64);
    expect((await admit(stale, 64)).jobs).toHaveLength(64);
    expect((await admit(stale, 64)).jobs).toHaveLength(0);
    const jobs = await t.run((ctx) => ctx.db.query("skillCardGenerationJobs").collect());
    expect(jobs.filter((job) => job.status === "running")).toHaveLength(64);
  });

  it("counts an old writer arriving after discovery without reusing its capacity", async () => {
    const { t, ids, plan, admit } = await fixture(70);
    const stale = await plan(64);
    await t.run(async (ctx) => {
      for (const id of ids.slice(0, 60)) {
        await ctx.db.patch(id, {
          status: "running",
          leaseToken: "legacy",
          leaseExpiresAt: Date.now() + 60_000,
        });
      }
    });
    const staleResult = await admit(stale, 64);
    expect(staleResult).toEqual({ jobs: [], contended: true });
    const result = await admit(await plan(64), 64);
    expect(result.jobs).toHaveLength(4);
    const rows = await t.run((ctx) => ctx.db.query("skillCardGenerationJobs").collect());
    expect(rows.filter((job) => job.status === "running")).toHaveLength(64);
  });

  it("checks version ownership again after discovery", async () => {
    const { t, ids, plan, admit } = await fixture(3);
    await t.run(async (ctx) => {
      const first = await ctx.db.get(ids[0]);
      await ctx.db.patch(ids[1], { skillVersionId: first!.skillVersionId });
    });
    const stale = await plan();
    const result = await admit(stale);
    const next = await admit(await plan());
    expect([...result.jobs, ...next.jobs]).toHaveLength(2);
    expect(new Set([...result.jobs, ...next.jobs].map((job) => job.skillVersionId)).size).toBe(2);
  });

  it("reclaims an expired slot and rotates its lease exactly once", async () => {
    const { t, ids, plan, admit } = await fixture(1);
    await t.run((ctx) =>
      ctx.db.patch(ids[0], {
        status: "running",
        claimSlot: 7,
        attempts: 1,
        leaseToken: "expired",
        leaseExpiresAt: Date.now() - 1,
        workerId: "old-worker",
      }),
    );
    const result = await admit(await plan());
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].attempts).toBe(2);
    expect(result.jobs[0].leaseToken).not.toBe("expired");
    expect(result.jobs[0].workerId).toBe("worker");
  });

  it("finds eligible jobs behind followups of active versions", async () => {
    const { t, ids, plan, admit } = await fixture(41);
    await t.run(async (ctx) => {
      for (let index = 0; index < 20; index += 1) {
        const running = await ctx.db.get(ids[index]);
        await ctx.db.patch(ids[index], {
          status: "running",
          claimSlot: index,
          leaseToken: "active",
          leaseExpiresAt: Date.now() + 60_000,
        });
        await ctx.db.patch(ids[index + 20], { skillVersionId: running!.skillVersionId });
      }
    });
    expect((await admit(await plan(1), 1)).jobs.map((job) => job._id)).toEqual([ids[40]]);
  });

  it("fences a same-version lease that expired after discovery in another slot", async () => {
    vi.useFakeTimers();
    try {
      const { t, ids, plan, admit } = await fixture(2);
      await t.run(async (ctx) => {
        const first = await ctx.db.get(ids[0]);
        await ctx.db.patch(ids[1], { skillVersionId: first!.skillVersionId });
      });
      const stale = { ...(await plan()), jobIds: [ids[1]] };
      await t.run((ctx) =>
        ctx.db.patch(ids[0], {
          status: "running",
          claimSlot: 42,
          leaseToken: "late-worker",
          leaseExpiresAt: Date.now() + 1000,
        }),
      );
      vi.advanceTimersByTime(1001);
      const result = await admit(stale);
      expect(result.jobs.map((job) => job._id)).toEqual([ids[1]]);
      const expired = await t.run((ctx) => ctx.db.get(ids[0]));
      expect(expired?.status).toBe("queued");
      expect(expired?.leaseToken).toBeUndefined();
      expect(expired?.claimSlot).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the one hour default lease", async () => {
    vi.useFakeTimers();
    try {
      const { plan, admit } = await fixture(1);
      const now = Date.now();
      expect((await admit(await plan())).jobs[0].leaseExpiresAt).toBe(now + 60 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });
});
