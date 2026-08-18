import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { isPublicSkillDoc } from "../globalStats";
import {
  getActiveUserByHandleOrPersonalPublisher,
  getOwnerPublisher,
  getPersonalPublisherForUserOrFallback,
  getPublisherByHandle,
  normalizePublisherHandle,
} from "../publishers";
import { normalizeSkillSlug } from "../skillSlugValidator";

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;
const MAX_LEGACY_OWNER_MATCHES = 25;
const MAX_PUBLISHER_SLUG_MATCHES = 25;

type LegacyResultQuery<T> = {
  take?: (limit: number) => Promise<T[]>;
  unique?: () => Promise<T | null>;
};

export type LegacyAmbiguousSkillMatch = {
  slug: string;
  ownerHandle: string | null;
};

export function normalizeSkillSlugKey(slug: string) {
  return normalizeSkillSlug(slug);
}

export async function resolvePublisherByOwnerHandle(
  ctx: DbCtx,
  ownerHandle: string | undefined | null,
) {
  const requestedOwner = ownerHandle?.trim().replace(/^@+/, "");
  if (requestedOwner?.startsWith("publishers:")) {
    const publisher = await safeGetById(ctx, requestedOwner as Id<"publishers">);
    return {
      requestedHandle: requestedOwner,
      publisher: publisher && !publisher.deletedAt && !publisher.deactivatedAt ? publisher : null,
    };
  }
  if (requestedOwner?.startsWith("users:")) {
    const user = await safeGetById(ctx, requestedOwner as Id<"users">);
    const publisher =
      user && !user.deletedAt && !user.deactivatedAt
        ? await getPersonalPublisherForUserOrFallback(ctx, user)
        : null;
    return {
      requestedHandle: requestedOwner,
      publisher,
    };
  }

  const requestedHandle = normalizePublisherHandle(ownerHandle);
  if (!requestedHandle) {
    return { requestedHandle, publisher: null };
  }

  const materializedPublisher = await getPublisherByHandle(ctx, requestedHandle);
  if (materializedPublisher) {
    return {
      requestedHandle,
      publisher:
        materializedPublisher.deletedAt || materializedPublisher.deactivatedAt
          ? null
          : materializedPublisher,
    };
  }

  const user = await getActiveUserByHandleOrPersonalPublisher(ctx, requestedHandle);
  const fallbackPublisher = user ? await getPersonalPublisherForUserOrFallback(ctx, user) : null;
  return {
    requestedHandle,
    publisher: fallbackPublisher?.handle === requestedHandle ? fallbackPublisher : null,
  };
}

async function safeGetById<TableName extends "publishers" | "users">(
  ctx: DbCtx,
  id: Id<TableName>,
) {
  try {
    return await ctx.db.get(id);
  } catch (error) {
    if (isInvalidConvexIdError(error)) return null;
    throw error;
  }
}

function isInvalidConvexIdError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /invalid.*id|id.*invalid|not a valid id/i.test(error.message);
}

export async function getSkillBySlugForPublisher(
  ctx: DbCtx,
  slug: string,
  publisher: Doc<"publishers">,
) {
  const scopedCandidates = await takeQueryResults<Doc<"skills">>(
    ctx.db
      .query("skills")
      .withIndex("by_owner_publisher_slug", (q) =>
        q.eq("ownerPublisherId", publisher._id).eq("slug", slug),
      ),
    MAX_PUBLISHER_SLUG_MATCHES + 1,
  );
  if (scopedCandidates.length > MAX_PUBLISHER_SLUG_MATCHES) {
    throw new Error(
      `Publisher slug history exceeds the safe lookup bound for @${publisher.handle}/${slug}`,
    );
  }
  const activeScopedSkills = scopedCandidates.filter(
    (candidate) => candidate.softDeletedAt === undefined,
  );
  if (activeScopedSkills.length > 1) {
    throw new Error(`Active publisher slug invariant violated for @${publisher.handle}/${slug}`);
  }
  if (activeScopedSkills[0]) return activeScopedSkills[0];

  // Retained merge/history rows intentionally share the old owner-scoped slug.
  // Keep a single row discoverable for restore/reclaim, but never guess between
  // multiple deleted lineages when no active canonical row exists.
  const scopedHistory = scopedCandidates;
  if (scopedHistory.length > 1) {
    throw new Error(
      `Soft-deleted publisher slug history is ambiguous for @${publisher.handle}/${slug}`,
    );
  }
  if (scopedHistory[0]) return scopedHistory[0];

  const linkedUserId = await getPublisherLegacyOwnerUserId(ctx, publisher);
  if (!linkedUserId) return null;

  const legacySkills = await takeQueryResults<Doc<"skills">>(
    ctx.db
      .query("skills")
      .withIndex("by_owner_slug", (q) => q.eq("ownerUserId", linkedUserId).eq("slug", slug)),
    MAX_LEGACY_OWNER_MATCHES,
  );
  const legacySkill = legacySkills.find(
    (candidate) => !candidate.ownerPublisherId || candidate.ownerPublisherId === publisher._id,
  );
  if (!legacySkill) return null;
  return legacySkill;
}

