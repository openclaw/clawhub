type LegacySearchResult = {
  score?: unknown;
  skill?: {
    slug?: unknown;
    displayName?: unknown;
    summary?: unknown;
    updatedAt?: unknown;
    stats?: { downloads?: unknown };
  } | null;
  version?: { version?: unknown } | null;
  ownerHandle?: unknown;
  owner?: {
    handle?: unknown;
    displayName?: unknown;
    image?: unknown;
  } | null;
};

function isCanonicalResult(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const source = (value as { source?: unknown }).source;
  return source === "clawhub" || source === "skills-sh";
}

function toLegacyOwner(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const owner = value as { handle?: unknown; displayName?: unknown; image?: unknown };
  return {
    handle: typeof owner.handle === "string" ? owner.handle : null,
    displayName: typeof owner.displayName === "string" ? owner.displayName : null,
    image: typeof owner.image === "string" ? owner.image : null,
  };
}

/** Preserve canonical action order/shape while supporting older action rows. */
export function serializeCanonicalSkillSearchResults(results: unknown[]) {
  return results.map((result) => {
    if (isCanonicalResult(result)) {
      if (result.source !== "clawhub") return result;
      const native =
        result.native && typeof result.native === "object"
          ? (result.native as { owner?: unknown })
          : null;
      return {
        ...result,
        owner: toLegacyOwner(result.publisher ?? native?.owner),
      };
    }
    const legacy = (result ?? {}) as LegacySearchResult;
    const owner = legacy.owner
      ? {
          handle: typeof legacy.owner.handle === "string" ? legacy.owner.handle : null,
          displayName:
            typeof legacy.owner.displayName === "string" ? legacy.owner.displayName : null,
          image: typeof legacy.owner.image === "string" ? legacy.owner.image : null,
        }
      : null;
    return {
      score: typeof legacy.score === "number" ? legacy.score : 0,
      slug: typeof legacy.skill?.slug === "string" ? legacy.skill.slug : undefined,
      displayName:
        typeof legacy.skill?.displayName === "string" ? legacy.skill.displayName : undefined,
      summary: typeof legacy.skill?.summary === "string" ? legacy.skill.summary : null,
      version: typeof legacy.version?.version === "string" ? legacy.version.version : null,
      downloads:
        typeof legacy.skill?.stats?.downloads === "number"
          ? legacy.skill.stats.downloads
          : undefined,
      updatedAt: typeof legacy.skill?.updatedAt === "number" ? legacy.skill.updatedAt : undefined,
      ownerHandle:
        typeof legacy.ownerHandle === "string" ? legacy.ownerHandle : (owner?.handle ?? null),
      owner,
    };
  });
}
