import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { toPublicPublisher, type PublicPublisher } from "./public";

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

type OfficialPublisherCandidate = Pick<Doc<"publishers">, "_id" | "deletedAt" | "deactivatedAt">;

export type OfficialPublisherLookupCache = {
  officialByPublisherId: Map<string, Promise<boolean>>;
  publisherById: Map<string, Promise<Doc<"publishers"> | null>>;
};

export function createOfficialPublisherLookupCache(): OfficialPublisherLookupCache {
  return { officialByPublisherId: new Map(), publisherById: new Map() };
}

export async function isOfficialPublisher(
  ctx: DbCtx,
  publisher: OfficialPublisherCandidate | null | undefined,
  cache?: OfficialPublisherLookupCache,
): Promise<boolean> {
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return false;
  return await hasOfficialPublisherRow(ctx, publisher._id, cache);
}

export async function hasOfficialPublisherRow(
  ctx: DbCtx,
  publisherId: Doc<"publishers">["_id"],
  cache?: OfficialPublisherLookupCache,
): Promise<boolean> {
  const key = String(publisherId);
  const cached = cache?.officialByPublisherId.get(key);
  if (cached) return await cached;

  const lookup = ctx.db
    .query("officialPublishers")
    .withIndex("by_publisher", (q) => q.eq("publisherId", publisherId))
    .unique()
    .then(Boolean);
  cache?.officialByPublisherId.set(key, lookup);
  return await lookup;
}

export async function isActiveOfficialPublisherId(
  ctx: DbCtx,
  publisherId: Doc<"publishers">["_id"] | null | undefined,
  cache?: OfficialPublisherLookupCache,
): Promise<boolean> {
  if (!publisherId) return false;
  if (!(await hasOfficialPublisherRow(ctx, publisherId, cache))) return false;

  const key = String(publisherId);
  const cached = cache?.publisherById.get(key);
  const publisher = cached ?? ctx.db.get(publisherId);
  cache?.publisherById.set(key, publisher);

  const livePublisher = await publisher;
  return Boolean(livePublisher && !livePublisher.deletedAt && !livePublisher.deactivatedAt);
}

export async function toPublicPublisherWithOfficial(
  ctx: DbCtx,
  publisher: Doc<"publishers"> | null | undefined,
  cache?: OfficialPublisherLookupCache,
): Promise<PublicPublisher | null> {
  const official = await isOfficialPublisher(ctx, publisher, cache);
  return toPublicPublisher(publisher, { official });
}
