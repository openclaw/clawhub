import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { assertAdmin, requireUser } from "./lib/access";

export type PromotionStatus = "draft" | "active" | "ended";

const PROMOTION_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_SLUG_LENGTH = 64;
const MAX_TITLE_LENGTH = 120;
const MAX_BLURB_LENGTH = 500;
const MAX_SHORT_FIELD_LENGTH = 128;
const MAX_URL_LENGTH = 500;
const MAX_MODELS = 20;
const MAX_PLUGIN_NAMES = 10;
const STAFF_LIST_PAGE_SIZE = 100;
const ACTIVE_SET_LIMIT = 50;

const promotionModelArgValidator = v.object({
  modelRef: v.string(),
  alias: v.optional(v.string()),
  suggestedDefault: v.optional(v.boolean()),
});

const promotionInputArgs = {
  slug: v.string(),
  title: v.string(),
  blurb: v.string(),
  sponsor: v.optional(v.string()),
  startsAt: v.number(),
  endsAt: v.number(),
  provider: v.optional(v.string()),
  authChoiceId: v.optional(v.string()),
  pluginNames: v.optional(v.array(v.string())),
  models: v.array(promotionModelArgValidator),
  signupUrl: v.optional(v.string()),
  docsUrl: v.optional(v.string()),
  launchPageUrl: v.optional(v.string()),
} as const;

const promotionStatusArgValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("ended"),
);

type PromotionModelInput = {
  modelRef: string;
  alias?: string;
  suggestedDefault?: boolean;
};

export type PromotionInput = {
  slug: string;
  title: string;
  blurb: string;
  sponsor?: string;
  startsAt: number;
  endsAt: number;
  provider?: string;
  authChoiceId?: string;
  pluginNames?: string[];
  models: PromotionModelInput[];
  signupUrl?: string;
  docsUrl?: string;
  launchPageUrl?: string;
};

export function normalizePromotionSlug(raw: string) {
  return raw.trim().toLowerCase();
}

function requireShortField(label: string, value: string | undefined, maxLength: number) {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw new ConvexError(`${label} too long (max ${maxLength} chars)`);
  }
  return trimmed;
}

