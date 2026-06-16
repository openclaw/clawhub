import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

async function deleteGitHubSkillScan(
  ctx: Pick<MutationCtx, "db">,
  scan: Doc<"githubSkillScans">,
  now: number,
) {
  if (scan.skillScanRequestId) {
    const request = await ctx.db.get(scan.skillScanRequestId);
    if (request?.securityScanJobId) {
      const job = await ctx.db.get(request.securityScanJobId);
      if (job?.targetKind === "skillScanRequest") await ctx.db.delete(job._id);
    }
    if (request) {
      await ctx.db.patch(request._id, {
        status: "failed",
        securityScanJobId: undefined,
        githubSkillScanId: undefined,
        lastError: "GitHub-backed skill deleted",
        completedAt: now,
        expiresAt: now - 1,
        updatedAt: now,
      });
    }
  }
  await ctx.db.delete(scan._id);
}

export async function deleteGitHubSkillScansForSkill(
  ctx: Pick<MutationCtx, "db">,
  skillId: Id<"skills">,
  limit?: number,
) {
  const now = Date.now();
  const query = ctx.db
    .query("githubSkillScans")
    .withIndex("by_skill_and_content_hash", (q) => q.eq("skillId", skillId));
  const scans = limit === undefined ? await query.collect() : await query.take(limit);
  for (const scan of scans) await deleteGitHubSkillScan(ctx, scan, now);
  return scans.length;
}

export async function deleteGitHubSkillScansForSource(
  ctx: Pick<MutationCtx, "db">,
  sourceId: Id<"githubSkillSources">,
  limit: number,
) {
  const now = Date.now();
  const scans = await ctx.db
    .query("githubSkillScans")
    .withIndex("by_github_source_and_updated_at", (q) => q.eq("githubSourceId", sourceId))
    .take(limit);
  for (const scan of scans) await deleteGitHubSkillScan(ctx, scan, now);
  return scans.length;
}
