import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertAdmin } from "./access";
import { sha256Hex } from "./clawpack";
import { isOfficialPublisher } from "./officialPublishers";
import { assertPackageRuntimeIdAvailable } from "./packageRuntimeIdentity";
import { isPublisherActive } from "./publishers";
import { matchesStorageSha256 } from "./storageDigests";

const TARGETS: Record<string, { publisher: string; runtimeId: string }> = {
  "@openclaw/acpx": { publisher: "openclaw", runtimeId: "acpx" },
  "@openclaw/cloudflare": { publisher: "openclaw", runtimeId: "cloudflare" },
  "@openclaw/diffs": { publisher: "openclaw", runtimeId: "diffs" },
  "@openclaw/feishu": { publisher: "openclaw", runtimeId: "feishu" },
  "@shopify/ai-toolkit": { publisher: "shopify", runtimeId: "shopify-ai-toolkit" },
};

// This incident has five selected packages, each with fewer than 150 releases.
// One bounded, atomic package transaction snapshots history before its parent
// changes. An oversized inventory fails without writes; operators resume by
// package ID, and completed packages return an idempotent read-only receipt.
const MAX_RELEASES = 150;
const MAX_INVENTORY_BYTES = 8 * 1024 * 1024;
const CONFIRM = "repair-verified-legacy-native-plugin-family";

export type LegacyNativePluginFamilyRepairArgs = {
  actorUserId: Id<"users">;
  packageId: Id<"packages">;
  expectedOwnerPublisherId: Id<"publishers">;
  expectedLatestReleaseId: Id<"packageReleases">;
  nativeManifestText: string;
  expectedRevision?: string;
  dryRun?: boolean;
  confirm?: string;
  reason: string;
};

