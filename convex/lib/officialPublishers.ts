import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { toPublicPublisher, type PublicPublisher } from "./public";
import {
  getPublisherByHandle,
  getPublisherMembership,
  normalizePublisherHandle,
} from "./publishers";

const OFFICIAL_ORG_HANDLES = ["openclaw", "nvidia"] as const;
const OFFICIAL_ORG_HANDLE_SET = new Set<string>(OFFICIAL_ORG_HANDLES);

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
    const handle = normalizePublisherHandle(publisher.handle);
    return Boolean(handle && OFFICIAL_ORG_HANDLE_SET.has(handle));
  }
  if (!publisher.linkedUserId) return false;

  for (const officialOrgHandle of OFFICIAL_ORG_HANDLES) {
    const officialOrg = await getPublisherByHandle(ctx, officialOrgHandle);
    if (!officialOrg || officialOrg.deletedAt || officialOrg.deactivatedAt) continue;

    const membership = await getPublisherMembership(ctx, officialOrg._id, publisher.linkedUserId);
    if (membership) return true;
  }

  return false;
}

export async function toPublicPublisherWithOfficial(
  ctx: DbCtx,
  publisher: Doc<"publishers"> | null | undefined,
): Promise<PublicPublisher | null> {
  const official = await isOfficialPublisher(ctx, publisher);
  return toPublicPublisher(publisher, { official });
}
