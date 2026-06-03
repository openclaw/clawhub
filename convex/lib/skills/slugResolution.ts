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
const LEGACY_PREFERRED_PUBLISHER_HANDLE = "openclaw";
const MAX_LEGACY_OWNER_MATCHES = 25;

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
  const scopedSkill = await ctx.db
    .query("skills")
    .withIndex("by_owner_publisher_slug", (q) =>
      q.eq("ownerPublisherId", publisher._id).eq("slug", slug),
    )
    .unique();
  if (scopedSkill) return scopedSkill;

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
  options: { includeSoftDeleted?: boolean } = {},
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
  const candidateSkills = options.includeSoftDeleted
    ? uniqueSkills([...directSkills, ...aliasMatches.map((entry) => entry.skill)])
    : uniqueSkills([...directSkills, ...aliasMatches.map((entry) => entry.skill)]);
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
  const preferred = await findPreferredPublisherSkill(ctx, selectableSkills);
  if (preferred) return preferred;
  if (selectableSkills.length === 1) return selectableSkills[0];
  return preferred ?? "ambiguous";
}

async function takeQueryResults<T>(query: LegacyResultQuery<T>, limit: number) {
  if (query.take) return query.take(limit);
  const unique = await query.unique?.();
  return unique ? [unique] : [];
}

async function findPreferredPublisherSkill(ctx: DbCtx, skills: Doc<"skills">[]) {
  const matches: Doc<"skills">[] = [];
  for (const skill of skills) {
    if (!skill.ownerPublisherId) continue;
    const publisher = await ctx.db.get(skill.ownerPublisherId);
    if (
      publisher &&
      !publisher.deletedAt &&
      !publisher.deactivatedAt &&
      publisher.handle === LEGACY_PREFERRED_PUBLISHER_HANDLE
    ) {
      matches.push(skill);
    }
  }
  return matches.length === 1 ? matches[0] : null;
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
