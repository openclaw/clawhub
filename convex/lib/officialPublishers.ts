import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { toPublicPublisher, type PublicPublisher } from "./public";

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

type OfficialPublisherCandidate = Pick<
  Doc<"publishers">,
  | "_id"
  | "_creationTime"
  | "kind"
  | "handle"
  | "displayName"
  | "image"
  | "bio"
  | "linkedUserId"
  | "deletedAt"
  | "deactivatedAt"
>;

export async function isOfficialPublisher(
  ctx: DbCtx,
  publisher: OfficialPublisherCandidate | null | undefined,
): Promise<boolean> {
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return false;
  const officialPublisher = await ctx.db
    .query("officialPublishers")
    .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
    .unique();
  return Boolean(officialPublisher);
}

export async function toPublicPublisherWithOfficial(
  ctx: DbCtx,
  publisher: Doc<"publishers"> | null | undefined,
): Promise<PublicPublisher | null> {
  const official = await isOfficialPublisher(ctx, publisher);
  return toPublicPublisher(publisher, { official });
}
