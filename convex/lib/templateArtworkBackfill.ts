import {
  MAX_TEMPLATE_MANIFEST_BYTES,
  parseTemplateMarkdownDocument,
  validateTemplateManifest,
  type TemplateManifest,
} from "clawhub-schema";
import { CATALOG_TOPIC_LIMIT, getCatalogTopicSlugs } from "clawhub-schema/catalogMetadata";
import { isSafeTemplatePackagePath } from "clawhub-schema/templatePaths";
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { sha256Hex } from "./hash";
import { isTemplateCatalogPublisherAvailable } from "./packageCatalogRead";
import { resolveTemplatePackageIcon } from "./packageIcons";
import { isPublishedPackageRelease } from "./packageReleaseVisibility";
import { extractPackageDigestFields } from "./packageSearchDigest";
import { isPackageBlockedFromPublic, getPackageDownloadSecurityBlock } from "./packageSecurity";
import { isHostedSkillPresentationIconPath } from "./skillPresentation";
import { matchesStorageSha256 } from "./storageDigests";

const AUDIT = "package.template_artwork.repair.v1";
const TARGET = "packageRelease";
export const artworkApproval = v.object({
  releaseId: v.id("packageReleases"),
  stateHash: v.string(),
  icon: v.string(),
});
type Approval = Infer<typeof artworkApproval>;
type Files = Doc<"packageReleases">["files"];
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Read only package.json and its one declared manifest; never unpack the archive or guess by basename.
async function verifiedText(ctx: ActionCtx, files: Files, path: string, limit: number) {
  const matches = files.filter((file) => file.path === path);
  const file = matches[0];
  if (
    !file ||
    matches.length !== 1 ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > limit
  )
    return undefined;
  // Actions materialize storage.get blobs. Check the authoritative size/digest first.
  if (
    !(await ctx.runQuery(internal.maintenance.checkTemplateArtworkFileInternal, {
      storageId: file.storageId,
      size: file.size,
      sha256: file.sha256,
    }))
  )
    return undefined;
  const blob = await ctx.storage.get(file.storageId);
  if (!blob || blob.size !== file.size || blob.size > limit) return undefined;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if ((await sha256Hex(bytes)) !== file.sha256.toLowerCase()) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export async function checkArtworkFile(
  ctx: QueryCtx,
  args: { storageId: Id<"_storage">; size: number; sha256: string },
) {
  const metadata = await ctx.db.system.get("_storage", args.storageId);
  return (
    !!metadata &&
    metadata.size === args.size &&
    matchesStorageSha256(metadata.sha256, args.sha256.toLowerCase())
  );
}

async function readPublishedManifest(
  ctx: ActionCtx,
  files: Files,
): Promise<TemplateManifest | undefined> {
  const packageText = await verifiedText(ctx, files, "package.json", 256 * 1024);
  if (!packageText) return undefined;
  let metadata: unknown;
  try {
    metadata = JSON.parse(packageText);
  } catch {
    return undefined;
  }
  if (!record(metadata) || !record(metadata.openclaw)) return undefined;
  const selector = metadata.openclaw;
  if (Object.hasOwn(selector, "template") === Object.hasOwn(selector, "claw")) return undefined;
  const path = selector.template ?? selector.claw;
  if (typeof path !== "string" || !isSafeTemplatePackagePath(path)) return undefined;
  const markdown = path.split("/").at(-1)?.toLowerCase() === "claw.md";
  if (!markdown && !path.toLowerCase().endsWith(".json")) return undefined;
  const raw = await verifiedText(ctx, files, path, MAX_TEMPLATE_MANIFEST_BYTES);
  if (!raw) return undefined;
  try {
    // Historical releases used openclaw.claw and/or JSON. Validate just the same V1
    // artwork declaration: unrelated retired profiles/cronJobs must not block a repair.
    // This is a projection of an already-published artifact, not an admission path.
    const doc = markdown
      ? parseTemplateMarkdownDocument(raw, path)
      : { value: JSON.parse(raw) as unknown };
    if (!("value" in doc) || !record(doc.value) || !record(doc.value.agent)) return undefined;
    const { schemaVersion, agent, workspace } = doc.value;
    if (!record(agent.identity) || typeof agent.identity.avatar !== "string") return undefined;
    const validated = validateTemplateManifest({
      schemaVersion,
      agent: { id: agent.id, identity: { avatar: agent.identity.avatar } },
      ...(workspace === undefined ? {} : { workspace }),
    });
    return validated.ok ? validated.manifest : undefined;
  } catch {
    return undefined;
  }
}

function eligiblePackage(pkg: Doc<"packages"> | null): pkg is Doc<"packages"> {
  return (
    !!pkg &&
    pkg.family === "claw" &&
    pkg.softDeletedAt === undefined &&
    pkg.channel !== "private" &&
    !isPackageBlockedFromPublic(pkg.scanStatus) &&
    !!pkg.latestReleaseId
  );
}

function fields(pkg: Doc<"packages">, release: Doc<"packageReleases">) {
  const latest = pkg.latestReleaseId === release._id;
  return {
    release: release.icon === undefined,
    package: latest && pkg.icon === undefined,
    summary: latest && !!pkg.latestVersionSummary && pkg.latestVersionSummary.icon === undefined,
  };
}
type Fields = ReturnType<typeof fields>;

type ProjectionId = Id<"packageSearchDigest"> | Id<"packageTopicSearchDigest">;
type Projection = { id: ProjectionId; icon?: string };
// A parent patch invokes the package trigger. Repair missing icons on existing projections,
// but refuse structural drift rather than creating/deleting facets or blowing the read budget.
async function readProjections(
  ctx: Pick<QueryCtx, "db">,
  pkg: Doc<"packages">,
): Promise<Projection[] | null> {
  const digest = await ctx.db
    .query("packageSearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", pkg._id))
    .unique();
  const facets = await ctx.db
    .query("packageTopicSearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", pkg._id))
    .take(CATALOG_TOPIC_LIMIT + 1);
  const plugin = await ctx.db
    .query("packagePluginCategorySearchDigest")
    .withIndex("by_package", (q) => q.eq("packageId", pkg._id))
    .first();
  const topics = getCatalogTopicSlugs(extractPackageDigestFields(pkg).topics).sort();
  if (
    plugin ||
    !digest ||
    facets.length > CATALOG_TOPIC_LIMIT ||
    JSON.stringify(facets.map((f) => f.topic).sort()) !== JSON.stringify(topics)
  )
    return null;
  return [digest, ...facets].map((row) => ({ id: row._id, icon: row.icon }));
}
async function artworkState(
  ctx: Pick<QueryCtx, "db">,
  pkg: Doc<"packages">,
  release: Doc<"packageReleases">,
) {
  if (
    !eligiblePackage(pkg) ||
    !isPublishedPackageRelease(release, pkg._id) ||
    release.pluginFamily ||
    getPackageDownloadSecurityBlock(release) ||
    !(await isTemplateCatalogPublisherAvailable(ctx, pkg))
  )
    return null;
  const latest = pkg.latestReleaseId === release._id;
  if (latest && pkg.latestVersionSummary && release.version !== pkg.latestVersionSummary.version)
    return null;
  const projections = latest ? await readProjections(ctx, pkg) : [];
  if (!projections) return null;
  const changed = fields(pkg, release);
  const sourceIcons = latest
    ? [release.icon, pkg.icon, pkg.latestVersionSummary?.icon]
    : [release.icon];
  const existing = [...sourceIcons, ...projections.map((p) => p.icon)].filter(
    (icon): icon is string => icon !== undefined,
  );
  // Exclude unrelated counters/verification/timestamps. Bind the immutable input files,
  // owner, latest pointer, participating fields and identities of their projections.
  const input = [
    pkg._id,
    pkg.normalizedName,
    pkg.ownerUserId,
    pkg.ownerPublisherId,
    pkg.latestReleaseId,
    release._id,
    release.version,
    release.integritySha256,
    release.clawpackSha256,
    release.files,
    sourceIcons,
    latest ? pkg.latestVersionSummary?.version : null,
    projections,
  ];
  const hash = await sha256Hex(new TextEncoder().encode(JSON.stringify(input)));
  return {
    hash,
    changed,
    projections,
    existing,
    needsRepair:
      changed.release ||
      changed.package ||
      changed.summary ||
      projections.some((p) => p.icon === undefined),
  };
}

