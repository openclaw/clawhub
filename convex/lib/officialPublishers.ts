import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { toPublicPublisher, type PublicPublisher } from "./public";
import {
  getPublisherByHandle,
  getPublisherMembership,
  normalizePublisherHandle,
} from "./publishers";

const OFFICIAL_ORG_HANDLE = "openclaw";

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
  if (publisher.kind === "org") {
    return normalizePublisherHandle(publisher.handle) === OFFICIAL_ORG_HANDLE;
  }
  if (!publisher.linkedUserId) return false;

  const officialOrg = await getPublisherByHandle(ctx, OFFICIAL_ORG_HANDLE);
  if (!officialOrg || officialOrg.deletedAt || officialOrg.deactivatedAt) return false;

  const membership = await getPublisherMembership(ctx, officialOrg._id, publisher.linkedUserId);
  return Boolean(membership);
}

export async function toPublicPublisherWithOfficial(
  ctx: DbCtx,
  publisher: Doc<"publishers"> | null | undefined,
): Promise<PublicPublisher | null> {
  const official = await isOfficialPublisher(ctx, publisher);
  return toPublicPublisher(publisher, { official });
}
