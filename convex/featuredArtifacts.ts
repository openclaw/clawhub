import { getPluginDiscoveryExclusion } from "clawhub-schema";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { internalQuery } from "./functions";
import { getSkillBadgeMap, isSkillHighlighted, isSkillOfficial } from "./lib/badges";
import type { CurrentFeaturedArtifact } from "./lib/featuredIntelligence";
import { isPublicSkillDoc } from "./lib/globalStats";
import { buildSkillInstallResolution } from "./lib/installResolver";
import { isOfficialPublisher } from "./lib/officialPublishers";
import {
  getPackageDownloadSecurityBlock,
  resolvePackageReleaseScanStatus,
} from "./lib/packageSecurity";
import {
  resolvePublicBrowseVersionForSkill,
  shouldExcludeSkillFromPublicBrowse,
} from "./lib/publicBrowse";
import { getOwnerPublisher } from "./lib/publishers";
import { searchArtifactKind } from "./lib/searchInsights";
import type { SearchCurrentResult } from "./lib/searchInsights";
import { normalizeSecurityScanStatus } from "./lib/securityScanPolicy";
import { isPublicSkillVersionAvailableForSkill } from "./lib/skillFileAccess";
import { isPublicSkillsShMirrorDigest } from "./lib/skillsShMirrorPublic";
import { readPackageForViewer, readPackageVersionForViewer } from "./packages";
import { getSkillsShPublicCatalogEnabledHandler } from "./rolloutCapabilities";

// Search and adoption readers share this current eligibility owner. Each batch is
// a single read snapshot; none of these advisory reads changes Featured badges.
export const readInternal = internalQuery({
  args: { identities: v.array(v.string()) },
  handler: async (ctx, { identities }): Promise<SearchCurrentResult[]> => {
    if (identities.length > 100 || identities.some((id) => !id || id.length > 300))
      throw new Error("Maximum 100 bounded artifact identities");
    const results: SearchCurrentResult[] = [];
    for (const id of new Set(identities)) {
      const row = id.startsWith("plugin:")
        ? await readPlugin(ctx, id)
        : id.startsWith("clawhub:")
          ? await readSkill(ctx, id)
          : id.startsWith("skills-sh:")
            ? await readExternal(ctx, id)
            : null;
      if (row) results.push(row);
    }
    return results;
  },
});

async function readPlugin(ctx: QueryCtx, id: string): Promise<SearchCurrentResult | null> {
  const detail = await readPackageForViewer(ctx, { name: id.slice(7) });
  if (
    !detail ||
    (detail.package.family !== "code-plugin" && detail.package.family !== "bundle-plugin")
  )
    return null;
  const pkg = detail.package;
  const version = pkg.latestVersion
    ? await readPackageVersionForViewer(ctx, { name: pkg.name, version: pkg.latestVersion })
    : null;
  const release = version?.version;
  const badge = await ctx.db
    .query("packageBadges")
    .withIndex("by_package_kind", (q) => q.eq("packageId", pkg._id).eq("kind", "highlighted"))
    .unique();
  const eligibilityReasons = [];
  const discoveryExclusion = getPluginDiscoveryExclusion(pkg.categories);
  if (discoveryExclusion) eligibilityReasons.push(`discovery-excluded:${discoveryExclusion}`);
  if (!release) eligibilityReasons.push("no-public-version");
  else {
    if (
      resolvePackageReleaseScanStatus(release) !== "clean" ||
      getPackageDownloadSecurityBlock(release)
    )
      eligibilityReasons.push("security-not-clean");
    if (!release.files.length && !release.clawpackStorageId)
      eligibilityReasons.push("not-installable");
  }
  return {
    id,
    artifactKind: "plugin",
    createdAt: pkg.createdAt,
    name: pkg.name,
    displayName: pkg.displayName.slice(0, 120),
    summary: pkg.summary?.slice(0, 500) ?? null,
    version: pkg.latestVersion ?? null,
    url: `/plugins/${encodeURIComponent(pkg.name)}`,
    isOfficial: pkg.isOfficial === true,
    isFeatured: Boolean(badge),
    eligibleForFeatured: eligibilityReasons.length === 0,
    eligibilityReasons,
    ...(pkg.categories?.[0] ? { category: pkg.categories[0] } : {}),
  };
}