export async function listArtworkPackages(ctx: QueryCtx, args: { cursor?: string | null }) {
  const page = await ctx.db
    .query("packages")
    .withIndex("by_active_family_recommended_score_version", (q) =>
      q.eq("softDeletedAt", undefined).eq("family", "claw"),
    )
    .paginate({ cursor: args.cursor ?? null, numItems: 10, maximumBytesRead: 2 * 1024 * 1024 });
  return {
    packages: page.page
      .filter(eligiblePackage)
      .map((p) => ({ packageId: p._id, name: p.normalizedName })),
    cursor: page.continueCursor,
    isDone: page.isDone,
  };
}

type ArtworkPage = {
  status: string;
  cursor: string | null;
  isDone: boolean;
  releaseId?: Id<"packageReleases">;
  version?: string;
  candidate?: {
    files: Files;
    releaseId: Id<"packageReleases">;
    stateHash: string;
    existingIcon?: string;
  };
};
export async function readArtworkPage(
  ctx: QueryCtx,
  args: { packageId: Id<"packages">; cursor?: string | null },
): Promise<ArtworkPage> {
  const pkg = await ctx.db.get(args.packageId);
  if (!eligiblePackage(pkg) || !(await isTemplateCatalogPublisherAvailable(ctx, pkg)))
    return { status: "ineligible", cursor: null, isDone: true };
  // One potentially large release per query/action; editing its icon never moves this index key.
  const page = await ctx.db
    .query("packageReleases")
    .withIndex("by_package_active_created", (q) =>
      q.eq("packageId", pkg._id).eq("softDeletedAt", undefined),
    )
    .order("desc")
    .paginate({ cursor: args.cursor ?? null, numItems: 1 });
  const release = page.page[0];
  const progress = {
    cursor: page.continueCursor,
    isDone: page.isDone,
    releaseId: release?._id,
    version: release?.version,
  };
  if (
    !isPublishedPackageRelease(release, pkg._id) ||
    release.pluginFamily ||
    getPackageDownloadSecurityBlock(release)
  )
    return { ...progress, status: "ineligible" };
  const state = await artworkState(ctx, pkg, release);
  if (!state) return { ...progress, status: "drifted" };
  if (!state.needsRepair) return { ...progress, status: "unchanged" };
  if (state.existing.some((i) => !isHostedSkillPresentationIconPath(i) || i !== state.existing[0]))
    return { ...progress, status: "existing-artwork-conflict" };
  return {
    ...progress,
    status: "candidate",
    candidate: {
      files: release.files,
      releaseId: release._id,
      stateHash: state.hash,
      existingIcon: state.existing[0],
    },
  };
}

