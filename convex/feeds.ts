import { v } from "convex/values";
import { query } from "./functions";

const MAX_ROOT_FEED_ITEMS = 5_000;
const FEED_KINDS = ["all", "official", "community", "reviewed"] as const;

function clampLimit(limit: number | undefined) {
  if (!limit || !Number.isFinite(limit)) return 500;
  return Math.max(1, Math.min(Math.floor(limit), MAX_ROOT_FEED_ITEMS));
}

function matchesSkillFeed(
  skill: {
    badges?: { official?: unknown; deprecated?: unknown };
    softDeletedAt?: number;
    moderationStatus?: string;
    moderationFlags?: string[];
    isSuspicious?: boolean;
  },
  feed: (typeof FEED_KINDS)[number],
) {
  if (skill.softDeletedAt) return false;
  if (skill.moderationStatus && skill.moderationStatus !== "active") return false;
  if (skill.moderationFlags?.includes("blocked.malware")) return false;

  const isOfficial = Boolean(skill.badges?.official);
  if (feed === "official") return isOfficial;
  if (feed === "community") return !isOfficial;
  if (feed === "reviewed") return !skill.badges?.deprecated && skill.isSuspicious !== true;
  return true;
}

function matchesPackageFeed(
  pkg: {
    family?: string;
    channel?: string;
    isOfficial?: boolean;
    scanStatus?: string;
    verificationTier?: string;
  },
  feed: (typeof FEED_KINDS)[number],
) {
  if (pkg.family === "skill") return false;
  if (pkg.channel === "private") return false;
  if (pkg.scanStatus === "malicious") return false;

  if (feed === "official") return pkg.isOfficial || pkg.channel === "official";
  if (feed === "community") return !pkg.isOfficial && pkg.channel === "community";
  if (feed === "reviewed") {
    return (
      pkg.scanStatus === "clean" &&
      typeof pkg.verificationTier === "string" &&
      pkg.verificationTier.length > 0
    );
  }
  return true;
}

export const rootFeed = query({
  args: {
    feed: v.optional(v.union(...FEED_KINDS.map((feed) => v.literal(feed)))),
    limit: v.optional(v.number()),
    includeSkills: v.optional(v.boolean()),
    includePlugins: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const feed = args.feed ?? "all";
    const limit = clampLimit(args.limit);
    const includeSkills = args.includeSkills !== false;
    const includePlugins = args.includePlugins !== false;

    const [skills, packageResult] = await Promise.all([
      includeSkills
        ? ctx.db
            .query("skillSearchDigest")
            .withIndex("by_active_updated", (q) => q.eq("softDeletedAt", undefined))
            .order("desc")
            .take(MAX_ROOT_FEED_ITEMS)
        : Promise.resolve([]),
      includePlugins
        ? (async () => {
            const pluginFamilies = await Promise.all([
              ctx.db
                .query("packageSearchDigest")
                .withIndex("by_active_family_updated", (q) =>
                  q.eq("softDeletedAt", undefined).eq("family", "code-plugin"),
                )
                .order("desc")
                .take(MAX_ROOT_FEED_ITEMS),
              ctx.db
                .query("packageSearchDigest")
                .withIndex("by_active_family_updated", (q) =>
                  q.eq("softDeletedAt", undefined).eq("family", "bundle-plugin"),
                )
                .order("desc")
                .take(MAX_ROOT_FEED_ITEMS),
            ]);
            return {
              hitCap: pluginFamilies.some((family) => family.length >= MAX_ROOT_FEED_ITEMS),
              items: pluginFamilies
                .flat()
                .sort((left, right) => right.updatedAt - left.updatedAt)
                .slice(0, MAX_ROOT_FEED_ITEMS),
            };
          })()
        : Promise.resolve({ hitCap: false, items: [] }),
    ]);
    const packages = packageResult.items;
    const hitQueryCap =
      (includeSkills && skills.length >= MAX_ROOT_FEED_ITEMS) || packageResult.hitCap;
    const matchedSkills = skills.filter((skill) => matchesSkillFeed(skill, feed));
    const matchedPackages = packages.filter((pkg) => matchesPackageFeed(pkg, feed));
    const combined = [
      ...matchedSkills.map((skill) => ({
        kind: "skill" as const,
        updatedAt: skill.updatedAt,
        value: skill,
      })),
      ...matchedPackages.map((pkg) => ({
        kind: "package" as const,
        updatedAt: pkg.updatedAt,
        value: pkg,
      })),
    ].sort((left, right) => right.updatedAt - left.updatedAt);

    const selected = combined.slice(0, limit);
    const filteredSkills: typeof skills = [];
    const filteredPackages: typeof packages = [];
    for (const entry of selected) {
      if (entry.kind === "skill") {
        filteredSkills.push(entry.value);
      } else {
        filteredPackages.push(entry.value);
      }
    }

    return {
      generatedAtMs: Math.max(
        0,
        ...filteredSkills.map((skill) => skill.updatedAt),
        ...filteredPackages.map((pkg) => pkg.updatedAt),
      ),
      skills: filteredSkills,
      packages: filteredPackages,
      truncated: hitQueryCap || combined.length > selected.length,
      limit,
    };
  },
});
