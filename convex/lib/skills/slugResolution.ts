import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  getActiveUserByHandleOrPersonalPublisher,
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

export function normalizeSkillSlugKey(slug: string) {
  return normalizeSkillSlug(slug);
}

export async function resolvePublisherByOwnerHandle(
  ctx: DbCtx,
  ownerHandle: string | undefined | null,
) {
  const requestedOwner = ownerHandle?.trim().replace(/^@+/, "");
  if (requestedOwner?.startsWith("publishers:")) {
    const publisher = await ctx.db.get(requestedOwner as Id<"publishers">);
    return {
      requestedHandle: requestedOwner,
      publisher: publisher && !publisher.deletedAt && !publisher.deactivatedAt ? publisher : null,
    };
  }
  if (requestedOwner?.startsWith("users:")) {
    const user = await ctx.db.get(requestedOwner as Id<"users">);
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
    return { requestedHandle, publisher: materializedPublisher };
  }

  const user = await getActiveUserByHandleOrPersonalPublisher(ctx, requestedHandle);
  const fallbackPublisher = user ? await getPersonalPublisherForUserOrFallback(ctx, user) : null;
  return {
    requestedHandle,
    publisher: fallbackPublisher?.handle === requestedHandle ? fallbackPublisher : null,
  };
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

  const linkedUserId = publisher.linkedUserId;
  if (publisher.kind !== "user" || !linkedUserId) return null;

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

  const linkedUserId = publisher.linkedUserId;
  if (publisher.kind !== "user" || !linkedUserId) return null;

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
  };
  if (!normalizedSlug) return emptyResult;

  const directCandidates = await takeQueryResults<Doc<"skills">>(
    ctx.db.query("skills").withIndex("by_slug", (q) => q.eq("slug", normalizedSlug)),
    25,
  );
  const directSkills = options.includeSoftDeleted
    ? directCandidates
    : directCandidates.filter((skill) => !skill.softDeletedAt);
  const directSkill = await selectLegacySkillMatch(ctx, directSkills);
  if (directSkill === "ambiguous") {
    return { ...emptyResult, ambiguous: true };
  }
  if (directSkill) {
    return {
      requestedSlug: normalizedSlug,
      resolvedSlug: directSkill.slug,
      skill: directSkill,
      alias: null,
      ambiguous: false,
    };
  }

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
  const selectedAliasSkill = await selectLegacySkillMatch(
    ctx,
    aliasMatches.map((entry) => entry.skill),
  );
  if (selectedAliasSkill === "ambiguous") {
    return { ...emptyResult, ambiguous: true };
  }
  if (!selectedAliasSkill) return emptyResult;
  const alias = aliasMatches.find((entry) => entry.skill._id === selectedAliasSkill._id)?.alias;
  if (!alias) {
    return {
      requestedSlug: normalizedSlug,
      resolvedSlug: null,
      skill: selectedAliasSkill,
      alias: null,
      ambiguous: false,
    };
  }

  return {
    requestedSlug: normalizedSlug,
    resolvedSlug: selectedAliasSkill.slug,
    skill: selectedAliasSkill,
    alias,
    ambiguous: false,
  };
}

async function selectLegacySkillMatch(ctx: DbCtx, skills: Doc<"skills">[]) {
  if (skills.length <= 1) return skills[0] ?? null;
  const preferred = await findPreferredPublisherSkill(ctx, skills);
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