export async function repairLegacyNativePluginFamily(
  ctx: MutationCtx,
  args: LegacyNativePluginFamilyRepairArgs,
) {
  const dryRun = args.dryRun !== false;
  const actor = await ctx.db.get(args.actorUserId);
  if (!actor || actor.deletedAt !== undefined || actor.deactivatedAt !== undefined) {
    throw new ConvexError("Unauthorized");
  }
  assertAdmin(actor);
  const reason = args.reason.trim();
  if (!reason || reason.length > 500) throw new ConvexError("A bounded repair reason is required");

  const pkg = await ctx.db.get(args.packageId);
  const target = pkg ? TARGETS[pkg.normalizedName] : undefined;
  if (!pkg || pkg.softDeletedAt !== undefined || !target) {
    throw new ConvexError("Package is outside this repair");
  }
  const publisher = pkg.ownerPublisherId ? await ctx.db.get(pkg.ownerPublisherId) : null;
  if (
    pkg.ownerPublisherId !== args.expectedOwnerPublisherId ||
    !publisher ||
    publisher.deletedAt !== undefined ||
    publisher.deactivatedAt !== undefined ||
    !isPublisherActive(publisher) ||
    publisher.kind !== "org" ||
    publisher.handle !== target.publisher ||
    !(await isOfficialPublisher(ctx, publisher)) ||
    pkg.runtimeId !== target.runtimeId ||
    pkg.latestReleaseId !== args.expectedLatestReleaseId ||
    (pkg.family !== "bundle-plugin" && pkg.family !== "code-plugin")
  ) {
    throw new ConvexError("Legacy native package identity changed");
  }
  const latest = await ctx.db.get(args.expectedLatestReleaseId);
  const manifest = latest?.extractedPluginManifest;
  if (
    !latest ||
    latest.packageId !== pkg._id ||
    latest.softDeletedAt !== undefined ||
    latest.ownerDeletedAt !== undefined ||
    (latest.publicationStatus !== undefined && latest.publicationStatus !== "published") ||
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.id !== target.runtimeId ||
    latest.runtimeId !== target.runtimeId
  ) {
    throw new ConvexError("Published native identity evidence changed");
  }
  const nativeFile = latest.files.find((file) => file.path === "openclaw.plugin.json");
  const stored = nativeFile ? await ctx.db.system.get(nativeFile.storageId) : null;
  if (
    !nativeFile ||
    !stored ||
    stored.size !== nativeFile.size ||
    !matchesStorageSha256(stored.sha256, nativeFile.sha256)
  ) {
    throw new ConvexError("Native manifest storage changed");
  }
  const manifestBytes = new TextEncoder().encode(args.nativeManifestText);
  if (
    manifestBytes.length > 64 * 1024 ||
    manifestBytes.length !== nativeFile.size ||
    (await sha256Hex(manifestBytes)) !== nativeFile.sha256
  ) {
    throw new ConvexError("Native manifest evidence does not match original bytes");
  }
  let originalManifest: unknown;
  try {
    originalManifest = JSON.parse(args.nativeManifestText);
  } catch {
    throw new ConvexError("Native manifest evidence is invalid JSON");
  }
  if (
    !originalManifest ||
    typeof originalManifest !== "object" ||
    Array.isArray(originalManifest) ||
    !("id" in originalManifest) ||
    originalManifest.id !== target.runtimeId
  ) {
    throw new ConvexError("Original native manifest identity does not match");
  }
  await assertPackageRuntimeIdAvailable(ctx, pkg);
  for (const status of ["pending_checks", "ready_to_finalize", "finalizing"] as const) {
    const active = await ctx.db
      .query("publishAttempts")
      .withIndex("by_kind_status_slug_version_created", (q) =>
        q.eq("kind", "package").eq("status", status).eq("slug", pkg.name),
      )
      .first();
    if (active) throw new ConvexError("Package has active publication work");
  }

  const releases = await ctx.db
    .query("packageReleases")
    .withIndex("by_package", (q) => q.eq("packageId", pkg._id))
    .take(MAX_RELEASES + 1);
  if (releases.length > MAX_RELEASES)
    throw new ConvexError("Release inventory exceeds repair bound");
  if (
    releases.some(
      (release) =>
        (release.publicationStatus !== undefined && release.publicationStatus !== "published") ||
        release.pendingPublication !== undefined ||
        release.operationalRetry !== undefined ||
        (pkg.family === "bundle-plugin" && release.pluginFamily === "code-plugin"),
    )
  ) {
    throw new ConvexError("Release history has pending or contradictory publication state");
  }
  if (pkg.family === "code-plugin") {
    if (releases.some((release) => release.pluginFamily === undefined)) {
      throw new ConvexError("Native parent has unsnapshotted history");
    }
    return {
      dryRun,
      isDone: true,
      alreadyRepaired: true,
      packageId: pkg._id,
      releases: releases.length,
      snapshotted: 0,
      changedParent: false,
    };
  }
  const inventory = JSON.stringify({
    package: {
      id: pkg._id,
      name: pkg.name,
      normalizedName: pkg.normalizedName,
      ownerUserId: pkg.ownerUserId,
      ownerPublisherId: pkg.ownerPublisherId,
      family: pkg.family,
      runtimeId: pkg.runtimeId,
      latestReleaseId: pkg.latestReleaseId,
      tags: pkg.tags,
      scanStatus: pkg.scanStatus,
      verification: pkg.verification,
    },
    releases: releases.map((release) => ({
      ...release,
      pluginFamily: release.pluginFamily ?? "bundle-plugin",
    })),
    nativeManifestStorage: { id: nativeFile.storageId, size: stored.size, sha256: stored.sha256 },
  });
  const bytes = new TextEncoder().encode(inventory);
  if (bytes.length > MAX_INVENTORY_BYTES)
    throw new ConvexError("Release inventory exceeds byte bound");
  const revision = await sha256Hex(bytes);
  const missing = releases.filter((release) => release.pluginFamily === undefined);
  if (dryRun)
    return {
      dryRun,
      isDone: true,
      alreadyRepaired: false,
      packageId: pkg._id,
      releases: releases.length,
      snapshotted: 0,
      wouldSnapshot: missing.length,
      changedParent: false,
      wouldChangeParent: true,
      revision,
      confirmRequired: CONFIRM,
    };
  if (args.confirm !== CONFIRM || args.expectedRevision !== revision) {
    throw new ConvexError("Apply requires the current dry-run revision and confirmation token");
  }
  for (const release of missing) await ctx.db.patch(release._id, { pluginFamily: "bundle-plugin" });
  // The normal package trigger synchronizes derived catalog fields atomically.
  await ctx.db.patch(pkg._id, { family: "code-plugin", updatedAt: Date.now() });
  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "package.legacyNativeFamily.repair",
    targetType: "package",
    targetId: pkg._id,
    createdAt: Date.now(),
    metadata: {
      reason,
      revision,
      name: pkg.normalizedName,
      runtimeId: pkg.runtimeId,
      previousFamily: "bundle-plugin",
      nextFamily: "code-plugin",
      releaseIds: releases.map((release) => release._id),
      snapshotted: missing.length,
      evidenceReleaseId: latest._id,
      evidenceFingerprint: latest.integritySha256,
      nativeManifestSha256: nativeFile.sha256,
    },
  });
  return {
    dryRun,
    isDone: true,
    alreadyRepaired: false,
    packageId: pkg._id,
    releases: releases.length,
    snapshotted: missing.length,
    changedParent: true,
    revision,
  };
}
