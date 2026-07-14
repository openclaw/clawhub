import {
  PROMOTIONS_FEED_DESCRIPTION,
  PROMOTIONS_FEED_ID,
  PROMOTIONS_FEED_SCHEMA_VERSION,
  serializePromotionsFeed,
  type PromotionsFeedEntry,
} from "clawhub-schema";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./functions";
import { sha256Hex } from "./lib/clawpack";
import { isPromotionActive } from "./promotions";

// Feed snapshots are immutable bytes (see specs/hosted-catalog-feed.md), so a
// snapshot is republished whenever promotion state changes and at each
// promotion's window edges. The expiry horizon only signals staleness to
// clients; edge-triggered republication keeps content correct well within it.
const PROMOTIONS_FEED_EXPIRY_MS = 24 * 60 * 60 * 1000;
const PROMOTIONS_FEED_MAX_ENTRIES = 50;

export function toPromotionsFeedEntry(promotion: Doc<"promotions">): PromotionsFeedEntry {
  return {
    type: "promotion",
    slug: promotion.slug,
    title: promotion.title,
    blurb: promotion.blurb,
    ...(promotion.sponsor ? { sponsor: promotion.sponsor } : {}),
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

export const publishInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Same visibility rule as the public API: active and launched only, so
    // pre-activated future promotions never leak launch details into the feed.
    const entries: PromotionsFeedEntry[] = [];
    const active = ctx.db
      .query("promotions")
      .withIndex("by_status_endsAt", (q) => q.eq("status", "active").gte("endsAt", now));
    for await (const promotion of active) {
      if (!isPromotionActive(promotion, now)) continue;
      entries.push(toPromotionsFeedEntry(promotion));
      if (entries.length >= PROMOTIONS_FEED_MAX_ENTRIES) break;
    }

    const latest = await ctx.db
      .query("catalogFeedPublications")
      .withIndex("by_feed", (q) => q.eq("feedId", PROMOTIONS_FEED_ID))
      .unique();
    const sequence = (latest?.sequence ?? 0) + 1;
    const generatedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + PROMOTIONS_FEED_EXPIRY_MS).toISOString();
    const payload = serializePromotionsFeed({
      schemaVersion: PROMOTIONS_FEED_SCHEMA_VERSION,
      id: PROMOTIONS_FEED_ID,
      generatedAt,
      sequence,
      expiresAt,
      description: PROMOTIONS_FEED_DESCRIPTION,
      entries,
    });
    const payloadSha256 = await sha256Hex(new TextEncoder().encode(payload));
    const publication = {
      feedId: PROMOTIONS_FEED_ID,
      sequence,
      generatedAt,
      expiresAt,
      payload,
      payloadSha256,
      publishedAt: now,
    };
    const publicationId = latest
      ? (await ctx.db.patch(latest._id, publication), latest._id)
      : await ctx.db.insert("catalogFeedPublications", publication);
    return {
      publicationId,
      feedId: PROMOTIONS_FEED_ID,
      sequence,
      payloadSha256,
      publishedAt: now,
      entryCount: entries.length,
    };
  },
});