export async function getSkillSlugAliasBySlugForPublisher(
  ctx: DbCtx,
  slug: string,
  publisher: Doc<"publishers">,
) {
  const scopedAlias = await ctx.db
    .query("skillSlugAliases")
    .withIndex("by_owner_publisher_slug", (q) =>
      q.eq("ownerPublisherId", publisher._id).eq("slug", slug),
    )
    .unique();
  if (scopedAlias) return scopedAlias;

  const linkedUserId = await getPublisherLegacyOwnerUserId(ctx, publisher);
  if (!linkedUserId) return null;

  const legacyAliases = await takeQueryResults<Doc<"skillSlugAliases">>(
    ctx.db
      .query("skillSlugAliases")
      .withIndex("by_owner_slug", (q) => q.eq("ownerUserId", linkedUserId).eq("slug", slug)),
    MAX_LEGACY_OWNER_MATCHES,
  );
  const legacyAlias = legacyAliases.find(
    (candidate) => !candidate.ownerPublisherId || candidate.ownerPublisherId === publisher._id,
  );
  if (!legacyAlias) return null;
  return legacyAlias;
}

async function getPublisherLegacyOwnerUserId(ctx: DbCtx, publisher: Doc<"publishers">) {
  if (publisher.kind !== "user") return null;
  if (publisher.linkedUserId) return publisher.linkedUserId;

  // Compatibility for early personal publisher rows that were materialized
  // before linkedUserId existed. Owner-qualified routes still need to find the
  // ownerUserId-only skill rows those handles represented.
  const user = await getActiveUserByHandleOrPersonalPublisher(ctx, publisher.handle);
  return user?._id ?? null;
}

export async function getSkillSlugAliasBySlugScoped(
  ctx: DbCtx,
  slug: string,
  ownerPublisherId: Id<"publishers">,
  ownerUserId?: Id<"users">,
) {
  const scopedAlias = await ctx.db
    .query("skillSlugAliases")
    .withIndex("by_owner_publisher_slug", (q) =>
      q.eq("ownerPublisherId", ownerPublisherId).eq("slug", slug),
    )
    .unique();
  if (scopedAlias || !ownerUserId) return scopedAlias;

  const legacyAliases = await takeQueryResults<Doc<"skillSlugAliases">>(
    ctx.db
      .query("skillSlugAliases")
      .withIndex("by_owner_slug", (q) => q.eq("ownerUserId", ownerUserId).eq("slug", slug)),
    MAX_LEGACY_OWNER_MATCHES,
  );
  const legacyAlias = legacyAliases.find(
    (candidate) => !candidate.ownerPublisherId || candidate.ownerPublisherId === ownerPublisherId,
  );
  if (!legacyAlias) return null;
  return legacyAlias;
}