function requireHttpsUrl(label: string, value: string | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new ConvexError(`${label} too long (max ${MAX_URL_LENGTH} chars)`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ConvexError(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new ConvexError(`${label} must use https`);
  }
  return trimmed;
}

export function normalizePromotionInput(input: PromotionInput): PromotionInput {
  const slug = normalizePromotionSlug(input.slug);
  if (!slug) throw new ConvexError("Slug required");
  if (slug.length > MAX_SLUG_LENGTH || !PROMOTION_SLUG_PATTERN.test(slug)) {
    throw new ConvexError(
      "Slug must be lowercase letters, digits, and hyphens (no leading/trailing hyphen)",
    );
  }

  const title = input.title.trim();
  if (!title) throw new ConvexError("Title required");
  if (title.length > MAX_TITLE_LENGTH) {
    throw new ConvexError(`Title too long (max ${MAX_TITLE_LENGTH} chars)`);
  }

  const blurb = input.blurb.trim();
  if (!blurb) throw new ConvexError("Blurb required");
  if (blurb.length > MAX_BLURB_LENGTH) {
    throw new ConvexError(`Blurb too long (max ${MAX_BLURB_LENGTH} chars)`);
  }

  if (
    !Number.isFinite(input.startsAt) ||
    !Number.isFinite(input.endsAt) ||
    Number.isNaN(new Date(input.startsAt).getTime()) ||
    Number.isNaN(new Date(input.endsAt).getTime())
  ) {
    throw new ConvexError("startsAt and endsAt must be valid timestamps (ms)");
  }
  if (input.endsAt <= input.startsAt) {
    throw new ConvexError("endsAt must be after startsAt");
  }

  if (input.models.length === 0) throw new ConvexError("At least one model required");
  if (input.models.length > MAX_MODELS) {
    throw new ConvexError(`Too many models (max ${MAX_MODELS})`);
  }
  const models = input.models.map((model) => {
    const modelRef = requireShortField("modelRef", model.modelRef, MAX_SHORT_FIELD_LENGTH * 2);
    if (!modelRef) throw new ConvexError("modelRef required for every model");
    const alias = requireShortField("Model alias", model.alias, MAX_SHORT_FIELD_LENGTH);
    return {
      modelRef,
      ...(alias ? { alias } : {}),
      ...(model.suggestedDefault ? { suggestedDefault: true } : {}),
    };
  });

  const pluginNames = (input.pluginNames ?? [])
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (pluginNames.length > MAX_PLUGIN_NAMES) {
    throw new ConvexError(`Too many plugin names (max ${MAX_PLUGIN_NAMES})`);
  }
  for (const name of pluginNames) {
    if (name.length > 214) throw new ConvexError(`Plugin name too long: ${name}`);
  }

  const sponsor = requireShortField("Sponsor", input.sponsor, MAX_SHORT_FIELD_LENGTH);
  const provider = requireShortField("Provider", input.provider, MAX_SHORT_FIELD_LENGTH);
  const authChoiceId = requireShortField(
    "authChoiceId",
    input.authChoiceId,
    MAX_SHORT_FIELD_LENGTH,
  );
  const signupUrl = requireHttpsUrl("signupUrl", input.signupUrl);
  const docsUrl = requireHttpsUrl("docsUrl", input.docsUrl);
  const launchPageUrl = requireHttpsUrl("launchPageUrl", input.launchPageUrl);

  return {
    slug,
    title,
    blurb,
    ...(sponsor ? { sponsor } : {}),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    ...(provider ? { provider } : {}),
    ...(authChoiceId ? { authChoiceId } : {}),
    ...(pluginNames.length > 0 ? { pluginNames } : {}),
    models,
    ...(signupUrl ? { signupUrl } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    ...(launchPageUrl ? { launchPageUrl } : {}),
  };
}

export function isPromotionActive(promotion: Doc<"promotions">, now: number) {
  return promotion.status === "active" && promotion.startsAt <= now && now <= promotion.endsAt;
}

export function toPublicPromotion(promotion: Doc<"promotions">, now: number) {
  return {
    slug: promotion.slug,
    title: promotion.title,
    blurb: promotion.blurb,
    ...(promotion.sponsor ? { sponsor: promotion.sponsor } : {}),
    status: promotion.status,
    active: isPromotionActive(promotion, now),
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    ...(promotion.provider ? { provider: promotion.provider } : {}),
    ...(promotion.authChoiceId ? { authChoiceId: promotion.authChoiceId } : {}),
    ...(promotion.pluginNames && promotion.pluginNames.length > 0
      ? { pluginNames: promotion.pluginNames }
      : {}),
    models: promotion.models,
    ...(promotion.signupUrl ? { signupUrl: promotion.signupUrl } : {}),
    ...(promotion.docsUrl ? { docsUrl: promotion.docsUrl } : {}),
    ...(promotion.launchPageUrl ? { launchPageUrl: promotion.launchPageUrl } : {}),
  };
}

async function getPromotionBySlug(ctx: QueryCtx | MutationCtx, slug: string) {
  return await ctx.db
    .query("promotions")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

// Feed snapshots are immutable, so visibility changes must republish the
// promotions feed: immediately for the mutation itself, and at future window
// edges so launches and expiries land on time without waiting for the
// periodic backstop publish.
async function schedulePromotionsFeedRepublication(
  ctx: MutationCtx,
  promotion: Pick<Doc<"promotions">, "status" | "startsAt" | "endsAt">,
) {
  await ctx.scheduler.runAfter(0, internal.promotionsFeed.publishInternal, {});
  if (promotion.status !== "active") return;
  const now = Date.now();
  for (const edge of [promotion.startsAt, promotion.endsAt + 1]) {
    if (edge > now) {
      await ctx.scheduler.runAt(edge, internal.promotionsFeed.publishInternal, {});
    }
  }
}

async function requireActorFromId(ctx: MutationCtx, actorUserId: Id<"users">) {
  const actor = await ctx.db.get(actorUserId);
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
  return actor;
}

async function createPromotionForActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  input: PromotionInput,
) {
  assertAdmin(actor);
  const normalized = normalizePromotionInput(input);
  const existing = await getPromotionBySlug(ctx, normalized.slug);
  if (existing) throw new ConvexError(`Promotion already exists: ${normalized.slug}`);

  const now = Date.now();
  const promotionId = await ctx.db.insert("promotions", {
    ...normalized,
    status: "draft",
    createdByUserId: actor._id,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "promotion.create",
    targetType: "promotion",
    targetId: normalized.slug,
    metadata: { promotionId, title: normalized.title },
    createdAt: now,
  });
  return { ok: true as const, slug: normalized.slug, status: "draft" as const };
}

async function updatePromotionForActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  slug: string,
  input: PromotionInput,
) {
  assertAdmin(actor);
  const existing = await getPromotionBySlug(ctx, normalizePromotionSlug(slug));
  if (!existing) throw new ConvexError("Promotion not found");

  const normalized = normalizePromotionInput(input);
  if (normalized.slug !== existing.slug) {
    // Slugs are referenced by external links and CLI claim provenance once a
    // promotion has been activated; only drafts may be renamed.
    if (existing.status !== "draft") {
      throw new ConvexError("Slug can only be changed while the promotion is a draft");
    }
    const collision = await getPromotionBySlug(ctx, normalized.slug);
    if (collision) throw new ConvexError(`Promotion already exists: ${normalized.slug}`);
  }

  const now = Date.now();
  await ctx.db.replace(existing._id, {
    ...normalized,
    status: existing.status,
    createdByUserId: existing.createdByUserId,
    createdAt: existing.createdAt,
    updatedByUserId: actor._id,
    updatedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "promotion.update",
    targetType: "promotion",
    targetId: normalized.slug,
    metadata: { promotionId: existing._id, previousSlug: existing.slug },
    createdAt: now,
  });
  await schedulePromotionsFeedRepublication(ctx, {
    status: existing.status,
    startsAt: normalized.startsAt,
    endsAt: normalized.endsAt,
  });
  return { ok: true as const, slug: normalized.slug, status: existing.status };
}

async function setPromotionStatusForActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  slug: string,
  status: PromotionStatus,
) {
  assertAdmin(actor);
  const existing = await getPromotionBySlug(ctx, normalizePromotionSlug(slug));
  if (!existing) throw new ConvexError("Promotion not found");
  if (status === "draft" && existing.status !== "draft") {
    throw new ConvexError("Published promotions cannot return to draft");
  }
  if (existing.status === "draft" && status === "ended") {
    throw new ConvexError("Draft promotions must be activated before they can end");
  }
  if (existing.status === "ended" && status === "active") {
    throw new ConvexError("Ended promotions cannot be reactivated");
  }
  if (existing.status === status) {
    return { ok: true as const, slug: existing.slug, status };
  }
  if (status === "active") {
    const activePromotions = await ctx.db
      .query("promotions")
      .withIndex("by_status_endsAt", (q) => q.eq("status", "active"))
      .take(ACTIVE_SET_LIMIT);
    if (activePromotions.length >= ACTIVE_SET_LIMIT) {
      throw new ConvexError(
        `At most ${ACTIVE_SET_LIMIT} promotions can be active; end an existing promotion first`,
      );
    }
  }

  const now = Date.now();
  await ctx.db.patch(existing._id, {
    status,
    updatedByUserId: actor._id,
    updatedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "promotion.set_status",
    targetType: "promotion",
    targetId: existing.slug,
    metadata: { promotionId: existing._id, from: existing.status, to: status },
    createdAt: now,
  });
  await schedulePromotionsFeedRepublication(ctx, {
    status,
    startsAt: existing.startsAt,
    endsAt: existing.endsAt,
  });
  return { ok: true as const, slug: existing.slug, status };
}