async function readSkill(ctx: QueryCtx, id: string): Promise<SearchCurrentResult | null> {
  const skillId = ctx.db.normalizeId("skills", id.slice(8));
  const skill = skillId ? await ctx.db.get(skillId) : null;
  if (!skill || !isPublicSkillDoc(skill)) return null;
  const owner = await getOwnerPublisher(ctx, skill);
  if (!owner) return null;
  const badges = await getSkillBadgeMap(ctx, skill._id);
  const isFeatured = isSkillHighlighted({ badges });
  const version = await resolvePublicBrowseVersionForSkill(ctx, skill);
  const publicVersion =
    version &&
    version.ownerDeletedAt === undefined &&
    isPublicSkillVersionAvailableForSkill(version, skill._id)
      ? version
      : null;
  const eligibilityReasons = [];
  if (!publicVersion) eligibilityReasons.push("no-public-version");
  // A public listing alone does not prove a completed clean ClawScan verdict.
  // Other scanner statuses are checked by the public-version resolver above.
  if (
    shouldExcludeSkillFromPublicBrowse(skill) ||
    normalizeSecurityScanStatus(
      publicVersion?.llmAnalysis?.verdict ?? publicVersion?.llmAnalysis?.status,
    ) !== "clean"
  )
    eligibilityReasons.push("security-not-clean");
  if (skill.installKind === "github") {
    const source = skill.githubSourceId ? await ctx.db.get(skill.githubSourceId) : null;
    if (!buildSkillInstallResolution({ origin: "https://clawhub.ai", skill, source }).ok)
      eligibilityReasons.push("not-installable");
  } else if (publicVersion && !publicVersion.files.length)
    eligibilityReasons.push("not-installable");
  return {
    id,
    artifactKind: "skill",
    createdAt: skill.createdAt,
    nativeSkillId: String(skill._id),
    name: skill.slug,
    displayName: skill.displayName.slice(0, 120),
    summary: skill.summary?.slice(0, 500) ?? null,
    version: publicVersion?.version ?? null,
    url: `/${encodeURIComponent(owner.handle ?? String(owner._id))}/skills/${encodeURIComponent(skill.slug)}`,
    isOfficial: isSkillOfficial({ badges }) || (await isOfficialPublisher(ctx, owner)),
    isFeatured,
    eligibleForFeatured: eligibilityReasons.length === 0,
    eligibilityReasons,
    ...(skill.categories?.[0] ? { category: skill.categories[0] } : {}),
  };
}

async function readExternal(ctx: QueryCtx, id: string): Promise<SearchCurrentResult | null> {
  if (!(await getSkillsShPublicCatalogEnabledHandler(ctx))) return null;
  const digest = await ctx.db
    .query("skillsShMirrorDigests")
    .withIndex("by_external_id", (q) => q.eq("externalId", id.slice(10)))
    .unique();
  if (!digest || !isPublicSkillsShMirrorDigest(digest)) return null;
  return {
    id,
    artifactKind: "skill",
    name: digest.externalId,
    displayName: digest.displayName.slice(0, 120),
    summary: digest.searchSummary?.slice(0, 500) ?? null,
    version: null,
    url: `/skills-sh/${digest.externalId.split("/").map(encodeURIComponent).join("/")}`,
    isOfficial: false,
    isFeatured: false,
    eligibleForFeatured: false,
    eligibilityReasons: ["external-no-feature-owner"],
    ...(digest.inferredCategories?.[0] ? { category: digest.inferredCategories[0] } : {}),
  };
}

// The complete current set is an independent input, not the intersection with
// this week's top search or Trending results. Keep unavailable members visible
// for an explicit removal decision instead of silently losing their membership.
export const readCurrentFeaturedInternal = internalQuery({
  args: { artifactKind: searchArtifactKind },
  handler: async (ctx, { artifactKind }): Promise<CurrentFeaturedArtifact[]> => {
    const rows: CurrentFeaturedArtifact[] = [];
    const badges =
      artifactKind === "plugin"
        ? ctx.db
            .query("packageBadges")
            .withIndex("by_kind_at", (q) => q.eq("kind", "highlighted"))
            .order("desc")
        : ctx.db
            .query("skillBadges")
            .withIndex("by_kind_at", (q) => q.eq("kind", "highlighted"))
            .order("desc");
    for await (const badge of badges) {
      const pkg = "packageId" in badge ? await ctx.db.get(badge.packageId) : null;
      const skill = "skillId" in badge ? await ctx.db.get(badge.skillId) : null;
      if (pkg && pkg.family !== "code-plugin" && pkg.family !== "bundle-plugin") continue;
      const id = pkg
        ? `plugin:${pkg.name}`
        : "skillId" in badge
          ? `clawhub:${badge.skillId}`
          : `package:${badge.packageId}`;
      const artifact = pkg ? await readPlugin(ctx, id) : skill ? await readSkill(ctx, id) : null;
      rows.push({
        ...(artifact ?? {
          id,
          artifactKind,
          name: pkg?.name ?? skill?.slug ?? id,
          displayName: pkg?.displayName ?? skill?.displayName ?? "Unavailable Featured entry",
          summary: null,
          version: null,
          url: pkg
            ? `/plugins/${encodeURIComponent(pkg.name)}`
            : `/management?view=${artifactKind === "plugin" ? "plugins" : "skills"}`,
          eligibleForFeatured: false,
          eligibilityReasons: ["no-public-version"],
        }),
        featuredAt: badge.at,
      });
      if (rows.length > 100)
        throw new Error("Featured membership exceeds the bounded review limit");
    }
    return rows;
  },
});
