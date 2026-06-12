import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
// DEV-ONLY seed for the management Content-reports and Duplicate-candidates queues.
// Uses the un-wrapped mutation builder (not convex/functions.ts) so patching skills
// / versions and inserting report + fingerprint rows does NOT fire table triggers.
// It operates on existing seeded skills rather than creating new ones, so the base
// dev seed must have run first. All demo rows carry a marker so clearDemo can remove
// them precisely.
import { internalMutation } from "./_generated/server";
import { assertLocalDevSeedAllowed } from "./lib/devSeed";

const DEMO_REPORT_MARKER = "managementDevSeed:report";
// Hash-like so the dashboard's fingerprint chip reads like real data; still a
// fixed constant so clearDemo can find and remove the seeded rows.
const DEMO_FINGERPRINT = "9f8c2a1b7e4d6c30a5b2f1d089c4e76b";

const DEMO_REPORT_REASONS = [
  "Possible prompt-injection hidden in the skill instructions.",
  "Looks like a copy of another publisher's skill.",
  "Requests credentials it does not appear to need.",
  "Spammy catalog filler with no real functionality.",
];

const HOUR_MS = 60 * 60 * 1000;
const REPORT_SCAN_LIMIT = 500;
const SKILL_SCAN_LIMIT = 50;

type DuplicateDemoTarget = {
  skill: Doc<"skills">;
  versionId: Id<"skillVersions">;
};

// Remove previously seeded demo reports + duplicate fingerprints so the seed is
// idempotent and the dashboard can be reset.
async function clearDemo(ctx: Pick<MutationCtx, "db">): Promise<{
  reportsDeleted: number;
  fingerprintsDeleted: number;
}> {
  let reportsDeleted = 0;
  let fingerprintsDeleted = 0;

  const affectedSkillIds = new Set<Id<"skills">>();
  const reports = await ctx.db.query("skillReports").order("desc").take(REPORT_SCAN_LIMIT);
  for (const report of reports) {
    if (report.triageNote !== DEMO_REPORT_MARKER) continue;
    affectedSkillIds.add(report.skillId);
    await ctx.db.delete(report._id);
    reportsDeleted += 1;
  }
  for (const skillId of affectedSkillIds) {
    const skill = await ctx.db.get(skillId);
    if (!skill) continue;
    await restoreSkillReportSummary(ctx, skillId);
  }

  const fingerprints = await ctx.db
    .query("skillVersionFingerprints")
    .withIndex("by_fingerprint", (q) => q.eq("fingerprint", DEMO_FINGERPRINT))
    .take(100);
  for (const fingerprint of fingerprints) {
    const version = await ctx.db.get(fingerprint.versionId);
    if (version && version.fingerprint === DEMO_FINGERPRINT) {
      await ctx.db.patch(fingerprint.versionId, { fingerprint: undefined });
    }
    await ctx.db.delete(fingerprint._id);
    fingerprintsDeleted += 1;
  }

  return { reportsDeleted, fingerprintsDeleted };
}

async function restoreSkillReportSummary(
  ctx: Pick<MutationCtx, "db">,
  skillId: Id<"skills">,
): Promise<void> {
  const reports = await ctx.db
    .query("skillReports")
    .withIndex("by_skill_createdAt", (q) => q.eq("skillId", skillId))
    .order("desc")
    .take(REPORT_SCAN_LIMIT);
  const openReports = reports.filter((report) => (report.status ?? "open") === "open");

  await ctx.db.patch(skillId, {
    reportCount: openReports.length > 0 ? openReports.length : undefined,
    lastReportedAt: openReports[0]?.createdAt,
  });
}

async function findDuplicateDemoTargets(
  ctx: Pick<MutationCtx, "db">,
  skills: Doc<"skills">[],
): Promise<DuplicateDemoTarget[]> {
  const targets: DuplicateDemoTarget[] = [];
  for (const skill of skills) {
    const versionId = skill.latestVersionId;
    if (!versionId) continue;
    const version = await ctx.db.get(versionId);
    if (!version || version.fingerprint) continue;
    targets.push({ skill, versionId });
    if (targets.length === 2) break;
  }
  return targets;
}

export const seedManagementQueues = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    reportsInserted: number;
    reportedSkills: number;
    duplicatePair: number;
  }> => {
    assertLocalDevSeedAllowed("Management");
    await clearDemo(ctx);
    const now = Date.now();

    const reporter = (await ctx.db.query("users").take(1))[0];
    if (!reporter) {
      throw new Error("No users found to attribute demo reports to; run the base dev seed first.");
    }

    const skills = (await ctx.db.query("skills").order("desc").take(SKILL_SCAN_LIMIT)).filter(
      (skill) => !skill.softDeletedAt && skill.latestVersionId,
    );
    if (skills.length < 2) {
      throw new Error("Need at least 2 seeded skills; run the base dev seed first.");
    }

    // Content reports: flag the first few skills with 1-3 reports each.
    const reportTargets = skills.slice(0, Math.min(3, skills.length));
    let reportsInserted = 0;
    for (let i = 0; i < reportTargets.length; i += 1) {
      const skill = reportTargets[i];
      const count = 1 + (i % 3);
      for (let r = 0; r < count; r += 1) {
        await ctx.db.insert("skillReports", {
          skillId: skill._id,
          userId: reporter._id,
          reason: DEMO_REPORT_REASONS[(i + r) % DEMO_REPORT_REASONS.length],
          status: "open",
          triageNote: DEMO_REPORT_MARKER,
          createdAt: now - (i * 3 + r) * HOUR_MS,
        });
        reportsInserted += 1;
      }
      await ctx.db.patch(skill._id, {
        reportCount: count,
        lastReportedAt: now - i * HOUR_MS,
      });
    }

    // Duplicate candidates: give a pair of skills the same latest-version fingerprint
    // so each surfaces the other as a near-duplicate.
    const duplicatePair = await findDuplicateDemoTargets(ctx, skills);
    for (const { skill, versionId } of duplicatePair) {
      await ctx.db.patch(versionId, { fingerprint: DEMO_FINGERPRINT });
      await ctx.db.insert("skillVersionFingerprints", {
        skillId: skill._id,
        versionId,
        fingerprint: DEMO_FINGERPRINT,
        kind: "source",
        createdAt: now,
      });
    }

    return {
      reportsInserted,
      reportedSkills: reportTargets.length,
      duplicatePair: duplicatePair.length,
    };
  },
});

export const clearManagementQueues = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ reportsDeleted: number; fingerprintsDeleted: number }> => {
    assertLocalDevSeedAllowed("Management");
    return clearDemo(ctx);
  },
});