export async function resolveLegacySkillBySlugOrAlias(
  ctx: DbCtx,
  slug: string,
  options: { includeSoftDeleted?: boolean; ownerHandle?: string } = {},
) {
  const normalizedSlug = normalizeSkillSlugKey(slug);
  const emptyResult = {
    requestedSlug: normalizedSlug,
    resolvedSlug: null,
    skill: null,
    alias: null,
    ambiguous: false,
    ambiguousMatches: [] as LegacyAmbiguousSkillMatch[],
  };
  if (!normalizedSlug) return emptyResult;

  const directCandidates = await takeQueryResults<Doc<"skills">>(
    ctx.db.query("skills").withIndex("by_slug", (q) => q.eq("slug", normalizedSlug)),
    25,
  );
  const directSkills = options.includeSoftDeleted
    ? directCandidates
    : directCandidates.filter((skill) => !skill.softDeletedAt);

  const aliases = await takeQueryResults<Doc<"skillSlugAliases">>(
    ctx.db.query("skillSlugAliases").withIndex("by_slug", (q) => q.eq("slug", normalizedSlug)),
    25,
  );
  const aliasMatches = (
    await Promise.all(
      aliases.map(async (alias) => {
        const skill = await ctx.db.get(alias.skillId);
        if (!skill || (!options.includeSoftDeleted && skill.softDeletedAt)) return null;
        return { alias, skill };
      }),
    )
  ).filter(
    (entry): entry is { alias: Doc<"skillSlugAliases">; skill: Doc<"skills"> } => entry !== null,
  );
  const unscopedCandidateSkills = uniqueSkills([
    ...directSkills,
    ...aliasMatches.map((entry) => entry.skill),
  ]);
  const candidateSkills = options.ownerHandle
    ? await filterLegacySkillsByOwnerHandle(ctx, unscopedCandidateSkills, options.ownerHandle)
    : unscopedCandidateSkills;
  const selectedSkill = await selectLegacySkillMatch(ctx, candidateSkills, options);
  if (selectedSkill === "ambiguous") {
    const ambiguousMatches = await buildLegacyAmbiguousSkillMatches(ctx, candidateSkills);
    if (ambiguousMatches.length === 0) return emptyResult;
    return {
      ...emptyResult,
      ambiguous: true,
      ambiguousMatches,
    };
  }
  if (!selectedSkill) return emptyResult;
  const directSkill = directSkills.find((skill) => skill._id === selectedSkill._id);
  if (directSkill) {
    return {
      requestedSlug: normalizedSlug,
      resolvedSlug: directSkill.slug,
      skill: directSkill,
      alias: null,
      ambiguous: false,
      ambiguousMatches: [] as LegacyAmbiguousSkillMatch[],
    };
  }
  const alias = aliasMatches.find((entry) => entry.skill._id === selectedSkill._id)?.alias;
  if (!alias) return emptyResult;

  return {
    requestedSlug: normalizedSlug,
    resolvedSlug: selectedSkill.slug,
    skill: selectedSkill,
    alias,
    ambiguous: false,
    ambiguousMatches: [] as LegacyAmbiguousSkillMatch[],
  };
}

async function filterLegacySkillsByOwnerHandle(
  ctx: DbCtx,
  skills: Doc<"skills">[],
  ownerHandle: string,
) {
  const normalizedOwnerHandle = normalizePublisherHandle(ownerHandle);
  if (!normalizedOwnerHandle) return [];

  const matches = await Promise.all(
    skills.map(async (skill) => {
      if (skill.ownerPublisherId) {
        const publisher = await ctx.db.get(skill.ownerPublisherId);
        return normalizePublisherHandle(publisher?.handle) === normalizedOwnerHandle ? skill : null;
      }

      // Legacy personal skills may outlive a banned user and predate materialized publishers.
      // Compare normalized stored casing without requiring the owner to be active.
      const user = await ctx.db.get(skill.ownerUserId);
      return normalizePublisherHandle(user?.handle) === normalizedOwnerHandle ? skill : null;
    }),
  );
  return matches.filter((skill): skill is Doc<"skills"> => skill !== null);
}

function uniqueSkills(skills: Doc<"skills">[]) {
  const byId = new Map<Id<"skills">, Doc<"skills">>();
  for (const skill of skills) byId.set(skill._id, skill);
  return Array.from(byId.values());
}

async function selectLegacySkillMatch(
  ctx: DbCtx,
  skills: Doc<"skills">[],
  options: { includeSoftDeleted?: boolean } = {},
) {
  if (skills.length <= 1) return skills[0] ?? null;
  const selectableSkills = options.includeSoftDeleted
    ? skills
    : skills.filter((skill) => isPublicSkillDoc(skill));
  if (selectableSkills.length === 1) return selectableSkills[0];
  const openClawMatches = [];
  for (const skill of selectableSkills) {
    const owner = await getOwnerPublisher(ctx, {
      ownerPublisherId: skill.ownerPublisherId,
      ownerUserId: skill.ownerUserId,
    });
    if (owner?.handle === "openclaw") openClawMatches.push(skill);
  }
  if (openClawMatches.length === 1) return openClawMatches[0];
  return "ambiguous";
}

async function takeQueryResults<T>(query: LegacyResultQuery<T>, limit: number) {
  if (query.take) return query.take(limit);
  const unique = await query.unique?.();
  return unique ? [unique] : [];
}

async function buildLegacyAmbiguousSkillMatches(
  ctx: DbCtx,
  skills: Doc<"skills">[],
): Promise<LegacyAmbiguousSkillMatch[]> {
  const matches: LegacyAmbiguousSkillMatch[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    if (!isPublicSkillDoc(skill)) continue;
    const owner = await getOwnerPublisher(ctx, {
      ownerPublisherId: skill.ownerPublisherId,
      ownerUserId: skill.ownerUserId,
    });
    const ownerHandle = owner?.handle ?? null;
    const key = `${ownerHandle ?? ""}/${skill.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ slug: skill.slug, ownerHandle });
  }
  return matches;
}
