import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import {
  currentSdkUsageScan,
  publicSdkUsageRelease,
  publicSdkUsageScan,
  sdkUsageStatus,
} from "./lib/packageSdkUsage";

export const deleteTemporaryReportInternal = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    if (await ctx.db.system.get(storageId)) await ctx.storage.delete(storageId);
  },
});

export const lookupInternal = internalQuery({
  args: {
    key: v.string(),
    releasedSince: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("packageSdkUsage")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .paginate(args.paginationOpts);
    const items = [];
    for (const row of page.page) {
      const pkg = await ctx.db.get(row.packageId);
      const release = await publicSdkUsageRelease(ctx, pkg);
      if (!pkg || !release || release._id !== row.releaseId) continue;
      if (args.releasedSince !== undefined && release.createdAt < args.releasedSince) continue;
      const scan = await currentSdkUsageScan(ctx, pkg, release);
      const status = sdkUsageStatus(scan);
      if (!scan || scan._id !== row.scanId || (status !== "complete" && status !== "partial"))
        continue;
      const {
        _id,
        _creationTime,
        packageId: _packageId,
        releaseId,
        scanId: _scanId,
        ...usage
      } = row;
      items.push({
        packageName: pkg.name,
        version: release.version,
        releaseId,
        releaseCreatedAt: release.createdAt,
        ...usage,
        scan: publicSdkUsageScan(scan),
      });
    }
    return {
      releasedSince: args.releasedSince ?? null,
      items,
      nextCursor: page.isDone ? null : page.continueCursor,
      counts: { scope: "page" as const, distinctPlugins: items.length },
    };
  },
});

export const coverageInternal = internalQuery({
  args: { releasedSince: v.optional(v.number()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    // Coverage concerns one current release per plugin. Paging release history
    // makes clients traverse every old version; package creation order is also
    // stable when listings or scan results change during a traversal.
    const page = await ctx.db.query("packages").order("asc").paginate(args.paginationOpts);
    const counts = { eligible: 0, complete: 0, partial: 0, failed: 0, missing: 0, incompatible: 0 };
    let unresolvedReferences = 0;
    const items = [];
    for (const pkg of page.page) {
      const release = await publicSdkUsageRelease(ctx, pkg);
      if (!release) continue;
      if (args.releasedSince !== undefined && release.createdAt < args.releasedSince) continue;
      const scan = await currentSdkUsageScan(ctx, pkg, release);
      const status = sdkUsageStatus(scan);
      const unknownCount = scan?.sdkUsage?.unknownCount ?? 0;
      counts.eligible += 1;
      counts[status] += 1;
      unresolvedReferences += unknownCount;
      items.push({
        packageName: pkg.name,
        version: release.version,
        releaseId: release._id,
        releaseCreatedAt: release.createdAt,
        status,
        unknownCount,
      });
    }
    return {
      releasedSince: args.releasedSince ?? null,
      scope: "page" as const,
      counts,
      unresolvedReferences,
      items,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const pluginInventoryInternal = internalQuery({
  args: { name: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const pkg = await ctx.db
      .query("packages")
      .withIndex("by_name", (q) => q.eq("normalizedName", args.name.toLowerCase()))
      .unique();
    const release = await publicSdkUsageRelease(ctx, pkg);
    if (!pkg || !release) return null;
    const scan = await currentSdkUsageScan(ctx, pkg, release);
    const status = sdkUsageStatus(scan);
    const identity = {
      packageName: pkg.name,
      version: release.version,
      releaseId: release._id,
      releaseCreatedAt: release.createdAt,
      scan: publicSdkUsageScan(scan),
    };
    if (status !== "complete" && status !== "partial")
      return { ...identity, items: [], nextCursor: null };
    const page = await ctx.db
      .query("packageSdkUsage")
      .withIndex("by_packageId_and_key", (q) => q.eq("packageId", pkg._id))
      .paginate(args.paginationOpts);
    return {
      ...identity,
      items: page.page
        .filter((row) => row.scanId === scan?._id && row.releaseId === release._id)
        .map(
          ({
            _id,
            _creationTime,
            packageId: _packageId,
            releaseId: _releaseId,
            scanId: _scanId,
            ...entry
          }) => entry,
        ),
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