// Dashboard entry points (Convex auth session).
export const create = mutation({
  args: promotionInputArgs,
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return createPromotionForActor(ctx, user, args);
  },
});

export const update = mutation({
  args: { targetSlug: v.string(), ...promotionInputArgs },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const { targetSlug, ...input } = args;
    return updatePromotionForActor(ctx, user, targetSlug, input);
  },
});

export const setStatus = mutation({
  args: { slug: v.string(), status: promotionStatusArgValidator },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return setPromotionStatusForActor(ctx, user, args.slug, args.status);
  },
});

// HTTP API entry points (API-token auth resolved in the handler).
export const createInternal = internalMutation({
  args: { actorUserId: v.id("users"), input: v.object(promotionInputArgs) },
  handler: async (ctx, args) => {
    const actor = await requireActorFromId(ctx, args.actorUserId);
    return createPromotionForActor(ctx, actor, args.input);
  },
});

export const updateInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetSlug: v.string(),
    input: v.object(promotionInputArgs),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorFromId(ctx, args.actorUserId);
    return updatePromotionForActor(ctx, actor, args.targetSlug, args.input);
  },
});

export const setStatusInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    slug: v.string(),
    status: promotionStatusArgValidator,
  },
  handler: async (ctx, args) => {
    const actor = await requireActorFromId(ctx, args.actorUserId);
    return setPromotionStatusForActor(ctx, actor, args.slug, args.status);
  },
});