type Receipt = {
  packageId: Id<"packages">;
  releaseId: Id<"packageReleases">;
  changed: Fields;
  beforeProjections: Projection[];
  icon: string;
  beforeHash: string;
  afterHash: string;
  rolledBackAt?: number;
};

// Only add missing canonical fields; never synthesize a legacy absent summary. Restore the
// exact pre-repair projection icons too, including one that was already present or absent.
async function setArtwork(
  ctx: MutationCtx,
  pkg: Doc<"packages">,
  release: Doc<"packageReleases">,
  changed: Fields,
  projections: Projection[],
  icon: string | undefined,
) {
  if (changed.release) await ctx.db.patch(release._id, { icon });
  if (changed.package || changed.summary)
    await ctx.db.patch(pkg._id, {
      ...(changed.package ? { icon } : {}),
      ...(changed.summary ? { latestVersionSummary: { ...pkg.latestVersionSummary!, icon } } : {}),
    });
  for (const before of projections) {
    const expected = icon ?? before.icon;
    const row = await ctx.db.get(before.id);
    if (!row) throw new ConvexError("Template artwork projection disappeared");
    if (row.icon !== expected) await ctx.db.patch(before.id, { icon: expected });
  }
}

export async function applyArtwork(
  ctx: MutationCtx,
  { packageId, approval }: { packageId: Id<"packages">; approval: Approval },
) {
  const pkg = await ctx.db.get(packageId);
  const release = await ctx.db.get(approval.releaseId);
  if (!pkg || !release || !isHostedSkillPresentationIconPath(approval.icon)) return null;
  const state = await artworkState(ctx, pkg, release);
  if (
    !state?.needsRepair ||
    state.hash !== approval.stateHash ||
    state.existing.some((i) => i !== approval.icon)
  )
    return null;
  await setArtwork(ctx, pkg, release, state.changed, state.projections, approval.icon);
  const after = await artworkState(
    ctx,
    (await ctx.db.get(pkg._id))!,
    (await ctx.db.get(release._id))!,
  );
  if (!after || after.needsRepair || after.existing.some((i) => i !== approval.icon))
    throw new ConvexError("Artwork projection failed; no repair committed");
  const receipt: Receipt = {
    packageId,
    releaseId: release._id,
    changed: state.changed,
    beforeProjections: state.projections,
    icon: approval.icon,
    beforeHash: state.hash,
    afterHash: after.hash,
  };
  return ctx.db.insert("auditLogs", {
    action: AUDIT,
    targetType: TARGET,
    targetId: release._id,
    metadata: receipt,
    createdAt: Date.now(),
  });
}

