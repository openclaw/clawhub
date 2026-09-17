import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const MAX_PARALLEL_SKILL_CARD_JOBS = 64;
const LOOKAHEAD = MAX_PARALLEL_SKILL_CARD_JOBS * 4;
type Job = Doc<"skillCardGenerationJobs">;

export type SkillCardClaimPlan = {
  jobIds: Id<"skillCardGenerationJobs">[];
  slots: number[];
  expiredJobIds: Id<"skillCardGenerationJobs">[];
};

export type SkillCardClaimResult = {
  jobs: Array<Job & { leaseToken: string }>;
  contended: boolean;
};

export async function planSkillCardClaims(
  ctx: QueryCtx,
  { limit, now }: { limit: number; now: number },
): Promise<SkillCardClaimPlan> {
  const active = await ctx.db
    .query("skillCardGenerationJobs")
    .withIndex("by_status_and_lease_expires_at", (q) =>
      q.eq("status", "running").gt("leaseExpiresAt", now),
    )
    .take(MAX_PARALLEL_SKILL_CARD_JOBS + 1);
  if (active.length >= MAX_PARALLEL_SKILL_CARD_JOBS) {
    return { jobIds: [], slots: [], expiredJobIds: [] };
  }
  const expired = await ctx.db
    .query("skillCardGenerationJobs")
    .withIndex("by_status_and_lease_expires_at", (q) =>
      q.eq("status", "running").lte("leaseExpiresAt", now),
    )
    .take(LOOKAHEAD);
  const queued = await ctx.db
    .query("skillCardGenerationJobs")
    .withIndex("by_status_and_next_run_at", (q) => q.eq("status", "queued").lte("nextRunAt", now))
    .take(Math.min(LOOKAHEAD, MAX_PARALLEL_SKILL_CARD_JOBS + limit * 4));
  const activeVersions = new Set(active.map((job) => job.skillVersionId));
  const occupiedSlots = new Set(active.map((job) => job.claimSlot));
  return {
    jobIds: [...queued, ...expired]
      .filter((job) => !activeVersions.has(job.skillVersionId))
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
      .slice(0, LOOKAHEAD)
      .map((job) => job._id),
    slots: Array.from({ length: MAX_PARALLEL_SKILL_CARD_JOBS }, (_, slot) => slot).filter(
      (slot) => !occupiedSlots.has(slot),
    ),
    expiredJobIds: expired.map((job) => job._id),
  };
}

async function releaseExpired(ctx: MutationCtx, job: Job, now: number) {
  if (job.status !== "running" || (job.leaseExpiresAt ?? 0) > now) return;
  await ctx.db.patch(job._id, {
    status: "queued",
    claimSlot: undefined,
    leaseToken: undefined,
    leaseExpiresAt: undefined,
    workerId: undefined,
    nextRunAt: now,
    updatedAt: now,
  });
}

export async function admitSkillCardClaims(
  ctx: MutationCtx,
  args: SkillCardClaimPlan & { workerId: string; limit: number; leaseMs?: number },
): Promise<SkillCardClaimResult> {
  const now = Date.now();
  const leaseMs = Math.max(60_000, Math.min(args.leaseMs ?? 60 * 60 * 1000, 60 * 60 * 1000));
  for (const jobId of args.expiredJobIds) {
    const job = await ctx.db.get(jobId);
    if (job) await releaseExpired(ctx, job, now);
  }

  // Pre-slot leases can coexist during deployment or rollback. Count all live
  // leases only while that exact legacy range exists; never reserve a slot
  // prefix whose size could change underneath already admitted jobs.
  const legacy = await ctx.db
    .query("skillCardGenerationJobs")
    .withIndex("by_status_and_claim_slot", (q) =>
      q.eq("status", "running").eq("claimSlot", undefined),
    )
    .first();
  let capacity = args.limit;
  if (legacy) {
    const active = await ctx.db
      .query("skillCardGenerationJobs")
      .withIndex("by_status_and_lease_expires_at", (q) =>
        q.eq("status", "running").gt("leaseExpiresAt", now),
      )
      .take(MAX_PARALLEL_SKILL_CARD_JOBS + 1);
    capacity = Math.min(capacity, Math.max(0, MAX_PARALLEL_SKILL_CARD_JOBS - active.length));
    if (capacity === 0) return { jobs: [], contended: false };
  }

  const jobs: SkillCardClaimResult["jobs"] = [];
  let slotIndex = 0;
  for (const jobId of args.jobIds) {
    if (jobs.length >= capacity) break;
    const job = await ctx.db.get(jobId);
    // A stale plan belongs back in discovery. Scanning onward would pull other
    // workers' changing leases into this mutation and recreate the broad read set.
    if (!job || job.status !== "queued" || job.nextRunAt > now) break;
    const sameVersion = await ctx.db
      .query("skillCardGenerationJobs")
      .withIndex("by_skill_version_status", (q) =>
        q.eq("skillVersionId", job.skillVersionId).eq("status", "running"),
      )
      .take(LOOKAHEAD + 1);
    if (
      sameVersion.length > LOOKAHEAD ||
      sameVersion.some((running) => (running.leaseExpiresAt ?? 0) > now)
    ) {
      break;
    }

    // Expiry discovered after planning must fence the old token before another
    // job for this version can commit, even when it owned a different slot.
    for (const running of sameVersion) await releaseExpired(ctx, running, now);

    let claimSlot: number | undefined;
    while (slotIndex < args.slots.length) {
      const slot = args.slots[slotIndex++];
      if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_PARALLEL_SKILL_CARD_JOBS) continue;
      const occupants = await ctx.db
        .query("skillCardGenerationJobs")
        .withIndex("by_status_and_claim_slot", (q) =>
          q.eq("status", "running").eq("claimSlot", slot),
        )
        .take(LOOKAHEAD + 1);
      if (
        occupants.length > LOOKAHEAD ||
        occupants.some((occupant) => (occupant.leaseExpiresAt ?? 0) > now)
      ) {
        break;
      }
      for (const occupant of occupants) await releaseExpired(ctx, occupant, now);
      claimSlot = slot;
      break;
    }
    if (claimSlot === undefined) break;
    const leaseToken = crypto.randomUUID();
    const claim = {
      status: "running" as const,
      claimSlot,
      attempts: job.attempts + 1,
      leaseToken,
      leaseExpiresAt: now + leaseMs,
      workerId: args.workerId,
      lastError: undefined,
      updatedAt: now,
    };
    await ctx.db.patch(job._id, claim);
    jobs.push({ ...job, ...claim });
  }
  // Only a fresh read-only plan establishes an empty queue. Losing an advisory
  // candidate/slot must not make an idle worker abandon other queued work.
  return { jobs, contended: jobs.length === 0 };
}