// Activation enforces ACTIVE_SET_LIMIT, so this read remains bounded while
// still considering every curated active or scheduled promotion.
async function collectActivePromotions(ctx: QueryCtx, now: number) {
  const promotions: Array<ReturnType<typeof toPublicPromotion>> = [];
  let nextStartsAt: number | null = null;
  const active = await ctx.db
    .query("promotions")
    .withIndex("by_status_endsAt", (q) => q.eq("status", "active").gte("endsAt", now))
    .take(ACTIVE_SET_LIMIT);
  for (const promotion of active) {
    if (promotion.startsAt > now) {
      nextStartsAt =
        nextStartsAt === null ? promotion.startsAt : Math.min(nextStartsAt, promotion.startsAt);
      continue;
    }
    if (!isPromotionActive(promotion, now)) continue;
    promotions.push(toPublicPromotion(promotion, now));
  }
  return { promotions, nextStartsAt };
}

export const listActiveInternal = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => collectActivePromotions(ctx, args.now),
});

export const getBySlugPublicInternal = internalQuery({
  args: { slug: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const promotion = await getPromotionBySlug(ctx, normalizePromotionSlug(args.slug));
    // Drafts and every pre-launch state stay hidden so unreleased launch
    // details cannot be read by guessing the slug. Ended promotions remain
    // visible after launch so stale links can render an "ended" state.
    if (!promotion || promotion.status === "draft") return null;
    if (args.now < promotion.startsAt) return null;
    return toPublicPromotion(promotion, args.now);
  },
});

export const listAllInternal = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("promotions").order("desc").paginate(args.paginationOpts);
    const now = Date.now();
    return {
      ...result,
      page: result.page.map((promotion) => toPublicPromotion(promotion, now)),
    };
  },
});

export const listForStaff = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    // Admin-only like every other promotions surface: drafts carry unreleased
    // launch windows and sponsor details.
    assertAdmin(user);
    return await ctx.db
      .query("promotions")
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, STAFF_LIST_PAGE_SIZE),
      });
  },
});
