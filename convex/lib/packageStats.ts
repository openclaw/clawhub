import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { toDayKey } from "./leaderboards";

type PackageDailyStatDeltas = {
  packageId: Id<"packages">;
  family: Doc<"packages">["family"];
  occurredAt: number;
  downloads?: number;
  installs?: number;
  now: number;
};

export async function bumpDailyPackageStats(ctx: MutationCtx, params: PackageDailyStatDeltas) {
  const downloads = params.downloads ?? 0;
  const installs = params.installs ?? 0;
  if (downloads === 0 && installs === 0) return;

  const day = toDayKey(params.occurredAt);
  const existing = await ctx.db
    .query("packageDailyStats")
    .withIndex("by_package_day", (q) => q.eq("packageId", params.packageId).eq("day", day))
    .unique();

  if (!existing) {
    await ctx.db.insert("packageDailyStats", {
      packageId: params.packageId,
      family: params.family,
      day,
      downloads,
      installs,
      updatedAt: params.now,
    });
    return;
  }

  await ctx.db.patch(existing._id, {
    family: params.family,
    downloads: existing.downloads + downloads,
    installs: existing.installs + installs,
    updatedAt: params.now,
  });
}