export async function lastArtworkReceipt(
  ctx: QueryCtx,
  args: { releaseId: Id<"packageReleases"> },
) {
  const receipt = await ctx.db
    .query("auditLogs")
    .withIndex("by_target_action", (q) =>
      q.eq("targetType", TARGET).eq("targetId", args.releaseId).eq("action", AUDIT),
    )
    .order("desc")
    .first();
  return receipt
    ? { receiptId: receipt._id, createdAt: receipt.createdAt, receipt: receipt.metadata as Receipt }
    : null;
}

export async function rollbackArtwork(
  ctx: MutationCtx,
  args: { receiptId: Id<"auditLogs">; dryRun?: boolean; confirm?: string },
) {
  if (args.dryRun === false && args.confirm !== "rollback-template-artwork")
    throw new ConvexError("Expected rollback-template-artwork confirmation");
  const row = await ctx.db.get(args.receiptId);
  if (row?.action !== AUDIT || row.targetType !== TARGET)
    throw new ConvexError("Not a Template artwork repair receipt");
  const receipt = row.metadata as Receipt;
  if (receipt.rolledBackAt !== undefined) return "already-rolled-back";
  const pkg = await ctx.db.get(receipt.packageId);
  const release = await ctx.db.get(receipt.releaseId);
  if (
    !pkg ||
    !release ||
    row.targetId !== release._id ||
    (await lastArtworkReceipt(ctx, { releaseId: release._id }))?.receiptId !== row._id ||
    (await artworkState(ctx, pkg, release))?.hash !== receipt.afterHash
  )
    return "drifted";
  if (args.dryRun !== false) return "would-rollback";
  await setArtwork(ctx, pkg, release, receipt.changed, receipt.beforeProjections, undefined);
  const restored = await artworkState(
    ctx,
    (await ctx.db.get(pkg._id))!,
    (await ctx.db.get(release._id))!,
  );
  if (restored?.hash !== receipt.beforeHash)
    throw new ConvexError("Artwork preimage did not match; rollback not committed");
  await ctx.db.patch(row._id, { metadata: { ...receipt, rolledBackAt: Date.now() } });
  return "rolled-back";
}

type RepairResult = {
  status: string;
  dryRun: boolean;
  cursor: string | null;
  isDone: boolean;
  releaseId?: Id<"packageReleases">;
  version?: string;
  approval?: Approval;
  receiptId?: Id<"auditLogs">;
};
export async function repairArtwork(
  ctx: ActionCtx,
  args: {
    packageId: Id<"packages">;
    cursor?: string | null;
    dryRun?: boolean;
    confirm?: string;
    approval?: Approval;
  },
): Promise<RepairResult> {
  const dryRun = args.dryRun !== false;
  if (!dryRun && (args.confirm !== "repair-template-artwork" || !args.approval))
    throw new ConvexError("Expected repair-template-artwork confirmation and dry-run approval");
  const { candidate, ...page } = await ctx.runQuery(
    internal.maintenance.readTemplateArtworkPageInternal,
    { packageId: args.packageId, cursor: args.cursor },
  );
  const result = { ...page, dryRun };
  if (!dryRun && args.approval?.releaseId !== page.releaseId)
    return { ...result, status: "drifted" };
  if (!candidate) return result;
  if (!dryRun && args.approval?.stateHash !== candidate.stateHash)
    return { ...result, status: "drifted" };
  const manifest = await readPublishedManifest(ctx, candidate.files);
  const input = { files: candidate.files, manifest };
  const icon = await resolveTemplatePackageIcon(ctx, { ...input, dryRun: true });
  if (!icon) return { ...result, status: "no-eligible-artwork" };
  if (candidate.existingIcon && candidate.existingIcon !== icon)
    return { ...result, status: "existing-artwork-conflict" };
  const approval = { releaseId: candidate.releaseId, stateHash: candidate.stateHash, icon };
  if (dryRun) return { ...result, status: "would-repair", approval };
  // Do not register bytes for an unapproved digest. Render serially again only for the
  // single approved live release; the storage function deduplicates identical content.
  if (args.approval?.icon !== icon || (await resolveTemplatePackageIcon(ctx, input)) !== icon)
    return { ...result, status: "drifted" };
  const receiptId = await ctx.runMutation(internal.maintenance.applyTemplateArtworkInternal, {
    packageId: args.packageId,
    approval,
  });
  return receiptId
    ? { ...result, status: "repaired", approval, receiptId }
    : { ...result, status: "drifted" };
}
